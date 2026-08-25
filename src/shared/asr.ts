/** Provider catalog + ASR JSON parse. Main and renderer share this — no spawn here. */

export type TranscriptKind =
  | 'off'
  | 'whisper-cli'
  | 'faster-whisper'
  | 'whisper-cpp'
  | 'mlx-whisper'
  | 'openai-compatible'

export type TranscriptBackend = 'off' | 'cli' | 'http'

export interface AsrCue {
  text: string
  start: number
  end: number
  speaker?: string
}

export interface TranscribeProgress {
  stage: 'prepare' | 'install' | 'audio' | 'run' | 'parse' | 'done'
  ratio: number
  /** Merged cues so far. Present when a chunked window finishes or a cache hits. */
  cues?: AsrCue[]
  chunk?: { finished: number; total: number }
}

export interface AsrResult {
  cues: AsrCue[]
  /** True when the provider returned word (or token) timestamps. Do not lerp. */
  wordLevel: boolean
  provider: string
}

export interface TranscriptProviderSpec {
  id: string
  kind: TranscriptKind
  label: string
  backend: TranscriptBackend
  binaries: string[]
  hint: string
  baseUrl: string
  model: string
}

export const DEFAULT_TRANSCRIPT_KIND: TranscriptKind = 'whisper-cpp'

export const LOCAL_TRANSCRIPT_KINDS: readonly TranscriptKind[] = [
  'whisper-cpp',
  'whisper-cli',
  'faster-whisper',
  'mlx-whisper'
]

export const TRANSCRIPT_KINDS: readonly TranscriptKind[] = [
  'off',
  'whisper-cli',
  'faster-whisper',
  'whisper-cpp',
  'mlx-whisper',
  'openai-compatible'
]

export const TRANSCRIPT_PROVIDERS: TranscriptProviderSpec[] = [
  {
    id: 'off',
    kind: 'off',
    label: 'Speech islands (no ASR)',
    backend: 'off',
    binaries: [],
    hint: 'Skip Whisper. File → Open media still builds words from silence gaps.',
    baseUrl: '',
    model: ''
  },
  {
    id: 'whisper-cli',
    kind: 'whisper-cli',
    label: 'Whisper CLI (PATH)',
    backend: 'cli',
    binaries: ['whisper', 'whisper-ctranslate2'],
    hint: 'openai-whisper or whisper-ctranslate2. Requests --word_timestamps True.',
    baseUrl: '',
    model: 'base'
  },
  {
    id: 'faster-whisper',
    kind: 'faster-whisper',
    label: 'faster-whisper (local OSS)',
    backend: 'cli',
    binaries: ['faster-whisper'],
    hint: 'Local faster-whisper CLI. Same JSON shape as Whisper when it writes words[].',
    baseUrl: '',
    model: 'base'
  },
  {
    id: 'whisper-cpp',
    kind: 'whisper-cpp',
    label: 'whisper.cpp (local default)',
    backend: 'cli',
    binaries: ['whisper-cli', 'whisper-cpp', 'whisper.cpp'],
    hint: 'Default. Uses ~/.speechedit/opt/whisper-cpp and ggml-tiny.en.bin, or the same binary on PATH.',
    baseUrl: '',
    model: ''
  },
  {
    id: 'mlx-whisper',
    kind: 'mlx-whisper',
    label: 'mlx_whisper (if on PATH)',
    backend: 'cli',
    binaries: ['mlx_whisper', 'mlx-whisper'],
    hint: 'Apple MLX Whisper. Optional — only used when a binary exists.',
    baseUrl: '',
    model: 'mlx-community/whisper-base'
  },
  {
    id: 'local',
    kind: 'openai-compatible',
    label: 'Local OpenAI-compatible',
    backend: 'http',
    binaries: [],
    hint: 'Speaches, faster-whisper-server, or any /v1/audio/transcriptions.',
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'whisper-1'
  },
  {
    id: 'groq',
    kind: 'openai-compatible',
    label: 'Groq Whisper',
    backend: 'http',
    binaries: [],
    hint: 'https://api.groq.com/openai/v1 — verbose_json + word timestamps.',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3'
  },
  {
    id: 'openai',
    kind: 'openai-compatible',
    label: 'OpenAI Whisper',
    backend: 'http',
    binaries: [],
    hint: 'https://api.openai.com/v1 — same Word[] landing path as local OSS.',
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1'
  }
]

export function coerceTranscriptKind(value: unknown): TranscriptKind {
  return TRANSCRIPT_KINDS.includes(value as TranscriptKind)
    ? (value as TranscriptKind)
    : DEFAULT_TRANSCRIPT_KIND
}

export function localTranscriptOrder(kind: TranscriptKind): TranscriptKind[] {
  if (kind === 'off' || kind === 'openai-compatible') return [kind]
  if (!LOCAL_TRANSCRIPT_KINDS.includes(kind)) return [kind]
  return [kind, ...LOCAL_TRANSCRIPT_KINDS.filter((next) => next !== kind)]
}

export function shouldInstallLocalWhisper(kind: TranscriptKind): boolean {
  return LOCAL_TRANSCRIPT_KINDS.includes(kind)
}

export function specForKind(kind: TranscriptKind): TranscriptProviderSpec | undefined {
  return TRANSCRIPT_PROVIDERS.find((p) => p.kind === kind)
}

export function specForPreset(id: string): TranscriptProviderSpec | undefined {
  return TRANSCRIPT_PROVIDERS.find((p) => p.id === id)
}

export function presetIdFor(kind: TranscriptKind, baseUrl: string): string {
  const http = TRANSCRIPT_PROVIDERS.find((p) => p.kind === kind && p.baseUrl && p.baseUrl === baseUrl)
  if (http) return http.id
  return TRANSCRIPT_PROVIDERS.find((p) => p.kind === kind)?.id ?? DEFAULT_TRANSCRIPT_KIND
}

export function cliBinariesFor(kind: TranscriptKind): string[] {
  return specForKind(kind)?.binaries ?? []
}

export function transcriptionsUrl(baseUrl: string): string {
  const root = baseUrl.replace(/\/$/, '')
  if (root.endsWith('/audio/transcriptions')) return root
  return `${root}/audio/transcriptions`
}

export function extractJsonBlob(raw: string): unknown | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function speakerOf(value: unknown): string | undefined {
  const label = typeof value === 'string' ? value.trim() : ''
  return label || undefined
}

function cue(text: unknown, start: unknown, end: unknown, speaker?: unknown): AsrCue | null {
  const trimmed = String(text ?? '').trim()
  const t0 = num(start)
  const t1 = num(end)
  if (!trimmed || t0 == null || t1 == null) return null
  const who = speakerOf(speaker)
  return who
    ? { text: trimmed, start: t0, end: Math.max(t1, t0), speaker: who }
    : { text: trimmed, start: t0, end: Math.max(t1, t0) }
}

function fromWordList(list: unknown): AsrCue[] {
  if (!Array.isArray(list) || !list.length) return []
  const out: AsrCue[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const w = item as { word?: unknown; text?: unknown; start?: unknown; end?: unknown; speaker?: unknown }
    const next = cue(w.word ?? w.text, w.start, w.end, w.speaker)
    if (next) out.push(next)
  }
  return out
}

/** whisper.cpp tokens: offsets in ms, t0/t1 in centiseconds. */
function fromCppTokens(list: unknown): AsrCue[] {
  if (!Array.isArray(list) || !list.length) return []
  const out: AsrCue[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const tok = item as {
      text?: unknown
      word?: unknown
      offsets?: { from?: unknown; to?: unknown }
      t0?: unknown
      t1?: unknown
    }
    const text = tok.text ?? tok.word
    if (tok.offsets && (tok.offsets.from != null || tok.offsets.to != null)) {
      const next = cue(text, Number(tok.offsets.from) / 1000, Number(tok.offsets.to) / 1000)
      if (next && next.text && !/^\[/.test(next.text)) out.push(next)
      continue
    }
    if (tok.t0 != null || tok.t1 != null) {
      const next = cue(text, Number(tok.t0) / 100, Number(tok.t1) / 100)
      if (next && next.text && !/^\[/.test(next.text)) out.push(next)
    }
  }
  return out
}

function segmentWordLists(data: Record<string, unknown>): AsrCue[] {
  const segs = data.segments
  if (!Array.isArray(segs)) return []
  const out: AsrCue[] = []
  let anyWords = false
  for (const seg of segs) {
    if (!seg || typeof seg !== 'object') continue
    const s = seg as { words?: unknown; tokens?: unknown; speaker?: unknown }
    const words = fromWordList(s.words).map((w) =>
      w.speaker || !speakerOf(s.speaker) ? w : { ...w, speaker: speakerOf(s.speaker) }
    )
    if (words.length) {
      anyWords = true
      out.push(...words)
      continue
    }
    const tokens = fromCppTokens(s.tokens)
    if (tokens.length) {
      anyWords = true
      out.push(...tokens)
    }
  }
  return anyWords ? out : []
}

function segmentPhrases(data: Record<string, unknown>): AsrCue[] {
  const segs = data.segments
  if (!Array.isArray(segs)) return []
  const out: AsrCue[] = []
  for (const seg of segs) {
    if (!seg || typeof seg !== 'object') continue
    const s = seg as { text?: unknown; start?: unknown; end?: unknown; speaker?: unknown }
    const next = cue(s.text, s.start, s.end, s.speaker)
    if (next) out.push(next)
  }
  return out
}

function cppTranscription(data: Record<string, unknown>): { words: AsrCue[]; phrases: AsrCue[] } {
  const rows = data.transcription
  if (!Array.isArray(rows)) return { words: [], phrases: [] }
  const words: AsrCue[] = []
  const phrases: AsrCue[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const r = row as {
      text?: unknown
      tokens?: unknown
      offsets?: { from?: unknown; to?: unknown }
    }
    const tok = fromCppTokens(r.tokens)
    if (tok.length) words.push(...tok)
    const next = cue(r.text, Number(r.offsets?.from ?? 0) / 1000, Number(r.offsets?.to ?? 0) / 1000)
    if (next) phrases.push(next)
  }
  return { words, phrases }
}

/**
 * Prefer real word/token timestamps. Only fall back to segment phrases when
 * no words[] / tokens[] exist — never lerp inside a words[] payload.
 */
export function parseAsrPayload(raw: unknown, provider = 'asr'): AsrResult | null {
  const data = typeof raw === 'string' ? extractJsonBlob(raw) : raw
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>

  const topWords = fromWordList(obj.words)
  if (topWords.length) return { cues: topWords, wordLevel: true, provider }

  const nested = segmentWordLists(obj)
  if (nested.length) return { cues: nested, wordLevel: true, provider }

  const cpp = cppTranscription(obj)
  if (cpp.words.length) return { cues: cpp.words, wordLevel: true, provider }

  const phrases = segmentPhrases(obj)
  if (phrases.length) return { cues: phrases, wordLevel: false, provider }

  if (cpp.phrases.length) return { cues: cpp.phrases, wordLevel: false, provider }

  return null
}

export function looksWordLevel(cues: AsrCue[]): boolean {
  if (!cues.length) return false
  const singles = cues.filter((c) => !/\s/.test(c.text.trim())).length
  return singles >= cues.length * 0.6
}

/**
 * Map provider cues onto Word-shaped rows.
 * When wordLevel (or cues already look like words), keep start/end as returned.
 * Only linearly split phrase cues that have no word timestamps.
 */
export function expandAsrCues(
  cues: AsrCue[],
  wordLevel?: boolean
): AsrCue[] {
  const keepTimes = wordLevel ?? looksWordLevel(cues)
  if (keepTimes) {
    return cues
      .map((c) => ({
        text: c.text.trim(),
        start: c.start,
        end: Math.max(c.end, c.start),
        speaker: c.speaker
      }))
      .filter((c) => c.text)
  }
  const out: AsrCue[] = []
  for (const seg of cues) {
    const tokens = seg.text.split(/\s+/).filter(Boolean)
    const span = Math.max(0, seg.end - seg.start)
    const n = Math.max(1, tokens.length)
    tokens.forEach((text, i) => {
      out.push({
        text,
        start: seg.start + (span * i) / n,
        end: seg.start + (span * (i + 1)) / n,
        speaker: seg.speaker
      })
    })
  }
  return out
}
