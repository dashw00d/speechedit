import type { Word } from '../types'
import { parseAsrPayload } from '../../../shared/asr'
import { wordsFromAsr } from './asr'
import { uid } from './time'

function mapNativeWords(list: unknown[]): Word[] {
  return list
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return { id: uid('w'), text: '', start: 0, end: 0, speaker: 'ryan', deleted: false }
      }
      const row = item as Partial<Word> & { word?: string }
      const text = String(row.text ?? row.word ?? '').trim()
      const start = Number(row.start ?? 0)
      const end = Number(row.end ?? start + 0.2)
      return {
        id: typeof row.id === 'string' ? row.id : uid('w'),
        text,
        start,
        end,
        speaker: row.speaker ?? 'ryan',
        deleted: Boolean(row.deleted)
      }
    })
    .filter((w) => w.text)
}

function looksNativeWordRow(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false
  const row = item as { id?: unknown; deleted?: unknown; word?: unknown; text?: unknown }
  return typeof row.id === 'string' || typeof row.deleted === 'boolean' || (typeof row.text === 'string' && row.word == null)
}

/** SpeechEdit words[] stays native. Whisper / OpenAI / whisper.cpp go through parseAsrPayload. */
function nativeWords(raw: unknown): Word[] | null {
  if (Array.isArray(raw)) {
    const mapped = mapNativeWords(raw)
    return mapped.length ? mapped : null
  }
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as { words?: unknown; segments?: unknown; transcription?: unknown }
  if (Array.isArray(obj.segments) || Array.isArray(obj.transcription)) return null
  if (!Array.isArray(obj.words) || !obj.words.length) return null
  if (!obj.words.every(looksNativeWordRow)) return null
  return mapNativeWords(obj.words)
}

export function parseTranscriptJson(raw: unknown): Word[] {
  const native = nativeWords(raw)
  if (native?.length) return native
  const asr = parseAsrPayload(raw)
  if (asr?.cues.length) return wordsFromAsr(asr)
  throw new Error(
    'Transcript JSON needs a SpeechEdit words array, Whisper segments, OpenAI words[], or whisper.cpp transcription.'
  )
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
  const lower = name.toLowerCase()
  if (lower.endsWith('.json')) {
    try {
      return parseTranscriptJson(JSON.parse(text))
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error('That JSON is not valid. Drop Whisper JSON or a SpeechEdit words array.')
      }
      throw err
    }
  }
  if (lower.endsWith('.vtt')) return parseVtt(text)
  if (lower.endsWith('.srt')) return parseSrt(text)
  if (lower.endsWith('.txt')) {
    try {
      return parseTranscriptJson(JSON.parse(text))
    } catch {
      const srt = parseSrt(text)
      if (srt.length) return srt
      return wordsFromPlainText(text)
    }
  }
  try {
    return parseTranscriptJson(JSON.parse(text))
  } catch (err) {
    if (err instanceof Error && /Transcript JSON needs/.test(err.message)) throw err
    const srt = parseSrt(text)
    if (srt.length) return srt
    const plain = wordsFromPlainText(text)
    if (plain.length) return plain
    throw err instanceof Error ? err : new Error('Could not read that transcript.')
  }
}

/** Last-resort drop: split words at 0.35s so a .txt is still editable. */
export function wordsFromPlainText(text: string, step = 0.35): Word[] {
  const tokens = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  return tokens.map((token, i) => ({
    id: uid('w'),
    text: token,
    start: i * step,
    end: i * step + step,
    speaker: 'ryan',
    deleted: false
  }))
}

export function transcriptIsPlaceholder(words: Word[]): boolean {
  if (!words.length) return true
  return words.every((word) => /^Speech\s+\d+$/i.test(word.text.trim()))
}

/**
 * Growing ASR may replace in-span words. A dropped or edited transcript stays
 * unless the incoming list is strictly longer or covers later.
 */
export function takeWordsNeedReplace(current: Word[], incoming: Word[]): boolean {
  if (!incoming.length) return false
  if (transcriptIsPlaceholder(current)) return true
  const curEnd = Math.max(...current.map((word) => word.end))
  const inEnd = Math.max(...incoming.map((word) => word.end))
  return inEnd > curEnd + 0.05 || incoming.length > current.length
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
