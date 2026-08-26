import { JobGate } from '../../shared/mediaJob'
import type { AppIdentity } from '../../shared/appIdentity'
import type { MediaToolsHealth } from '../../shared/mediaTools'
import { ModelQueue, type ModelQueueStatus } from '../../shared/modelQueue'
import type { TranscribeProgress } from '../../shared/asr'
import { WEB_DEMO_INTELLIGENCE } from './lib/settings'
import {
  browserMediaForPath,
  registerBrowserMedia as persistBrowserMedia
} from './lib/browserMediaStore'

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
  probeProxyGop: (file: string) => Promise<number>
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
    endpoint: { kind?: string; baseUrl?: string; model?: string; apiKey?: string }
    messages: { role: string; content: string }[]
    label?: string
  }) => Promise<string>
  listModels: (endpoint: { kind?: string; baseUrl?: string; model?: string; apiKey?: string }) => Promise<{
    provider: 'ollama' | 'openai-compatible' | 'codex-cli' | 'grok-cli'
    models: {
      id: string
      capabilities: string[]
      parameterSize?: string
      contextLength?: number
      remote?: boolean
      detail?: string
    }[]
  }>
  testModel: (endpoint: { kind?: string; baseUrl?: string; model?: string; apiKey?: string }) => Promise<{
    model: string
    latencyMs: number
    reply: string
  }>
  modelQueueStatus: () => Promise<ModelQueueStatus>
  onModelQueue: (fn: (status: ModelQueueStatus) => void) => () => void
  pollMcp: () => Promise<{ id: string; name: string; args: Record<string, unknown> }[]>
  resolveMcp: (response: { id: string; message: string; data?: unknown; isError?: boolean }) => Promise<void>
  syncProject: (project: unknown) => Promise<string>
  syncSettings: (settings: unknown) => Promise<string>
  syncPath: () => Promise<string>
  analyze: (file: string) => Promise<{
    silence: { start: number; end: number }[]
    scenes: { times: number[]; staticRegions: { start: number; end: number }[] }
    loudness: { start: number; end: number; lufs: number }[]
  }>
  encoders: () => Promise<{ id: string; label: string; hardware: boolean }[]>
  mediaHealth: () => Promise<MediaToolsHealth>
  appIdentity: () => Promise<AppIdentity>
  beginJob: (kind: 'export' | 'import') => Promise<void>
  endJob: (kind?: 'export' | 'import') => Promise<void>
  cancelJob: (kind?: 'export' | 'import') => Promise<void>
  exportProgram: (job: unknown) => Promise<string>
  onExportProgress: (fn: (info: { ratio: number; stage: string }) => void) => () => void
  onAnalyzeProgress: (fn: (info: { stage: string; ratio: number }) => void) => () => void
  onTranscribeProgress: (fn: (info: TranscribeProgress) => void) => () => void
}

const missing = async () => null
const empty = async () => []

async function webAppVersion(): Promise<string> {
  const fromEnv = (globalThis as { process?: { env?: { SPEECHEDIT_VERSION?: string } } }).process?.env
    ?.SPEECHEDIT_VERSION
  if (fromEnv?.trim()) return fromEnv.trim()
  return '0.1.0'
}

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

export function registerBrowserMedia(file: File): Promise<string> {
  return persistBrowserMedia(file)
}

export function mediaDisplayName(filePath: string): string {
  return browserMediaForPath(filePath)?.name ?? filePath.split(/[\\/]/).pop() ?? 'Recording'
}

function pickBrowserMedia(accept: string): Promise<string | null> {
  if (typeof document === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    const finish = (value: string | null) => {
      input.removeEventListener('cancel', onCancel)
      resolve(value)
    }
    const onCancel = () => finish(null)
    input.addEventListener('cancel', onCancel)
    input.onchange = async () => {
      const file = input.files?.[0]
      finish(file ? await registerBrowserMedia(file) : null)
    }
    input.click()
  })
}

async function probeBrowserMedia(filePath: string): Promise<{
  duration: number
  width?: number
  height?: number
  hasVideo: boolean
  hasAudio: boolean
}> {
  if (typeof document === 'undefined') throw new Error('Open media needs a browser window.')
  const file = browserMediaForPath(filePath)
  const hasVideo = Boolean(file?.type.startsWith('video/') || /\.(mp4|m4v|mov|mkv|webm|avi)$/i.test(file?.name ?? ''))
  const media = document.createElement(hasVideo ? 'video' : 'audio')
  media.preload = 'metadata'
  media.src = filePath
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('The browser took too long to read that recording.')), 15_000)
      const finish = (fn: () => void) => {
        window.clearTimeout(timer)
        media.removeEventListener('loadedmetadata', onLoaded)
        media.removeEventListener('error', onError)
        fn()
      }
      const onLoaded = () => finish(resolve)
      const onError = () => finish(() => reject(new Error('This browser cannot decode that media file.')))
      media.addEventListener('loadedmetadata', onLoaded)
      media.addEventListener('error', onError)
    })
    return {
      duration: Number.isFinite(media.duration) ? media.duration : 0,
      ...(hasVideo && media instanceof HTMLVideoElement
        ? { width: media.videoWidth || undefined, height: media.videoHeight || undefined }
        : {}),
      hasVideo,
      // Browsers do not expose a portable audio-track probe. Silent video is
      // harmless here because the waveform decoder below fails soft.
      hasAudio: true
    }
  } finally {
    media.removeAttribute('src')
    media.load()
  }
}

async function browserWaveform(filePath: string, samples = 1800): Promise<number[]> {
  if (typeof window === 'undefined') return []
  const file = browserMediaForPath(filePath)
  if (file && file.size > 500 * 1024 * 1024) return []
  const AudioContextClass = window.AudioContext
  if (!AudioContextClass) return []
  const context = new AudioContextClass()
  try {
    const bytes = await fetch(filePath).then((response) => response.arrayBuffer())
    const audio = await context.decodeAudioData(bytes)
    const channels = Array.from({ length: Math.min(2, audio.numberOfChannels) }, (_, index) => audio.getChannelData(index))
    if (!channels.length) return []
    const size = Math.max(1, Math.floor(audio.length / samples))
    return Array.from({ length: samples }, (_, index) => {
      let peak = 0
      const start = index * size
      const end = index === samples - 1 ? audio.length : Math.min(audio.length, start + size)
      for (const channel of channels) {
        for (let cursor = start; cursor < end; cursor++) peak = Math.max(peak, Math.abs(channel[cursor] ?? 0))
      }
      return Math.min(1, peak)
    })
  } catch {
    return []
  } finally {
    void context.close()
  }
}

const electronHost = typeof window !== 'undefined' ? window.speech : undefined
const webJobs = new JobGate()
const webModelListeners = new Set<(status: ModelQueueStatus) => void>()
const webTranscribeListeners = new Set<(progress: TranscribeProgress) => void>()
const webModelQueue = new ModelQueue((status) => {
  for (const listener of webModelListeners) listener(status)
})

async function webDemoStatus(): Promise<{ available: boolean; model: string; message?: string }> {
  const response = await fetch('/api/demo-ai/status')
  if (!response.ok) throw new Error(`Demo AI status ${response.status}.`)
  return await response.json() as { available: boolean; model: string; message?: string }
}

export const host: SpeechHost = electronHost ?? {
  openMedia: () => pickBrowserMedia('video/*,audio/*,.mkv,.avi'),
  openBroll: () => pickBrowserMedia('image/*,video/*,.mkv,.avi'),
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
      exists: path.startsWith('blob:')
        ? Boolean(browserMediaForPath(path))
        : /^(https?:|data:|media:)/i.test(path)
    })),
  chooseExport: missing,
  probe: probeBrowserMedia,
  makeProxy: async () => '',
  probeProxyGop: async () => 15,
  waveform: browserWaveform,
  thumbnails: empty,
  silence: empty,
  scenes: async () => ({ times: [], staticRegions: [] }),
  loudness: empty,
  transcribe: async (file) => {
    const { transcribeBrowserMedia } = await import('./lib/browserWhisper')
    return transcribeBrowserMedia(file, (progress) => {
      for (const listener of webTranscribeListeners) listener(progress)
    })
  },
  asrPath: async () => [],
  complete: async (req) => {
    const { completeOpenAI } = await import('./lib/providers')
    return webModelQueue.enqueue(() =>
      completeOpenAI(
        WEB_DEMO_INTELLIGENCE,
        req.messages as { role: 'system' | 'user' | 'assistant'; content: string }[]
      ),
      { label: req.label || 'Demo AI' }
    )
  },
  listModels: async () => {
    const status = await webDemoStatus()
    if (!status.available) throw new Error(status.message || 'Demo AI is unavailable on this server.')
    return {
      provider: 'openai-compatible' as const,
      models: [{
        id: status.model || WEB_DEMO_INTELLIGENCE.model,
        capabilities: ['tools', 'structured replies'],
        remote: true,
        detail: 'SpeechEdit Demo AI · free router'
      }]
    }
  },
  testModel: async () => {
    const started = Date.now()
    const { completeOpenAI } = await import('./lib/providers')
    const reply = await webModelQueue.enqueue(() =>
      completeOpenAI(
        WEB_DEMO_INTELLIGENCE,
        [
          { role: 'system', content: 'Return only a JSON object.' },
          { role: 'user', content: 'Return {"status":"SPEECHEDIT_MODEL_OK"}.' }
        ]
      ),
      { label: 'Test Demo AI' }
    )
    try {
      const start = reply.indexOf('{')
      const end = reply.lastIndexOf('}')
      const parsed = JSON.parse(reply.slice(start, end + 1)) as { status?: unknown }
      if (parsed.status !== 'SPEECHEDIT_MODEL_OK') throw new Error('wrong status')
    } catch {
      throw new Error('Model replied, but failed the structured JSON test.')
    }
    return { model: WEB_DEMO_INTELLIGENCE.model, latencyMs: Date.now() - started, reply }
  },
  modelQueueStatus: async () => webModelQueue.status(),
  onModelQueue: (fn) => {
    webModelListeners.add(fn)
    return () => webModelListeners.delete(fn)
  },
  pollMcp: async () => [],
  resolveMcp: async () => undefined,
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
  mediaHealth: async () => ({
    ffmpeg: { name: 'ffmpeg', path: 'ffmpeg', version: null, ok: false },
    ffprobe: { name: 'ffprobe', path: 'ffprobe', version: null, ok: false },
    ok: false,
    message: 'Browser preview is available. Whisper transcription, full media analysis, and export require the desktop app.'
  }),
  appIdentity: async () => ({
    name: 'SpeechEdit',
    version: await webAppVersion(),
    commit: null,
    dirty: false,
    channel: 'web',
    electron: '',
    platform: 'web',
    arch: ''
  }),
  beginJob: async (kind) => {
    webJobs.start(kind)
  },
  endJob: async (kind) => {
    webJobs.finish(kind)
  },
  cancelJob: async (kind) => {
    webJobs.cancel(kind)
    if (!kind || kind === 'import') {
      const { cancelBrowserWhisper } = await import('./lib/browserWhisper')
      cancelBrowserWhisper()
    }
  },
  exportProgram: async () => {
    throw new Error('Export needs the Electron app.')
  },
  onExportProgress: () => () => undefined,
  onAnalyzeProgress: () => () => undefined,
  onTranscribeProgress: (fn) => {
    webTranscribeListeners.add(fn)
    return () => webTranscribeListeners.delete(fn)
  }
}

export function mediaUrl(filePath: string): string {
  if (!filePath) return ''
  if (filePath.startsWith('blob:') || filePath.startsWith('http')) return filePath
  return `media://local/?path=${encodeURIComponent(filePath)}`
}

export const isElectron = Boolean(electronHost)
