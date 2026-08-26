import { parseAsrPayload, transcriptionsUrl } from '../../../shared/asr'
import { jsonrepair } from 'jsonrepair'
import type { ModelEndpoint, ProviderKind } from './settings'

export function transcriptReady(endpoint: ModelEndpoint): boolean {
  if (endpoint.kind === 'off') return false
  if (endpoint.kind === 'openai-compatible') return Boolean(endpoint.baseUrl && endpoint.model)
  return (
    endpoint.kind === 'whisper-cli' ||
    endpoint.kind === 'faster-whisper' ||
    endpoint.kind === 'whisper-cpp' ||
    endpoint.kind === 'mlx-whisper'
  )
}

export function isHttpTranscript(kind: ProviderKind): boolean {
  return kind === 'openai-compatible'
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function endpointReady(endpoint: ModelEndpoint): boolean {
  if (endpoint.kind === 'codex-cli' || endpoint.kind === 'grok-cli') return true
  return endpoint.kind === 'openai-compatible' && Boolean(endpoint.baseUrl && endpoint.model)
}

export async function completeOpenAI(
  endpoint: ModelEndpoint,
  messages: ChatMessage[],
  json = true
): Promise<string> {
  if (!endpointReady(endpoint)) throw new Error('Intelligence endpoint is not configured.')
  if (endpoint.kind !== 'openai-compatible') throw new Error('CLI model providers require the desktop app.')
  const url = `${endpoint.baseUrl.replace(/\/$/, '')}/chat/completions`
  const body: Record<string, unknown> = {
    model: endpoint.model,
    messages,
    temperature: 0.2
  }
  if (json) body.response_format = { type: 'json_object' }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (endpoint.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000)
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error('Model timed out after 180 seconds.')
    }
    throw err
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText)
    const formatRejected =
      json && (res.status === 400 || res.status === 422) && /response[_ -]?format|json_object/i.test(detail)
    if (!formatRejected) throw new Error(`Model ${res.status}: ${detail.slice(0, 240)}`)
    delete body.response_format
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000)
    })
    if (!res.ok) {
      const retryDetail = await res.text().catch(() => res.statusText)
      throw new Error(`Model ${res.status}: ${retryDetail.slice(0, 240)}`)
    }
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
  const candidate = raw.slice(start, end + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    return JSON.parse(jsonrepair(candidate))
  }
}

export interface ApiWord {
  text: string
  start: number
  end: number
}

export async function transcribeOpenAI(
  endpoint: ModelEndpoint,
  file: Blob,
  filename = 'audio.wav'
): Promise<ApiWord[]> {
  if (!transcriptReady(endpoint) || endpoint.kind !== 'openai-compatible') {
    throw new Error('Transcript endpoint is not configured.')
  }
  const url = transcriptionsUrl(endpoint.baseUrl)
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
  const parsed = parseAsrPayload(await res.json(), 'openai-compatible')
  return parsed?.cues ?? []
}
