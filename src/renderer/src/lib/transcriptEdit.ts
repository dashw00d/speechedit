import type { Interval, RangeTag, Word } from '../types'
import { overlap } from './edl'

export function wordRange(words: Word[], ids: string[]): Interval | null {
  const selected = words.filter((w) => ids.includes(w.id))
  if (!selected.length) return null
  return {
    start: Math.min(...selected.map((w) => w.start)),
    end: Math.max(...selected.map((w) => w.end))
  }
}

export function sentenceRange(words: Word[], wordId: string): Interval | null {
  const index = words.findIndex((w) => w.id === wordId)
  if (index < 0) return null
  return wordRange(words, sentenceIds(words, index))
}

export function previousSentenceRange(words: Word[], wordId: string): Interval | null {
  const index = words.findIndex((w) => w.id === wordId)
  if (index < 0) return null
  const current = sentenceIds(words, index)
  const first = words.findIndex((w) => w.id === current[0])
  if (first <= 0) return null
  return wordRange(words, sentenceIds(words, first - 1))
}

export function sentenceIds(words: Word[], index: number): string[] {
  if (!words[index]) return []
  const stop = /[.!?]$/
  let lo = index
  while (lo > 0) {
    const prev = words[lo - 1]
    if (stop.test(prev.text) || words[lo].start - prev.end > 1.2) break
    lo -= 1
  }
  let hi = index
  while (hi < words.length - 1) {
    if (stop.test(words[hi].text) || words[hi + 1].start - words[hi].end > 1.2) break
    hi += 1
  }
  return words.slice(lo, hi + 1).map((w) => w.id)
}

export function extendSelection(words: Word[], ids: string[], dir: -1 | 1): string[] {
  if (!ids.length) return ids
  const indexes = ids
    .map((id) => words.findIndex((w) => w.id === id))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)
  const lo = dir < 0 ? Math.max(0, indexes[0] - 1) : indexes[0]
  const hi = dir > 0 ? Math.min(words.length - 1, indexes[indexes.length - 1] + 1) : indexes[indexes.length - 1]
  return words.slice(lo, hi + 1).map((w) => w.id)
}

export function tagAt(tags: RangeTag[], time: number): RangeTag | undefined {
  return tags.find((t) => time >= t.start && time < t.end)
}

export function wordsMatchingPhrase(words: Word[], phrase: string): Word[] {
  const tokens = phrase
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[.,!?]/g, '')
    .split(/\s+/)
    .filter(Boolean)
  if (!tokens.length) return []
  const keys = words.map((w) => w.text.toLowerCase().replace(/[.,!?]/g, ''))
  for (let i = 0; i <= keys.length - tokens.length; i++) {
    if (tokens.every((token, k) => keys[i + k] === token)) return words.slice(i, i + tokens.length)
  }
  if (tokens.length === 1) {
    return words.filter((_, i) => keys[i].includes(tokens[0]))
  }
  return []
}

export function paragraphIds(words: Word[], index: number): string[] {
  if (!words[index]) return []
  let lo = index
  while (lo > 0 && words[lo].start - words[lo - 1].end <= 1.2) lo -= 1
  let hi = index
  while (hi < words.length - 1 && words[hi + 1].start - words[hi].end <= 1.2) hi += 1
  return words.slice(lo, hi + 1).map((w) => w.id)
}

export function gapCut(cuts: Interval[], start: number, end: number): boolean {
  return cuts.some((cut) => overlap(cut, { start, end }) > (end - start) * 0.5)
}
