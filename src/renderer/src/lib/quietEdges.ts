import type { Interval } from '../types'

export const EDGE_SEARCH = 0.75
export const EDGE_BIN = 0.01

/** Quiet runs in measured RMS bins. Missing samples are never evidence of silence. */
export function quietIntervals(levels: number[], start: number, step = EDGE_BIN): Interval[] {
  const peak = Math.max(0, ...levels.filter(Number.isFinite))
  if (peak < 0.005) return []
  const threshold = Math.min(0.01, peak * 0.08)
  const out: Interval[] = []
  let first = -1
  for (let i = 0; i <= levels.length; i++) {
    if (i < levels.length && Number.isFinite(levels[i]) && levels[i] <= threshold) {
      if (first < 0) first = i
    } else if (first >= 0) {
      if ((i - first) * step >= 0.06 - 1e-6) out.push({ start: start + first * step, end: start + i * step })
      first = -1
    }
  }
  return out
}

/** Search only outside the selection, stopping at adjacent words, cuts, and source/scope limits. */
export function edgeWindows(range: Interval, words: Interval[], bounds: Interval, barriers: Interval[] = []): [Interval, Interval] {
  let start = Math.max(bounds.start, range.start - EDGE_SEARCH)
  let end = Math.min(bounds.end, range.end + EDGE_SEARCH)
  for (const word of words) {
    if (word.start < range.start) start = Math.max(start, Math.min(range.start, word.end))
    if (word.end > range.end) end = Math.min(end, Math.max(range.end, word.start))
  }
  for (const barrier of barriers) {
    if (barrier.start < range.start && barrier.end > start) start = Math.min(range.start, barrier.end)
    if (barrier.end > range.end && barrier.start < end) end = Math.max(range.end, barrier.start)
  }
  return [{ start, end: range.start }, { start: range.end, end }]
}

export function quietRangeEdges(range: Interval, windows: [Interval, Interval], silence: Interval[]): Interval {
  let start = range.start, end = range.end
  const before: number[] = [], after: number[] = []
  for (const quiet of silence) {
    if (!Number.isFinite(quiet.start) || !Number.isFinite(quiet.end) || quiet.end - quiet.start < 0.06 - 1e-6) continue
    const inset = Math.min(0.03, (quiet.end - quiet.start) / 2)
    const a = Math.max(windows[0].start, quiet.start + inset)
    const b = Math.min(windows[0].end, quiet.end - inset)
    if (b >= a) before.push(b)
    const c = Math.max(windows[1].start, quiet.start + inset)
    const d = Math.min(windows[1].end, quiet.end - inset)
    if (d >= c) after.push(c)
  }
  if (before.length) start = Math.max(...before)
  if (after.length) end = Math.min(...after)
  return { start, end }
}
