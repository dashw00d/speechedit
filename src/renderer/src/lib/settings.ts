export type ProviderKind = 'off' | 'whisper-cli' | 'whisper-cpp' | 'faster-whisper' | 'openai-compatible'

export interface ModelEndpoint {
  kind: ProviderKind
  baseUrl: string
  model: string
  apiKey: string
}

export interface AppSettings {
  transcript: ModelEndpoint
  intelligence: ModelEndpoint
}

export const DEFAULT_SETTINGS: AppSettings = {
  transcript: {
    kind: 'whisper-cli',
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'whisper-1',
    apiKey: ''
  },
  intelligence: {
    kind: 'off',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    apiKey: ''
  }
}

export const TRANSCRIPT_PRESETS = [
  { id: 'whisper-cli', label: 'Whisper CLI (PATH)', kind: 'whisper-cli' as const, baseUrl: '', model: '' },
  { id: 'whisper-cpp', label: 'whisper.cpp (local OSS)', kind: 'whisper-cpp' as const, baseUrl: '', model: '' },
  {
    id: 'faster-whisper',
    label: 'faster-whisper (local OSS)',
    kind: 'faster-whisper' as const,
    baseUrl: '',
    model: ''
  },
  {
    id: 'local',
    label: 'Local OpenAI-compatible',
    kind: 'openai-compatible' as const,
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'whisper-1'
  },
  {
    id: 'groq',
    label: 'Groq Whisper',
    kind: 'openai-compatible' as const,
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3'
  },
  {
    id: 'openai',
    label: 'OpenAI Whisper',
    kind: 'openai-compatible' as const,
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1'
  }
]

export const INTEL_PRESETS = [
  { id: 'off', label: 'Off', kind: 'off' as const, baseUrl: '', model: '' },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'openai-compatible' as const,
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1'
  },
  {
    id: 'local',
    label: 'Local OpenAI-compatible',
    kind: 'openai-compatible' as const,
    baseUrl: 'http://127.0.0.1:8080/v1',
    model: 'local-model'
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compatible' as const,
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-compatible' as const,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  }
]

const KEY = 'speechedit:settings'

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      transcript: { ...DEFAULT_SETTINGS.transcript, ...parsed.transcript },
      intelligence: { ...DEFAULT_SETTINGS.intelligence, ...parsed.intelligence }
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  const next = {
    transcript: { ...DEFAULT_SETTINGS.transcript, ...settings.transcript },
    intelligence: { ...DEFAULT_SETTINGS.intelligence, ...settings.intelligence }
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return next
}

export function settingsFromEnv(): AppSettings {
  const env = typeof process !== 'undefined' ? process.env : {}
  return {
    transcript: {
      kind:
        (env.SPEECHEDIT_TRANSCRIBE_KIND as ModelEndpoint['kind']) ||
        (env.SPEECHEDIT_TRANSCRIBE_BASE_URL ? 'openai-compatible' : 'whisper-cli'),
      baseUrl: env.SPEECHEDIT_TRANSCRIBE_BASE_URL || DEFAULT_SETTINGS.transcript.baseUrl,
      model: env.SPEECHEDIT_TRANSCRIBE_MODEL || DEFAULT_SETTINGS.transcript.model,
      apiKey: env.SPEECHEDIT_TRANSCRIBE_API_KEY || ''
    },
    intelligence: {
      kind:
        (env.SPEECHEDIT_LLM_KIND as ModelEndpoint['kind']) ||
        (env.SPEECHEDIT_LLM_BASE_URL ? 'openai-compatible' : 'off'),
      baseUrl: env.SPEECHEDIT_LLM_BASE_URL || DEFAULT_SETTINGS.intelligence.baseUrl,
      model: env.SPEECHEDIT_LLM_MODEL || DEFAULT_SETTINGS.intelligence.model,
      apiKey: env.SPEECHEDIT_LLM_API_KEY || env.OPENAI_API_KEY || ''
    }
  }
}
