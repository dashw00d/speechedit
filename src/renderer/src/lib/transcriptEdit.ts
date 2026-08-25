import type { EditSuggestion, Interval, Project, RangeTag, Word } from '../types'
import { currentWord, overlap } from './edl'

export const PARAGRAPH_GAP = 1.2
const GAP_EPS = 1e-4

function pauseBetween(prev: Word, next: Word): number {
  return next.start - prev.end
}

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
    if (stop.test(prev.text) || pauseBetween(prev, words[lo]) > PARAGRAPH_GAP + GAP_EPS) break
    lo -= 1
  }
  let hi = index
  while (hi < words.length - 1) {
    if (stop.test(words[hi].text) || pauseBetween(words[hi], words[hi + 1]) > PARAGRAPH_GAP + GAP_EPS) break
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
  while (lo > 0 && pauseBetween(words[lo - 1], words[lo]) <= PARAGRAPH_GAP + GAP_EPS) lo -= 1
  let hi = index
  while (hi < words.length - 1 && pauseBetween(words[hi], words[hi + 1]) <= PARAGRAPH_GAP + GAP_EPS) hi += 1
  return words.slice(lo, hi + 1).map((w) => w.id)
}

export function caretWord(words: Word[], selectedIds: string[], sourceTime: number): Word | undefined {
  const selected = words.find((w) => w.id === selectedIds[0])
  if (selected) return selected
  return (
    currentWord(words, sourceTime) ??
    words.find((w) => w.start >= sourceTime) ??
    words[words.length - 1]
  )
}

export function coveringAppliedSuggestion(
  project: Project,
  start: number,
  end: number
): EditSuggestion | undefined {
  const span = { start, end }
  return project.suggestions
    .filter((s) => s.applied && s.action !== 'normalize' && overlap(s, span) > 0.02)
    .sort((a, b) => {
      const cover = (s: EditSuggestion) => overlap(s, span) / Math.max(0.01, s.end - s.start)
      return cover(b) - cover(a)
    })[0]
}

export function appliedForWord(project: Project, word: Word): EditSuggestion | undefined {
  return project.suggestions.find(
    (s) => s.applied && s.action !== 'normalize' && word.start >= s.start && word.end <= s.end + 0.02
  )
}

export function gapCut(cuts: Interval[], start: number, end: number): boolean {
  return cuts.some((cut) => overlap(cut, { start, end }) > (end - start) * 0.5)
}
