import type { ModelEndpoint, ProviderKind } from './settings'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ApiWord {
  text: string
  start: number
  end: number
}

export type TranscriptBackend = 'cli' | 'http' | 'off'

export interface TranscriptProvider {
  id: string
  label: string
  kind: ProviderKind
  backend: TranscriptBackend
  binaries: string[]
  hint: string
}

export interface IntelligenceProvider {
  id: string
  label: string
  kind: ProviderKind
  hint: string
}

/** Local OSS CLIs plus OpenAI-compatible HTTP. Main process maps `kind` → spawn/fetch. */
export const TRANSCRIPT_PROVIDERS: TranscriptProvider[] = [
  {
    id: 'whisper-cli',
    label: 'Whisper CLI (PATH)',
    kind: 'whisper-cli',
    backend: 'cli',
    binaries: ['whisper', 'whisper-ctranslate2'],
    hint: 'openai-whisper or ctranslate2 on PATH. Word timestamps when the CLI writes JSON.'
  },
  {
    id: 'whisper-cpp',
    label: 'whisper.cpp (local OSS)',
    kind: 'whisper-cpp',
    backend: 'cli',
    binaries: ['whisper-cli', 'whisper-cpp', 'whisper.cpp'],
    hint: 'ggerganov/whisper.cpp. SpeechEdit tries whisper-cli -oj first.'
  },
  {
    id: 'faster-whisper',
    label: 'faster-whisper (local OSS)',
    kind: 'faster-whisper',
    backend: 'cli',
    binaries: ['faster-whisper'],
    hint: 'Local faster-whisper CLI. Same JSON shape as Whisper.'
  },
  {
    id: 'local-http',
    label: 'Local OpenAI-compatible ASR',
    kind: 'openai-compatible',
    backend: 'http',
    binaries: [],
    hint: 'Speaches, faster-whisper-server, or any /v1/audio/transcriptions.'
  },
  {
    id: 'groq',
    label: 'Groq Whisper',
    kind: 'openai-compatible',
    backend: 'http',
    binaries: [],
    hint: 'HTTP API. Same command bus after words land.'
  },
  {
    id: 'openai',
    label: 'OpenAI Whisper',
    kind: 'openai-compatible',
    backend: 'http',
    binaries: [],
    hint: 'HTTP API. Project JSON stays the source of truth.'
  }
]

export const INTELLIGENCE_PROVIDERS: IntelligenceProvider[] = [
  { id: 'off', label: 'Off (local heuristics)', kind: 'off', hint: 'Scenes/retakes from the transcript. No network.' },
  { id: 'ollama', label: 'Ollama (local OSS)', kind: 'openai-compatible', hint: 'http://127.0.0.1:11434/v1' },
  { id: 'local', label: 'Local OpenAI-compatible', kind: 'openai-compatible', hint: 'llama.cpp, vLLM, LM Studio…' },
  { id: 'groq', label: 'Groq', kind: 'openai-compatible', hint: 'Hosted OpenAI-compatible chat.' },
  { id: 'openai', label: 'OpenAI', kind: 'openai-compatible', hint: 'Hosted chat. Returns inspectable commands.' }
]

export function transcriptReady(endpoint: ModelEndpoint): boolean {
  if (endpoint.kind === 'openai-compatible') return Boolean(endpoint.baseUrl && endpoint.model)
  return endpoint.kind === 'whisper-cli' || endpoint.kind === 'whisper-cpp' || endpoint.kind === 'faster-whisper'
}

export function endpointReady(endpoint: ModelEndpoint): boolean {
  return endpoint.kind === 'openai-compatible' && Boolean(endpoint.baseUrl && endpoint.model)
}

export function cliBinariesFor(kind: ProviderKind): string[] {
  return TRANSCRIPT_PROVIDERS.find((p) => p.kind === kind)?.binaries ?? ['whisper', 'whisper-ctranslate2', 'faster-whisper']
}

export async function completeOpenAI(
  endpoint: ModelEndpoint,
  messages: ChatMessage[],
  json = true
): Promise<string> {
  if (!endpointReady(endpoint)) throw new Error('Intelligence endpoint is not configured.')
  const url = `${endpoint.baseUrl.replace(/\/$/, '')}/chat/completions`
  const body: Record<string, unknown> = {
    model: endpoint.model,
    messages,
    temperature: 0.2
  }
  if (json) body.response_format = { type: 'json_object' }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (endpoint.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText)
    throw new Error(`Model ${res.status}: ${detail.slice(0, 240)}`)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('Model returned an empty reply.')
  return text
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced?.[1] ?? text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Model reply was not JSON.')
  return JSON.parse(raw.slice(start, end + 1))
}

export async function transcribeOpenAI(
  endpoint: ModelEndpoint,
  file: Blob,
  filename = 'audio.wav'
): Promise<ApiWord[]> {
  if (!endpointReady(endpoint)) throw new Error('Transcript endpoint is not configured.')
  const url = `${endpoint.baseUrl.replace(/\/$/, '')}/audio/transcriptions`
  const body = new FormData()
  body.append('file', file, filename)
  body.append('model', endpoint.model)
  body.append('response_format', 'verbose_json')
  body.append('timestamp_granularities[]', 'word')
  const headers: Record<string, string> = {}
  if (endpoint.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`
  const res = await fetch(url, { method: 'POST', headers, body })
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText)
    throw new Error(`Transcribe ${res.status}: ${detail.slice(0, 240)}`)
  }
  const data = (await res.json()) as {
    words?: { word?: string; text?: string; start: number; end: number }[]
    segments?: { text: string; start: number; end: number; words?: { word: string; start: number; end: number }[] }[]
  }
  if (data.words?.length) {
    return data.words
      .map((w) => ({
        text: String(w.word ?? w.text ?? '').trim(),
        start: w.start,
        end: w.end
      }))
      .filter((w) => w.text)
  }
  const fromSegs =
    data.segments?.flatMap((seg) =>
      seg.words?.length
        ? seg.words.map((w) => ({ text: w.word.trim(), start: w.start, end: w.end }))
        : [{ text: seg.text.trim(), start: seg.start, end: seg.end }]
    ) ?? []
  return fromSegs.filter((w) => w.text)
}
