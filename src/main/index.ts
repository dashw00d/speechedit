import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { asMediaJobKind, JobBusy, JobGate } from '../shared/mediaJob'
import {
  detectEncoders,
  detectLoudness,
  detectScenes,
  detectSilence,
  exportProgram,
  probe,
  thumbnails,
  completeChat,
  listAsrPath,
  transcribeMedia,
  waveform
} from './ffmpeg'

const here = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url))
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
  })
  return win
}

const jobs = new JobGate()

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
    return net.fetch(pathToFileURL(filePath).href)
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
  jobs.cancel(asMediaJobKind(kind) ?? undefined)
})
ipcMain.handle('media:job-busy', () => jobs.kind)

ipcMain.handle('media:probe', async (_e, file: string) => {
  refuseIfExporting()
  return probe(file, jobs.signal)
})
ipcMain.handle('media:waveform', async (_e, file: string) => {
  refuseIfExporting()
  return waveform(file, 1800, jobs.signal)
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
ipcMain.handle('media:transcribe', async (e, file: string, opts?: { kind?: string; baseUrl?: string; model?: string; apiKey?: string }) => {
  refuseIfExporting()
  try {
    return await transcribeMedia(file, opts, (info) => {
      e.sender.send('media:transcribe-progress', info)
    }, jobs.signal)
  } catch (err) {
    throw ipcError(err)
  }
})
ipcMain.handle('media:asrPath', async () => listAsrPath())
ipcMain.handle(
  'model:complete',
  async (
    _e,
    req: { endpoint: { baseUrl?: string; model?: string; apiKey?: string }; messages: { role: string; content: string }[] }
  ) => completeChat(req.endpoint, req.messages)
)

function syncDir(): string {
  return join(homedir(), '.speechedit')
}

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
  const signal = jobs.signal
  try {
    e.sender.send('media:analyze-progress', { stage: 'silence', ratio: 0.15 })
    const silence = await detectSilence(file, '-30dB', 0.35, signal)
    e.sender.send('media:analyze-progress', { stage: 'motion', ratio: 0.45 })
    const scenes = await detectScenes(file, signal).catch((err) => {
      if (err instanceof Error && /cancelled/i.test(err.message)) throw err
      return { times: [], staticRegions: [] }
    })
    e.sender.send('media:analyze-progress', { stage: 'loudness', ratio: 0.7 })
    const loudness = await detectLoudness(file, signal).catch((err) => {
      if (err instanceof Error && /cancelled/i.test(err.message)) throw err
      return []
    })
    e.sender.send('media:analyze-progress', { stage: 'done', ratio: 1 })
    return { silence, scenes, loudness }
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
  const signal = jobs.start('export')
  try {
    await exportProgram(job, (info) => {
      e.sender.send('media:export-progress', info)
    }, signal)
    return job.output
  } catch (err) {
    throw ipcError(err)
  } finally {
    jobs.finish('export')
  }
})
