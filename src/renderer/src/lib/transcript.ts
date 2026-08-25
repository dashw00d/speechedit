import type { Word } from '../types'
import { uid } from './time'

export function parseTranscriptJson(raw: unknown): Word[] {
  const data = raw as { words?: Array<Partial<Word> & { word?: string }> }
  const list = Array.isArray(raw) ? raw : data.words
  if (!Array.isArray(list)) throw new Error('Transcript JSON needs a words array.')
  return list
    .map((item) => {
      const text = String(item.text ?? item.word ?? '')
      const start = Number(item.start ?? 0)
      const end = Number(item.end ?? start + 0.2)
      return {
        id: typeof item.id === 'string' ? item.id : uid('w'),
        text,
        start,
        end,
        speaker: item.speaker ?? 'ryan',
        deleted: Boolean(item.deleted)
      }
    })
    .filter((w) => w.text)
}

function parseTimestamp(value: string): number {
  const clean = value.trim().replace(',', '.')
  const parts = clean.split(':')
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2])
  }
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1])
  return Number(clean)
}

export function parseSrt(text: string): Word[] {
  const blocks = text.replace(/\r/g, '').split(/\n\n+/)
  const words: Word[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean)
    if (lines.length < 2) continue
    const time = lines.find((l) => l.includes('-->'))
    if (!time) continue
    const [startRaw, endRaw] = time.split('-->')
    const start = parseTimestamp(startRaw)
    const end = parseTimestamp(endRaw)
    const payload = lines
      .filter((l) => l !== time && !/^\d+$/.test(l))
      .join(' ')
      .replace(/<[^>]+>/g, '')
    const tokens = payload.split(/\s+/).filter(Boolean)
    tokens.forEach((token, i) => {
      const t0 = start + ((end - start) * i) / tokens.length
      const t1 = start + ((end - start) * (i + 1)) / tokens.length
      words.push({ id: uid('w'), text: token, start: t0, end: t1, speaker: 'ryan', deleted: false })
    })
  }
  return words
}

export function parseVtt(text: string): Word[] {
  return parseSrt(text.replace(/^WEBVTT.*\n+/i, ''))
}

export function parseAnyTranscript(name: string, text: string): Word[] {
  if (name.endsWith('.json')) return parseTranscriptJson(JSON.parse(text))
  if (name.endsWith('.vtt')) return parseVtt(text)
  if (name.endsWith('.srt')) return parseSrt(text)
  try {
    return parseTranscriptJson(JSON.parse(text))
  } catch {
    return parseSrt(text)
  }
}

export function wordsFromIslands(islands: { start: number; end: number }[]): Word[] {
  return islands.flatMap((span, i) => {
    const label = `Speech ${i + 1}`
    return [
      {
        id: uid('w'),
        text: label,
        start: span.start,
        end: span.end,
        speaker: 'ryan',
        deleted: false
      }
    ]
  })
}

export const FILLERS = new Set(['um', 'uh', 'uhm', 'erm', 'ah', 'uhh', 'hmm'])

export function isFillerToken(text: string): boolean {
  return FILLERS.has(text.toLowerCase().replace(/[.,!?]/g, ''))
}
