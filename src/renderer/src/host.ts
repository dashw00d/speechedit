export interface SpeechHost {
  openMedia: () => Promise<string | null>
  openBroll: () => Promise<string | null>
  chooseTextExport: (suggested: string) => Promise<string | null>
  writeText: (path: string, body: string) => Promise<string>
  openProject: () => Promise<{ path: string; project: unknown } | null>
  openTranscript: () => Promise<{ path: string; text: string; name: string } | null>
  openInterchange: () => Promise<{ path: string; text: string; name: string } | null>
  saveProject: (project: unknown) => Promise<string | null>
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
  }>
  waveform: (file: string) => Promise<number[]>
  thumbnails: (file: string) => Promise<string[]>
  silence: (file: string) => Promise<{ start: number; end: number }[]>
  scenes: (file: string) => Promise<{ times: number[]; staticRegions: { start: number; end: number }[] }>
  loudness: (file: string) => Promise<{ start: number; end: number; lufs: number }[]>
  transcribe: (
    file: string,
    opts?: { kind?: string; baseUrl?: string; model?: string; apiKey?: string }
  ) => Promise<{ text: string; start: number; end: number; speaker?: string }[] | null>
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
  exportProgram: (job: unknown) => Promise<string>
  onExportProgress: (fn: (ratio: number) => void) => () => void
  onAnalyzeProgress: (fn: (info: { stage: string; ratio: number }) => void) => () => void
}

const missing = async () => null
const empty = async () => []

export const host: SpeechHost = window.speech ?? {
  openMedia: missing,
  openBroll: missing,
  chooseTextExport: missing,
  writeText: async () => {
    throw new Error('Save needs the Electron app.')
  },
  openProject: missing,
  openTranscript: missing,
  openInterchange: missing,
  saveProject: missing,
  chooseExport: missing,
  probe: async () => {
    throw new Error('Import needs the Electron app.')
  },
  waveform: empty,
  thumbnails: empty,
  silence: empty,
  scenes: async () => ({ times: [], staticRegions: [] }),
  loudness: empty,
  transcribe: async () => null,
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
  syncProject: async () => '',
  syncSettings: async () => '',
  syncPath: async () => '',
  analyze: async () => ({
    silence: [],
    scenes: { times: [], staticRegions: [] },
    loudness: []
  }),
  encoders: async () => [{ id: 'libx264', label: 'x264 (CPU)', hardware: false }],
  exportProgram: async () => {
    throw new Error('Export needs the Electron app.')
  },
  onExportProgress: () => () => undefined,
  onAnalyzeProgress: () => () => undefined
}

export function mediaUrl(filePath: string): string {
  if (!filePath) return ''
  if (filePath.startsWith('blob:') || filePath.startsWith('http')) return filePath
  return `media://local/?path=${encodeURIComponent(filePath)}`
}

export const isElectron = Boolean(window.speech)
