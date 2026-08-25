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

/** Sentence around the caret that still has live words. */
export function liveSentenceRange(words: Word[], wordId: string): Interval | null {
  const span = sentenceRange(words, wordId)
  if (!span) return null
  const live = words.some((word) => !word.deleted && word.end > span.start && word.start < span.end)
  return live ? span : null
}

export function previousSentenceRange(words: Word[], wordId: string): Interval | null {
  const index = words.findIndex((w) => w.id === wordId)
  if (index < 0) return null
  const current = sentenceIds(words, index)
  const first = words.findIndex((w) => w.id === current[0])
  if (first <= 0) return null
  return wordRange(words, sentenceIds(words, first - 1))
}

/** Previous sentence that still has live words — skip already-cut false takes. */
export function livePreviousSentence(words: Word[], wordId: string): Interval | null {
  const prev = previousSentenceRange(words, wordId)
  if (!prev) return null
  const live = words.some((w) => !w.deleted && w.end > prev.start && w.start < prev.end)
  return live ? prev : null
}

/** Short enough to be a restart, not the previous chapter. `,` still cuts any previous sentence. */
export const SHORT_SENTENCE = 3.6

export function restartBeforeWord(words: Word[], wordId: string): Interval | null {
  const prev = livePreviousSentence(words, wordId)
  if (!prev || prev.end - prev.start > SHORT_SENTENCE) return null
  return prev
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

/** Drop one word from the end. `[` shrinks; `]` grows. */
export function shrinkSelection(words: Word[], ids: string[]): string[] {
  if (ids.length <= 1) return sortWordIds(words, ids)
  const indexes = ids
    .map((id) => words.findIndex((w) => w.id === id))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)
  return words.slice(indexes[0], indexes[indexes.length - 1]).map((w) => w.id)
}

export function tagAt(tags: RangeTag[], time: number): RangeTag | undefined {
  return tags.find((t) => time >= t.start && time < t.end)
}

export function wordsMatchingPhrase(words: Word[], phrase: string): Word[] {
  const ids = allWordsMatchingPhrase(words, phrase)
  if (!ids.length) return []
  const first = ids[0]
  const tokens = phrase
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[.,!?]/g, '')
    .split(/\s+/)
    .filter(Boolean)
  const start = words.findIndex((w) => w.id === first)
  if (start < 0) return []
  return words.slice(start, start + Math.max(1, tokens.length))
}

export function allWordsMatchingPhrase(words: Word[], phrase: string): string[] {
  const tokens = phrase
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[.,!?]/g, '')
    .split(/\s+/)
    .filter(Boolean)
  if (!tokens.length) return []
  const keys = words.map((w) => w.text.toLowerCase().replace(/[.,!?]/g, ''))
  const ids: string[] = []
  for (let i = 0; i <= keys.length - tokens.length; i++) {
    if (tokens.every((token, k) => keys[i + k] === token)) {
      ids.push(...words.slice(i, i + tokens.length).map((w) => w.id))
    }
  }
  if (!ids.length && tokens.length === 1) {
    return words.filter((_, i) => keys[i].includes(tokens[0])).map((w) => w.id)
  }
  return [...new Set(ids)]
}

export function wordIdsInRange(words: Word[], lo: number, hi: number): string[] {
  const start = Math.max(0, Math.min(lo, hi))
  const end = Math.min(words.length - 1, Math.max(lo, hi))
  return words.slice(start, end + 1).map((w) => w.id)
}

export function sortWordIds(words: Word[], ids: string[]): string[] {
  const order = new Map(words.map((w, i) => [w.id, i]))
  return [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
}

export function paragraphIds(words: Word[], index: number): string[] {
  if (!words[index]) return []
  let lo = index
  while (lo > 0 && pauseBetween(words[lo - 1], words[lo]) <= PARAGRAPH_GAP + GAP_EPS) lo -= 1
  let hi = index
  while (hi < words.length - 1 && pauseBetween(words[hi], words[hi + 1]) <= PARAGRAPH_GAP + GAP_EPS) hi += 1
  return words.slice(lo, hi + 1).map((w) => w.id)
}

export function isParagraphSelection(words: Word[], ids: string[]): boolean {
  if (ids.length < 2) return false
  const index = words.findIndex((w) => w.id === ids[0])
  if (index < 0) return false
  const para = paragraphIds(words, index)
  if (para.length < 2 || para.length !== ids.length) return false
  const wanted = new Set(ids)
  return para.every((id) => wanted.has(id))
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
