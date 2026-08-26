import {
  DEFAULT_TRANSCRIPT_KIND,
  TRANSCRIPT_PROVIDERS,
  coerceTranscriptKind,
  type TranscriptKind
} from '../../../shared/asr'

export type IntelligenceKind = 'off' | 'openai-compatible' | 'codex-cli' | 'grok-cli'
export type ProviderKind = TranscriptKind | 'codex-cli' | 'grok-cli'

interface EndpointBase {
  baseUrl: string
  model: string
  apiKey: string
}

export interface TranscriptEndpoint extends EndpointBase {
  kind: TranscriptKind
}

export interface ModelEndpoint extends EndpointBase {
  kind: ProviderKind
}

export interface AppSettings {
  transcript: TranscriptEndpoint
  intelligence: ModelEndpoint
}

export const DEFAULT_SETTINGS: AppSettings = {
  transcript: {
    kind: DEFAULT_TRANSCRIPT_KIND,
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: '',
    apiKey: ''
  },
  intelligence: {
    kind: 'off',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    apiKey: ''
  }
}

export const TRANSCRIPT_PRESETS = TRANSCRIPT_PROVIDERS.map((p) => ({
  id: p.id,
  label: p.label,
  kind: p.kind,
  baseUrl: p.baseUrl,
  model: p.model,
  hint: p.hint
}))

export const INTEL_PRESETS = [
  { id: 'off', label: 'Off', kind: 'off' as const, baseUrl: '', model: '' },
  {
    id: 'codex-cli',
    label: 'Codex CLI',
    kind: 'codex-cli' as const,
    baseUrl: '',
    model: ''
  },
  {
    id: 'grok-cli',
    label: 'Grok CLI',
    kind: 'grok-cli' as const,
    baseUrl: '',
    model: ''
  },
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

/** Old factory default: Whisper CLI + OpenAI model name, never a real user choice. */
export function isLegacyFactoryTranscript(patch?: Partial<TranscriptEndpoint>): boolean {
  if (!patch) return true
  if (patch.kind && patch.kind !== 'whisper-cli') return false
  const model = patch.model ?? 'whisper-1'
  return model === 'whisper-1' && !patch.apiKey
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return cloneSettings(DEFAULT_SETTINGS)
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const next = {
      transcript: isLegacyFactoryTranscript(parsed.transcript)
        ? { ...DEFAULT_SETTINGS.transcript }
        : normalizeTranscriptEndpoint(DEFAULT_SETTINGS.transcript, parsed.transcript),
      intelligence: normalizeIntelligenceEndpoint(DEFAULT_SETTINGS.intelligence, parsed.intelligence)
    }
    if (isLegacyFactoryTranscript(parsed.transcript)) persistSettings(next)
    return next
  } catch {
    return cloneSettings(DEFAULT_SETTINGS)
  }
}

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    transcript: { ...settings.transcript },
    intelligence: { ...settings.intelligence }
  }
}

function persistSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    /* ignore */
  }
}

export function coerceIntelligenceKind(value: unknown): IntelligenceKind {
  return value === 'codex-cli' || value === 'grok-cli' || value === 'openai-compatible' ? value : 'off'
}

function normalizeTranscriptEndpoint(
  base: TranscriptEndpoint,
  patch?: Partial<TranscriptEndpoint>
): TranscriptEndpoint {
  const next = { ...base, ...patch }
  return { ...next, kind: coerceTranscriptKind(next.kind) }
}

function normalizeIntelligenceEndpoint(base: ModelEndpoint, patch?: Partial<ModelEndpoint>): ModelEndpoint {
  const next = { ...base, ...patch }
  return { ...next, kind: coerceIntelligenceKind(next.kind) }
}

export function saveSettings(settings: AppSettings): AppSettings {
  const next = {
    transcript: normalizeTranscriptEndpoint(DEFAULT_SETTINGS.transcript, settings.transcript),
    intelligence: normalizeIntelligenceEndpoint(DEFAULT_SETTINGS.intelligence, settings.intelligence)
  }
  persistSettings(next)
  return next
}

export function settingsFromEnv(): AppSettings {
  const env = typeof process !== 'undefined' ? process.env : {}
  return {
    transcript: {
      kind: coerceTranscriptKind(
        env.SPEECHEDIT_TRANSCRIBE_KIND ||
          (env.SPEECHEDIT_TRANSCRIBE_BASE_URL ? 'openai-compatible' : DEFAULT_TRANSCRIPT_KIND)
      ),
      baseUrl: env.SPEECHEDIT_TRANSCRIBE_BASE_URL || DEFAULT_SETTINGS.transcript.baseUrl,
      model: env.SPEECHEDIT_TRANSCRIBE_MODEL || DEFAULT_SETTINGS.transcript.model,
      apiKey: env.SPEECHEDIT_TRANSCRIBE_API_KEY || ''
    },
    intelligence: {
      kind: coerceIntelligenceKind(
        env.SPEECHEDIT_LLM_KIND || (env.SPEECHEDIT_LLM_BASE_URL ? 'openai-compatible' : 'off')
      ),
      baseUrl: env.SPEECHEDIT_LLM_BASE_URL || DEFAULT_SETTINGS.intelligence.baseUrl,
      model: env.SPEECHEDIT_LLM_MODEL || DEFAULT_SETTINGS.intelligence.model,
      apiKey: env.SPEECHEDIT_LLM_API_KEY || env.OPENAI_API_KEY || ''
    }
  }
}
