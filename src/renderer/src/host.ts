import { JobGate } from '../../shared/mediaJob'

export interface SpeechHost {
  openMedia: () => Promise<string | null>
  openBroll: () => Promise<string | null>
  chooseTextExport: (suggested: string) => Promise<string | null>
  writeText: (path: string, body: string) => Promise<string>
  openProject: () => Promise<{ path: string; project: unknown } | null>
  openTranscript: () => Promise<{ path: string; text: string; name: string } | null>
  openInterchange: () => Promise<{ path: string; text: string; name: string } | null>
  saveProject: (project: unknown, defaultPath?: string) => Promise<string | null>
  writeProject: (path: string, project: unknown) => Promise<string>
  readProject: (path: string) => Promise<{ path: string; project: unknown } | null>
  readRecovery: () => Promise<unknown | null>
  clearRecovery: () => Promise<void>
  readSession: () => Promise<{ lastDocumentPath: string | null; lastSavedAt: number | null }>
  syncWorkspace: (payload: {
    project: unknown
    recovery: unknown
    session: unknown
  }) => Promise<string>
  mediaExists: (paths: string[]) => Promise<{ path: string; exists: boolean }[]>
  chooseExport: () => Promise<string | null>
  probe: (file: string) => Promise<{
    duration: number
    width?: number
    height?: number
    fps?: number
    sampleRate?: number
    hasVideo: boolean
    hasAudio: boolean
    codec?: string
    rotation?: 0 | 90 | 180 | 270
    vfr?: boolean
  }>
  makeProxy: (file: string) => Promise<string>
  waveform: (file: string) => Promise<number[]>
  thumbnails: (file: string) => Promise<string[]>
  silence: (file: string) => Promise<{ start: number; end: number }[]>
  scenes: (file: string) => Promise<{ times: number[]; staticRegions: { start: number; end: number }[] }>
  loudness: (file: string) => Promise<{ start: number; end: number; lufs: number }[]>
  transcribe: (
    file: string,
    opts?: { kind?: string; baseUrl?: string; model?: string; apiKey?: string; force?: boolean; skipInstall?: boolean }
  ) => Promise<{ text: string; start: number; end: number; speaker?: string }[] | null>
  asrPath: () => Promise<
    { kind: string; binaries: string[]; found: string[]; available: boolean }[]
  >
  complete: (req: {
    endpoint: { baseUrl?: string; model?: string; apiKey?: string }
    messages: { role: string; content: string }[]
  }) => Promise<string>
  syncProject: (project: unknown) => Promise<string>
  syncSettings: (settings: unknown) => Promise<string>
  syncPath: () => Promise<string>
  analyze: (file: string) => Promise<{
    silence: { start: number; end: number }[]
    scenes: { times: number[]; staticRegions: { start: number; end: number }[] }
    loudness: { start: number; end: number; lufs: number }[]
  }>
  encoders: () => Promise<{ id: string; label: string; hardware: boolean }[]>
  beginJob: (kind: 'export' | 'import') => Promise<void>
  endJob: (kind?: 'export' | 'import') => Promise<void>
  cancelJob: (kind?: 'export' | 'import') => Promise<void>
  exportProgram: (job: unknown) => Promise<string>
  onExportProgress: (fn: (info: { ratio: number; stage: string }) => void) => () => void
  onAnalyzeProgress: (fn: (info: { stage: string; ratio: number }) => void) => () => void
  onTranscribeProgress: (fn: (info: { stage: string; ratio: number }) => void) => () => void
}

const missing = async () => null
const empty = async () => []

function projectName(project: unknown): string {
  if (project && typeof project === 'object') {
    const rec = project as { name?: unknown; project?: { name?: unknown } }
    const nested = rec.project?.name
    const name = typeof nested === 'string' && nested.trim() ? nested : rec.name
    if (typeof name === 'string' && name.trim()) return name.trim()
  }
  return 'project'
}

function downloadBrowserText(filename: string, body: string, mime = 'text/plain'): void {
  if (typeof document === 'undefined') throw new Error('Save needs a browser window.')
  const blob = new Blob([body], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function pickBrowserFile(accept: string): Promise<{ name: string; text: string } | null> {
  if (typeof document === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    const finish = (value: { name: string; text: string } | null) => {
      input.removeEventListener('cancel', onCancel)
      resolve(value)
    }
    const onCancel = () => finish(null)
    input.addEventListener('cancel', onCancel)
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        finish(null)
        return
      }
      finish({ name: file.name, text: await file.text() })
    }
    input.click()
  })
}

const electronHost = typeof window !== 'undefined' ? window.speech : undefined
const webJobs = new JobGate()

export const host: SpeechHost = electronHost ?? {
  openMedia: missing,
  openBroll: missing,
  chooseTextExport: missing,
  writeText: async () => {
    throw new Error('Save needs the Electron app.')
  },
  openProject: async () => {
    const file = await pickBrowserFile('.json,application/json')
    if (!file) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(file.text)
    } catch {
      throw new Error('That file is not JSON.')
    }
    const { parseProjectDocument } = await import('./lib/projectDocument')
    const { project } = parseProjectDocument(parsed)
    return { path: file.name, project }
  },
  openTranscript: async () => {
    const file = await pickBrowserFile('.json,.srt,.vtt,application/json,text/vtt')
    if (!file) return null
    return { path: file.name, text: file.text, name: file.name }
  },
  openInterchange: async () => {
    const file = await pickBrowserFile('.otio,.fcpxml,.mlt,.kdenlive,.json,.xml,.srt,.vtt')
    if (!file) return null
    return { path: file.name, text: file.text, name: file.name }
  },
  saveProject: async (project, defaultPath) => {
    const { isProjectShape, serializeDocument, suggestedDocumentName } = await import('./lib/projectDocument')
    const filename =
      defaultPath?.split(/[\\/]/).pop() ||
      (isProjectShape(project) ? suggestedDocumentName(project) : `${projectName(project)}.speechedit.json`)
    const body = isProjectShape(project) ? serializeDocument(project) : project
    downloadBrowserText(filename, JSON.stringify(body, null, 2), 'application/json')
    return filename
  },
  writeProject: async (path, project) => {
    const name = path.split(/[\\/]/).pop() || `${projectName(project)}.speechedit.json`
    const { isProjectShape, serializeDocument } = await import('./lib/projectDocument')
    const body = isProjectShape(project) ? serializeDocument(project, path) : project
    downloadBrowserText(name, JSON.stringify(body, null, 2), 'application/json')
    return path
  },
  readProject: async () => null,
  readRecovery: async () => {
    if (typeof localStorage === 'undefined') return null
    try {
      const raw = localStorage.getItem('speechedit:recovery')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  },
  clearRecovery: async () => {
    try {
      localStorage.removeItem('speechedit:recovery')
    } catch {
      /* ignore */
    }
  },
  readSession: async () => {
    if (typeof localStorage === 'undefined') return { lastDocumentPath: null, lastSavedAt: null }
    try {
      const raw = localStorage.getItem('speechedit:session')
      if (!raw) return { lastDocumentPath: null, lastSavedAt: null }
      const rec = JSON.parse(raw) as { lastDocumentPath?: string | null; lastSavedAt?: number | null }
      return { lastDocumentPath: rec.lastDocumentPath ?? null, lastSavedAt: rec.lastSavedAt ?? null }
    } catch {
      return { lastDocumentPath: null, lastSavedAt: null }
    }
  },
  syncWorkspace: async (payload) => {
    try {
      if (payload.recovery) localStorage.setItem('speechedit:recovery', JSON.stringify(payload.recovery))
      if (payload.session) localStorage.setItem('speechedit:session', JSON.stringify(payload.session))
    } catch {
      /* ignore quota */
    }
    return ''
  },
  mediaExists: async (paths) =>
    paths.map((path) => ({
      path,
      exists: /^(blob:|https?:|data:|media:)/i.test(path)
    })),
  chooseExport: missing,
  probe: async () => {
    throw new Error('Import needs the Electron app.')
  },
  makeProxy: async () => '',
  waveform: empty,
  thumbnails: empty,
  silence: empty,
  scenes: async () => ({ times: [], staticRegions: [] }),
  loudness: empty,
  transcribe: async () => null,
  asrPath: async () => [],
  complete: async (req) => {
    const { completeOpenAI } = await import('./lib/providers')
    return completeOpenAI(
      {
        kind: 'openai-compatible',
        baseUrl: req.endpoint.baseUrl || '',
        model: req.endpoint.model || '',
        apiKey: req.endpoint.apiKey || ''
      },
      req.messages as { role: 'system' | 'user' | 'assistant'; content: string }[]
    )
  },
  syncProject: async (project) => host.syncWorkspace({
    project,
    recovery: project,
    session: { lastDocumentPath: null, lastSavedAt: null }
  }),
  syncSettings: async () => '',
  syncPath: async () => '',
  analyze: async () => ({
    silence: [],
    scenes: { times: [], staticRegions: [] },
    loudness: []
  }),
  encoders: async () => [{ id: 'libx264', label: 'x264 (CPU)', hardware: false }],
  beginJob: async (kind) => {
    webJobs.start(kind)
  },
  endJob: async (kind) => {
    webJobs.finish(kind)
  },
  cancelJob: async (kind) => {
    webJobs.cancel(kind)
  },
  exportProgram: async () => {
    throw new Error('Export needs the Electron app.')
  },
  onExportProgress: () => () => undefined,
  onAnalyzeProgress: () => () => undefined,
  onTranscribeProgress: () => () => undefined
}

export function mediaUrl(filePath: string): string {
  if (!filePath) return ''
  if (filePath.startsWith('blob:') || filePath.startsWith('http')) return filePath
  return `media://local/?path=${encodeURIComponent(filePath)}`
}

export const isElectron = Boolean(electronHost)
