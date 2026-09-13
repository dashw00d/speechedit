import { reviewScope } from '../../../shared/reviewMedia'
import type { ReviewSnapshot, ReviewSpan, ReviewWord } from '../../../shared/review'

export interface ReviewFocus extends ReviewSpan {
  firstWordId?: string
  lastWordId?: string
  question?: string
}

/** Keep the access key and the sender's question in the fragment, out of server URLs. */
export function reviewFragment(key: string, focus?: ReviewFocus): string {
  if (!focus) return key
  const params = new URLSearchParams({ start: String(focus.start), end: String(focus.end) })
  if (focus.firstWordId) params.set('first', focus.firstWordId)
  if (focus.lastWordId) params.set('last', focus.lastWordId)
  if (focus.question?.trim()) params.set('question', focus.question.trim().slice(0, 500))
  return `${key}&${params}`
}

export function parseReviewFragment(hash: string): { key: string; focus?: ReviewFocus } {
  const [key, ...rest] = hash.replace(/^#/, '').split('&')
  const params = new URLSearchParams(rest.join('&'))
  const start = Number(params.get('start')), end = Number(params.get('end'))
  if (!params.has('start') || !params.has('end') || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > 86400) return { key }
  return { key, focus: { start, end, firstWordId: params.get('first')?.slice(0, 120), lastWordId: params.get('last')?.slice(0, 120), question: params.get('question')?.slice(0, 500) } }
}

export function focusForWords(words: ReviewWord[], ids: string[], question?: string): ReviewFocus | undefined {
  const selected = new Set(ids), matches = words.filter(w => selected.has(w.id))
  if (!matches.length || matches.length !== selected.size) return
  return { start: matches.reduce((n, w) => Math.min(n, w.start), Infinity), end: matches.reduce((n, w) => Math.max(n, w.end), 0), firstWordId: matches[0].id, lastWordId: matches.at(-1)!.id, question }
}

export function resolveReviewFocus(snapshot: ReviewSnapshot, focus?: ReviewFocus): { focus: ReviewFocus; words: ReviewWord[] } | undefined {
  const scope = reviewScope(snapshot)
  if (!focus || focus.start < scope.start || focus.start >= scope.end || focus.end > scope.end) return
  const first = snapshot.words.findIndex(w => w.id === focus.firstWordId), last = snapshot.words.findIndex(w => w.id === focus.lastWordId)
  const words = first >= 0 && last >= first ? snapshot.words.slice(first, last + 1)
    : snapshot.words.filter(w => w.start >= focus.start && w.end <= focus.end)
  return { focus: { ...focus, ...(words.length ? { start: words.reduce((n, w) => Math.min(n, w.start), Infinity), end: words.reduce((n, w) => Math.max(n, w.end), 0) } : {}) }, words }
}

/** Short playback context around an edit, bounded even for a long chapter. */
export function reviewPlaybackRange(span: ReviewSpan, duration: number): ReviewSpan {
  const start = Math.max(0, span.start - 1)
  return { start, end: Math.min(duration, Math.max(span.start + 2, Math.min(span.end + 1, start + 15))) }
}
