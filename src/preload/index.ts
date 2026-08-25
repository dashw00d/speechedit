import { contextBridge, ipcRenderer } from 'electron'

const api = {
  openMedia: () => ipcRenderer.invoke('dialog:openMedia') as Promise<string | null>,
  openBroll: () => ipcRenderer.invoke('dialog:openBroll') as Promise<string | null>,
  chooseTextExport: (suggested: string) =>
    ipcRenderer.invoke('dialog:saveText', suggested) as Promise<string | null>,
  writeText: (path: string, body: string) =>
    ipcRenderer.invoke('fs:writeText', path, body) as Promise<string>,
  openProject: () =>
    ipcRenderer.invoke('dialog:openProject') as Promise<{ path: string; project: unknown } | null>,
  openTranscript: () =>
    ipcRenderer.invoke('dialog:openTranscript') as Promise<{
      path: string
      text: string
      name: string
    } | null>,
  openInterchange: () =>
    ipcRenderer.invoke('dialog:openInterchange') as Promise<{
      path: string
      text: string
      name: string
    } | null>,
  saveProject: (project: unknown) =>
    ipcRenderer.invoke('dialog:saveProject', project) as Promise<string | null>,
  chooseExport: () => ipcRenderer.invoke('dialog:export') as Promise<string | null>,
  probe: (file: string) => ipcRenderer.invoke('media:probe', file),
  waveform: (file: string) => ipcRenderer.invoke('media:waveform', file),
  thumbnails: (file: string) => ipcRenderer.invoke('media:thumbnails', file) as Promise<string[]>,
  silence: (file: string) => ipcRenderer.invoke('media:silence', file),
  scenes: (file: string) => ipcRenderer.invoke('media:scenes', file),
  loudness: (file: string) => ipcRenderer.invoke('media:loudness', file),
  transcribe: (file: string, opts?: { kind?: string; baseUrl?: string; model?: string; apiKey?: string }) =>
    ipcRenderer.invoke('media:transcribe', file, opts),
  complete: (req: {
    endpoint: { baseUrl?: string; model?: string; apiKey?: string }
    messages: { role: string; content: string }[]
  }) => ipcRenderer.invoke('model:complete', req) as Promise<string>,
  syncProject: (project: unknown) => ipcRenderer.invoke('project:sync', project) as Promise<string>,
  syncSettings: (settings: unknown) => ipcRenderer.invoke('settings:sync', settings) as Promise<string>,
  syncPath: () => ipcRenderer.invoke('project:syncPath') as Promise<string>,
  analyze: (file: string) => ipcRenderer.invoke('media:analyze', file),
  encoders: () => ipcRenderer.invoke('media:encoders'),
  exportProgram: (job: unknown) => ipcRenderer.invoke('media:export', job) as Promise<string>,
  onExportProgress: (fn: (ratio: number) => void) => {
    const listener = (_e: unknown, ratio: number) => fn(ratio)
    ipcRenderer.on('media:export-progress', listener)
    return () => ipcRenderer.removeListener('media:export-progress', listener)
  },
  onAnalyzeProgress: (fn: (info: { stage: string; ratio: number }) => void) => {
    const listener = (_e: unknown, info: { stage: string; ratio: number }) => fn(info)
    ipcRenderer.on('media:analyze-progress', listener)
    return () => ipcRenderer.removeListener('media:analyze-progress', listener)
  }
}

contextBridge.exposeInMainWorld('speech', api)

export type SpeechAPI = typeof api
