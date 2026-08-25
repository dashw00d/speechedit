import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
  return win
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
      { name: 'Captions', extensions: ['srt'] },
      { name: 'OpenTimelineIO', extensions: ['otio'] },
      { name: 'Final Cut XML', extensions: ['fcpxml'] },
      { name: 'Auto-Editor', extensions: ['json'] },
      { name: 'Shotcut MLT', extensions: ['mlt'] }
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

ipcMain.handle('dialog:saveProject', async (_e, project: unknown) => {
  const result = await dialog.showSaveDialog({
    title: 'Save project',
    defaultPath: 'project.speechedit.json',
    filters: [{ name: 'SpeechEdit', extensions: ['speechedit.json'] }]
  })
  if (result.canceled || !result.filePath) return null
  await writeFile(result.filePath, JSON.stringify(project, null, 2))
  return result.filePath
})

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
      { name: 'Timelines', extensions: ['otio', 'fcpxml', 'mlt', 'json', 'xml'] }
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

ipcMain.handle('media:probe', async (_e, file: string) => probe(file))
ipcMain.handle('media:waveform', async (_e, file: string) => waveform(file))
ipcMain.handle('media:silence', async (_e, file: string) => detectSilence(file))
ipcMain.handle('media:scenes', async (_e, file: string) => detectScenes(file))
ipcMain.handle('media:loudness', async (_e, file: string) => detectLoudness(file))
ipcMain.handle('media:transcribe', async (e, file: string, opts?: { kind?: string; baseUrl?: string; model?: string; apiKey?: string }) =>
  transcribeMedia(file, opts, (info) => {
    e.sender.send('media:transcribe-progress', info)
  })
)
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
  const dir = syncDir()
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'current.speechedit.json')
  await writeFile(path, JSON.stringify(project, null, 2))
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
  e.sender.send('media:analyze-progress', { stage: 'silence', ratio: 0.15 })
  const silence = await detectSilence(file)
  e.sender.send('media:analyze-progress', { stage: 'motion', ratio: 0.45 })
  const scenes = await detectScenes(file).catch(() => ({ times: [], staticRegions: [] }))
  e.sender.send('media:analyze-progress', { stage: 'loudness', ratio: 0.7 })
  const loudness = await detectLoudness(file).catch(() => [])
  e.sender.send('media:analyze-progress', { stage: 'done', ratio: 1 })
  return { silence, scenes, loudness }
})

ipcMain.handle('media:thumbnails', async (_e, file: string) => thumbnails(file))
ipcMain.handle('media:encoders', async () => detectEncoders())

ipcMain.handle('media:export', async (e, job) => {
  await exportProgram(job, (ratio) => {
    e.sender.send('media:export-progress', ratio)
  })
  return job.output
})
