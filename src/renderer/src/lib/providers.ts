import type { ModelEndpoint } from './settings'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function endpointReady(endpoint: ModelEndpoint): boolean {
  return endpoint.kind === 'openai-compatible' && Boolean(endpoint.baseUrl && endpoint.model)
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
    return data.words.map((w) => ({
      text: String(w.word ?? w.text ?? '').trim(),
      start: w.start,
      end: w.end
    })).filter((w) => w.text)
  }
  const fromSegs =
    data.segments?.flatMap((seg) =>
      seg.words?.length
        ? seg.words.map((w) => ({ text: w.word.trim(), start: w.start, end: w.end }))
        : [{ text: seg.text.trim(), start: seg.start, end: seg.end }]
    ) ?? []
  return fromSegs.filter((w) => w.text)
}
