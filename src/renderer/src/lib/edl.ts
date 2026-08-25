import type { Cut, Interval, Project, Word } from '../types'

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start)
  const out: Interval[] = []
  for (const interval of sorted) {
    const last = out[out.length - 1]
    if (!last || interval.start > last.end) out.push({ ...interval })
    else last.end = Math.max(last.end, interval.end)
  }
  return out
}

export function invertIntervals(cuts: Interval[], duration: number): Interval[] {
  const merged = mergeIntervals(
    cuts.map((c) => ({
      start: clamp(c.start, 0, duration),
      end: clamp(c.end, 0, duration)
    }))
  )
  const kept: Interval[] = []
  let cursor = 0
  for (const cut of merged) {
    if (cut.start > cursor) kept.push({ start: cursor, end: cut.start })
    cursor = Math.max(cursor, cut.end)
  }
  if (cursor < duration) kept.push({ start: cursor, end: duration })
  return kept
}

export function programDuration(kept: Interval[]): number {
  return kept.reduce((sum, k) => sum + (k.end - k.start), 0)
}

export function sourceToProgram(sourceTime: number, kept: Interval[]): number {
  let program = 0
  for (const span of kept) {
    if (sourceTime < span.start) return program
    if (sourceTime <= span.end) return program + (sourceTime - span.start)
    program += span.end - span.start
  }
  return program
}

export function programToSource(programTime: number, kept: Interval[]): number {
  let remaining = Math.max(0, programTime)
  for (const span of kept) {
    const length = span.end - span.start
    if (remaining <= length) return span.start + remaining
    remaining -= length
  }
  return kept[kept.length - 1]?.end ?? 0
}

export function overlap(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

export function projectCuts(project: Project): Interval[] {
  const fromWords: Interval[] = project.transcript.words
    .filter((w) => w.deleted)
    .map((w) => ({ start: w.start, end: w.end }))
  const fromCuts = project.cuts.map((c) => ({ start: c.start, end: c.end }))
  return mergeIntervals([...fromWords, ...fromCuts])
}

export function projectKept(project: Project): Interval[] {
  return invertIntervals(projectCuts(project), project.sourceDuration)
}

export function currentWord(words: Word[], sourceTime: number): Word | undefined {
  return words.find((w) => !w.deleted && sourceTime >= w.start && sourceTime < w.end)
}

export function wordsInRange(words: Word[], start: number, end: number): Word[] {
  return words.filter((w) => overlap(w, { start, end }) > 0)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function shiftProgramClips<T extends { start: number }>(
  items: T[],
  after: number,
  delta: number
): T[] {
  return items.map((item) =>
    item.start >= after - 1e-6 ? { ...item, start: Math.max(0, item.start + delta) } : item
  )
}

export function cutEquals(a: Cut, b: Interval): boolean {
  return Math.abs(a.start - b.start) < 1e-3 && Math.abs(a.end - b.end) < 1e-3
}
