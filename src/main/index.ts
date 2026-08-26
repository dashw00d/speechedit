import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { homedir } from 'node:os'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import {
  asMediaJobKind,
  beginExportExclusive,
  endExportExclusive,
  ImportLinger,
  JobBusy,
  JobGate,
  runWhenExportIdle
} from '../shared/mediaJob'
import { parkChild, unparkChild } from './childJob'
import {
  analyzeMedia,
  detectEncoders,
  detectLoudness,
  detectScenes,
  detectSilence,
  exportProgram,
  makeProxy,
  probe,
  probeProxyGop,
  thumbnails,
  completeChat,
  listChatModels,
  testChatEndpoint,
  listAsrPath,
  transcribeMedia,
  waveform
} from './ffmpeg'
import { proxyCachePath } from './asrLocal'
import { parseByteRange } from '../shared/mediaRange'
import { ModelQueue, type ModelQueueStatus } from '../shared/modelQueue'

const here = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url))

function broadcastModelQueue(status: ModelQueueStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('model:queue-changed', status)
  }
}

const modelQueue = new ModelQueue(broadcastModelQueue)
function preloadScript(): string {
  const mjs = join(here, '../preload/index.mjs')
  const js = join(here, '../preload/index.js')
  return existsSync(mjs) ? mjs : js
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
])

function mediaContentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4'
    case '.mov':
      return 'video/quicktime'
    case '.webm':
      return 'video/webm'
    case '.mkv':
      return 'video/x-matroska'
    case '.wav':
      return 'audio/wav'
    case '.mp3':
      return 'audio/mpeg'
    case '.m4a':
      return 'audio/mp4'
    case '.aac':
      return 'audio/aac'
    default:
      return 'application/octet-stream'
  }
}

async function localMediaResponse(request: Request, filePath: string): Promise<Response> {
  let size = 0
  try {
    size = (await stat(filePath)).size
  } catch {
    return new Response('media not found', { status: 404 })
  }

  const parsed = parseByteRange(request.headers.get('range'), size)
  const common = {
    'Accept-Ranges': 'bytes',
    'Content-Type': mediaContentType(filePath)
  }
  if (parsed === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...common, 'Content-Range': `bytes */${size}` }
    })
  }

  const start = parsed?.start ?? 0
  const end = parsed?.end ?? Math.max(0, size - 1)
  const length = Math.max(0, end - start + 1)
  const headers = {
    ...common,
    'Content-Length': String(length),
    ...(parsed ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
  }
  if (request.method === 'HEAD' || length === 0) {
    return new Response(null, { status: parsed ? 206 : 200, headers })
  }

  const body = Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as BodyInit
  return new Response(body, { status: parsed ? 206 : 200, headers })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#16140F',
    title: 'SpeechEdit',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadScript(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(here, '../renderer/index.html'))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('closed', () => {
    jobs.cancel()
    jobs.finish()
    importLingers.abortAll()
  })
  return win
}

const jobs = new JobGate()
const importLingers = new ImportLinger()
importLingers.setParker(parkChild, unparkChild)

function beginImportLinger(kind: 'proxy' | 'whisper' = 'proxy'): AbortSignal {
  return importLingers.begin(kind)
}

function ipcError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

function refuseIfExporting(): void {
  if (jobs.kind === 'export') throw new JobBusy('export')
}

app.whenReady().then(() => {
  protocol.handle('media', (request) => {
    const url = new URL(request.url)
    const filePath = url.searchParams.get('path')
    if (!filePath) return new Response('missing path', { status: 400 })
    // Chromium seeks across edits with HTTP byte ranges. A plain file fetch can
    // play from zero but advertises [0, 0] as seekable on Windows, so serve an
    // explicit 206 response with the requested slice.
    return localMediaResponse(request, filePath)
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('dialog:openMedia', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open recording',
    properties: ['openFile'],
    filters: [
      { name: 'Media', extensions: ['mp4', 'mov', 'mkv', 'webm', 'wav', 'mp3', 'm4a', 'aac'] }
    ]
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:openBroll', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Add B-roll',
    properties: ['openFile'],
    filters: [
      { name: 'B-roll', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'webm'] }
    ]
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:saveText', async (_e, suggested: string) => {
  const result = await dialog.showSaveDialog({
    title: 'Export interchange',
    defaultPath: suggested,
    filters: [
      { name: 'Captions', extensions: ['srt', 'vtt'] },
      { name: 'Transcript', extensions: ['md', 'txt'] },
      { name: 'Chapters', extensions: ['json'] },
      { name: 'OpenTimelineIO', extensions: ['otio'] },
      { name: 'Final Cut XML', extensions: ['fcpxml'] },
      { name: 'Premiere XML', extensions: ['xml'] },
      { name: 'Auto-Editor', extensions: ['json'] },
      { name: 'Shotcut MLT', extensions: ['mlt'] },
      { name: 'Kdenlive', extensions: ['kdenlive'] }
    ]
  })
  return result.canceled ? null : result.filePath
})

ipcMain.handle('fs:writeText', async (_e, path: string, body: string) => {
  await writeFile(path, body)
  return path
})

ipcMain.handle('dialog:openProject', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open project',
    properties: ['openFile'],
    filters: [{ name: 'SpeechEdit', extensions: ['speechedit.json', 'json'] }]
  })
  if (result.canceled || !result.filePaths[0]) return null
  const raw = await readFile(result.filePaths[0], 'utf8')
  return { path: result.filePaths[0], project: JSON.parse(raw) }
})

async function writeAtomic(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, body, 'utf8')
  try {
    await rename(tmp, path)
  } catch {
    await writeFile(path, body, 'utf8')
    await rm(tmp, { force: true }).catch(() => undefined)
  }
}

ipcMain.handle('dialog:saveProject', async (_e, project: unknown, defaultPath?: string) => {
  const result = await dialog.showSaveDialog({
    title: 'Save project',
    defaultPath: defaultPath || 'project.speechedit.json',
    filters: [{ name: 'SpeechEdit', extensions: ['speechedit.json', 'json'] }]
  })
  if (result.canceled || !result.filePath) return null
  await writeAtomic(result.filePath, JSON.stringify(project, null, 2))
  return result.filePath
})

ipcMain.handle('project:write', async (_e, path: string, project: unknown) => {
  await writeAtomic(path, JSON.stringify(project, null, 2))
  return path
})

ipcMain.handle('project:read', async (_e, path: string) => {
  if (!existsSync(path)) return null
  return { path, project: JSON.parse(await readFile(path, 'utf8')) }
})

ipcMain.handle('workspace:sync', async (_e, payload: { project: unknown; recovery: unknown; session: unknown }) => {
  const dir = syncDir()
  await writeAtomic(join(dir, 'current.speechedit.json'), JSON.stringify(payload.project, null, 2))
  await writeAtomic(join(dir, 'recovery.speechedit.json'), JSON.stringify(payload.recovery, null, 2))
  await writeAtomic(join(dir, 'session.json'), JSON.stringify(payload.session, null, 2))
  return dir
})

ipcMain.handle('workspace:recovery', async () => {
  const path = join(syncDir(), 'recovery.speechedit.json')
  if (!existsSync(path)) return null
  return JSON.parse(await readFile(path, 'utf8'))
})

ipcMain.handle('workspace:clearRecovery', async () => {
  const path = join(syncDir(), 'recovery.speechedit.json')
  if (existsSync(path)) await rm(path, { force: true })
})

ipcMain.handle('workspace:session', async () => {
  const path = join(syncDir(), 'session.json')
  if (!existsSync(path)) return { lastDocumentPath: null, lastSavedAt: null }
  return JSON.parse(await readFile(path, 'utf8'))
})

ipcMain.handle('fs:exists', async (_e, paths: string[]) =>
  paths.map((path) => ({ path, exists: Boolean(path) && existsSync(path) }))
)

ipcMain.handle('dialog:export', async () => {
  const result = await dialog.showSaveDialog({
    title: 'Export program',
    defaultPath: 'program.mp4',
    filters: [{ name: 'MP4', extensions: ['mp4'] }]
  })
  return result.canceled ? null : result.filePath
})

ipcMain.handle('dialog:openInterchange', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Import timeline',
    properties: ['openFile'],
    filters: [
      { name: 'Timelines', extensions: ['otio', 'fcpxml', 'mlt', 'kdenlive', 'json', 'xml', 'srt', 'vtt'] }
    ]
  })
  if (result.canceled || !result.filePaths[0]) return null
  const path = result.filePaths[0]
  const text = await readFile(path, 'utf8')
  return { path, text, name: path.split(/[\\/]/).pop() ?? 'timeline' }
})

ipcMain.handle('dialog:openTranscript', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open transcript',
    properties: ['openFile'],
    filters: [{ name: 'Transcript', extensions: ['json', 'srt', 'vtt'] }]
  })
  if (result.canceled || !result.filePaths[0]) return null
  const path = result.filePaths[0]
  const text = await readFile(path, 'utf8')
  return { path, text, name: path.split(/[\\/]/).pop() ?? 'transcript' }
})

ipcMain.handle('media:job-begin', (_e, kind: unknown) => {
  const job = asMediaJobKind(kind)
  if (!job) throw new Error('Unknown media job.')
  jobs.start(job)
})
ipcMain.handle('media:job-end', (_e, kind?: unknown) => {
  jobs.finish(asMediaJobKind(kind) ?? undefined)
})
ipcMain.handle('media:job-cancel', (_e, kind?: unknown) => {
  const job = asMediaJobKind(kind) ?? undefined
  jobs.cancel(job)
  if (!job || job === 'import') importLingers.abortAll()
})
ipcMain.handle('media:job-busy', () => jobs.kind)

ipcMain.handle('media:probe', async (_e, file: string) => {
  refuseIfExporting()
  return probe(file, jobs.signal)
})
ipcMain.handle('media:proxyGop', async (_e, file: string) => {
  refuseIfExporting()
  return probeProxyGop(file, jobs.signal)
})
ipcMain.handle('media:proxy', async (_e, file: string) => {
  try {
    return await runWhenExportIdle(jobs, importLingers, (signal) =>
      makeProxy(file, proxyCachePath(file), signal)
    )
  } catch (err) {
    throw ipcError(err)
  }
})
ipcMain.handle('media:waveform', async (_e, file: string) => {
  refuseIfExporting()
  return waveform(file, undefined, jobs.signal)
})
ipcMain.handle('media:silence', async (_e, file: string) => {
  refuseIfExporting()
  return detectSilence(file, '-30dB', 0.35, jobs.signal)
})
ipcMain.handle('media:scenes', async (_e, file: string) => {
  refuseIfExporting()
  return detectScenes(file, jobs.signal)
})
ipcMain.handle('media:loudness', async (_e, file: string) => {
  refuseIfExporting()
  return detectLoudness(file, jobs.signal)
})
ipcMain.handle(
  'media:transcribe',
  async (
    e,
    file: string,
    opts?: { kind?: string; baseUrl?: string; model?: string; apiKey?: string; force?: boolean; skipInstall?: boolean }
  ) => {
  const signal = beginImportLinger('whisper')
  try {
    return await transcribeMedia(
      file,
      opts,
      (info) => {
        e.sender.send('media:transcribe-progress', info)
      },
      signal,
      (child) => importLingers.adopt(signal, child)
    )
  } catch (err) {
    throw ipcError(err)
  } finally {
    importLingers.finish(signal)
  }
})
ipcMain.handle('media:asrPath', async () => listAsrPath())

function modelRequestLabel(req: {
  label?: string
  messages: { role: string; content: string }[]
}): string {
  if (req.label?.trim()) return req.label.trim().slice(0, 72)
  const system = req.messages.find((message) => message.role === 'system')?.content ?? ''
  const user = [...req.messages].reverse().find((message) => message.role === 'user')?.content ?? ''
  const firstLine = user.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''
  if (/editorial intelligence for SpeechEdit/i.test(system)) return 'Analyze scenes and retakes'
  if (/edit a SpeechEdit reel by calling tools/i.test(system)) {
    return firstLine ? `Plan edit · ${firstLine.slice(0, 50)}` : 'Plan an edit'
  }
  return firstLine ? `Assistant · ${firstLine.slice(0, 52)}` : 'Assistant request'
}

ipcMain.handle(
  'model:complete',
  async (
    _e,
    req: {
      endpoint: { kind?: string; baseUrl?: string; model?: string; apiKey?: string }
      messages: { role: string; content: string }[]
      label?: string
    }
  ) => modelQueue.enqueue(() => completeChat(req.endpoint, req.messages), { label: modelRequestLabel(req) })
)
ipcMain.handle('model:queue-status', () => modelQueue.status())
ipcMain.handle(
  'model:list',
  async (_e, endpoint: { kind?: string; baseUrl?: string; model?: string; apiKey?: string }) => listChatModels(endpoint)
)
ipcMain.handle(
  'model:test',
  async (_e, endpoint: { kind?: string; baseUrl?: string; model?: string; apiKey?: string }) =>
    modelQueue.enqueue(() => testChatEndpoint(endpoint), {
      label: `Test connection · ${endpoint.model || endpoint.kind || 'model'}`
    })
)

function syncDir(): string {
  return join(homedir(), '.speechedit')
}

function mcpBridgeDir(): string {
  return join(syncDir(), 'mcp-bridge')
}

async function writeMcpHeartbeat(): Promise<void> {
  if (!BrowserWindow.getAllWindows().some((window) => !window.isDestroyed())) return
  const dir = mcpBridgeDir()
  await mkdir(dir, { recursive: true })
  await writeAtomic(join(dir, 'heartbeat.json'), JSON.stringify({ at: Date.now(), pid: process.pid }))
}

const mcpHeartbeat = setInterval(() => void writeMcpHeartbeat().catch(() => undefined), 1_000)
mcpHeartbeat.unref()

ipcMain.handle('mcp:poll', async () => {
  await writeMcpHeartbeat()
  const dir = mcpBridgeDir()
  await mkdir(dir, { recursive: true })
  const names = (await readdir(dir)).filter((name) => /^[a-f0-9-]+\.request\.json$/i.test(name)).sort()
  const requests: { id: string; name: string; args: Record<string, unknown> }[] = []
  for (const name of names) {
    const id = name.slice(0, -'.request.json'.length)
    const source = join(dir, name)
    const processing = join(dir, `${id}.processing.json`)
    try {
      await rename(source, processing)
      requests.push(JSON.parse(await readFile(processing, 'utf8')))
    } catch {
      /* another poll claimed it or the request was malformed */
    }
  }
  return requests
})

ipcMain.handle(
  'mcp:resolve',
  async (_e, response: { id: string; message: string; data?: unknown; isError?: boolean }) => {
    if (!/^[a-f0-9-]+$/i.test(response.id)) throw new Error('Invalid MCP bridge request id.')
    const dir = mcpBridgeDir()
    await writeAtomic(join(dir, `${response.id}.response.json`), JSON.stringify(response))
    await rm(join(dir, `${response.id}.processing.json`), { force: true })
  }
)

ipcMain.handle('project:sync', async (_e, project: unknown) => {
  const path = join(syncDir(), 'current.speechedit.json')
  await writeAtomic(path, JSON.stringify(project, null, 2))
  return path
})
ipcMain.handle('settings:sync', async (_e, settings: unknown) => {
  const dir = syncDir()
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'settings.json')
  await writeFile(path, JSON.stringify(settings, null, 2))
  return path
})
ipcMain.handle('project:syncPath', async () => join(syncDir(), 'current.speechedit.json'))

ipcMain.handle('media:analyze', async (e, file: string) => {
  refuseIfExporting()
  try {
    return await analyzeMedia(file, jobs.signal, (info) => {
      e.sender.send('media:analyze-progress', info)
    })
  } catch (err) {
    throw ipcError(err)
  }
})

ipcMain.handle('media:thumbnails', async (_e, file: string) => {
  refuseIfExporting()
  return thumbnails(file, 20, jobs.signal)
})
ipcMain.handle('media:encoders', async () => detectEncoders())

ipcMain.handle('media:export', async (e, job) => {
  const signal = beginExportExclusive(jobs, importLingers)
  try {
    await exportProgram(job, (info) => {
      e.sender.send('media:export-progress', info)
    }, signal)
    return job.output
  } catch (err) {
    throw ipcError(err)
  } finally {
    endExportExclusive(jobs, importLingers)
  }
})
