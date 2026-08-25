/** Hour-scale ASR: overlapping windows so a kill only loses the current chunk. */

import type { AsrCue } from './asr'

export const ASR_CHUNK_DURATION_S = 90
export const ASR_CHUNK_OVERLAP_S = 2
export const ASR_CHUNK_MIN_S = 180

export interface AsrChunkWindow {
  start: number
  end: number
}

export interface AsrChunkResult extends AsrChunkWindow {
  cues: AsrCue[]
}

export function wantsChunkedAsr(duration: number): boolean {
  return duration >= ASR_CHUNK_MIN_S
}

export function asrChunkWindows(
  duration: number,
  size = ASR_CHUNK_DURATION_S,
  overlap = ASR_CHUNK_OVERLAP_S
): AsrChunkWindow[] {
  if (duration <= 0) return []
  if (!wantsChunkedAsr(duration)) return [{ start: 0, end: duration }]
  const step = Math.max(0.5, size - overlap)
  const out: AsrChunkWindow[] = []
  for (let start = 0; start < duration - 0.05; start += step) {
    const end = Math.min(duration, start + size)
    out.push({ start, end })
    if (end >= duration - 0.05) break
  }
  return out
}

export function asrChunkMatches(a: AsrChunkWindow, b: AsrChunkWindow, slop = 0.05): boolean {
  return Math.abs(a.start - b.start) < slop && Math.abs(a.end - b.end) < slop
}

export function pendingAsrChunks(windows: AsrChunkWindow[], saved: AsrChunkWindow[]): AsrChunkWindow[] {
  return windows.filter((window) => !saved.some((row) => asrChunkMatches(window, row)))
}

export function asrChunksComplete(windows: AsrChunkWindow[], saved: AsrChunkWindow[]): boolean {
  return windows.length > 0 && pendingAsrChunks(windows, saved).length === 0
}

export function mergeAsrChunks(chunks: AsrChunkResult[], overlap = ASR_CHUNK_OVERLAP_S): AsrCue[] {
  const sorted = [...chunks].sort((a, b) => a.start - b.start || a.end - b.end)
  const last = sorted.length - 1
  const out: AsrCue[] = []
  for (let i = 0; i < sorted.length; i++) {
    const chunk = sorted[i]
    const lo = i === 0 ? chunk.start : chunk.start + overlap / 2
    const hi = i === last ? chunk.end + 1e-6 : chunk.end - overlap / 2
    for (const cue of chunk.cues) {
      const mid = (cue.start + cue.end) / 2
      if (mid >= lo - 1e-6 && mid < hi) out.push(cue)
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end)
}

export function shiftAsrCues(cues: AsrCue[], offset: number): AsrCue[] {
  if (Math.abs(offset) < 1e-9) return cues
  return cues.map((cue) => ({ ...cue, start: cue.start + offset, end: cue.end + offset }))
}
