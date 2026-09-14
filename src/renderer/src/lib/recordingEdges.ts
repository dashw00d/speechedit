import type { Interval, Project } from '../types'
import type { ReviewRoom } from '../../../shared/review'
import { REVIEW_TIMEBASE, reviewScope } from '../../../shared/reviewMedia'
import { mediaUrl } from '../host'
import { playbackPath } from '../../../shared/proxy'
import { browserMediaForPath } from './browserMediaStore'
import { primaryTakes, sourceOffsetOf } from './takes'
import { projectCuts } from './edl'
import { edgeWindows, quietRangeEdges } from './quietEdges'
import { recordingSlot } from './replaceAudio'

export interface PreparedRecording { range: Interval; duration: number; note: string }
interface EdgeSource { path: string; sourceOffset: number; duration: number }

function checkAudio(source: EdgeSource, range: Interval, signal: AbortSignal): Promise<Interval[]> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/audioEdges.worker.ts', import.meta.url), { type: 'module' })
    const finish = (silence: Interval[], aborted = false) => {
      clearTimeout(timer); worker.terminate(); signal.removeEventListener('abort', abort)
      aborted ? reject(new DOMException('Cancelled.', 'AbortError')) : resolve(silence)
    }
    const abort = () => finish([], true)
    const timer = setTimeout(() => finish([]), 8000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => finish([])
    worker.onmessage = ({ data }) => finish((data.silence ?? []).map((span: Interval) => ({ start: span.start + source.sourceOffset, end: span.end + source.sourceOffset })))
    worker.postMessage({ source: browserMediaForPath(source.path) ?? mediaUrl(source.path), range: { start: range.start - source.sourceOffset, end: range.end - source.sourceOffset } })
  })
}

/** Analyze at most two short edge windows, never the whole recording or playing timeline. */
export async function prepareRecordingEdges(input: {
  range: Interval; words: Interval[]; bounds: Interval; barriers: Interval[]; silence: Interval[]; sources: EdgeSource[]
  durationOf?: (range: Interval) => number
}, signal: AbortSignal): Promise<PreparedRecording> {
  const windows = edgeWindows(input.range, input.words, input.bounds, input.barriers)
  const measured = await Promise.all(windows.map(async (window, i) => {
    const edge = i === 0 ? input.range.start : input.range.end
    const source = input.sources.find(s => i === 0 ? edge >= s.sourceOffset && edge < s.sourceOffset + s.duration : edge > s.sourceOffset && edge <= s.sourceOffset + s.duration)
    if (!source) return []
    window.start = Math.max(window.start, source.sourceOffset)
    window.end = Math.min(window.end, source.sourceOffset + source.duration)
    if (window.end - window.start < 0.06) return []
    return checkAudio(source, window, signal)
  }))
  signal.throwIfAborted()
  let range = quietRangeEdges(input.range, windows, [...input.silence, ...measured.flat()])
  const durationOf = input.durationOf ?? ((span: Interval) => span.end - span.start)
  let duration: number
  try { duration = durationOf(range) } catch { range = input.range; duration = durationOf(range) }
  if (duration > 120 || duration < 0.1) { range = input.range; duration = durationOf(range) }
  const before = input.range.start - range.start, after = range.end - input.range.end
  const changed = before + after > 0.005
  return { range, duration, note: changed
    ? `Aligned to nearby pauses: ${before.toFixed(2)}s before and ${after.toFixed(2)}s after the selected words.`
    : 'No safer nearby pauses found. Using the selected word boundaries.' }
}

export function prepareProjectRecording(project: Project, range: Interval, signal: AbortSignal) {
  return prepareRecordingEdges({ range, words: project.transcript.words, bounds: { start: 0, end: project.sourceDuration },
    barriers: [...projectCuts(project), ...project.tags.filter(t => t.kind === 'keep' || t.kind === 'demo')], silence: project.analysis.silence,
    sources: primaryTakes(project).map(asset => ({ path: playbackPath(asset), sourceOffset: sourceOffsetOf(asset), duration: asset.duration })),
    durationOf: span => recordingSlot(project, span.start, span.end).duration }, signal)
}

export function prepareReviewRecording(room: ReviewRoom, range: Interval, signal: AbortSignal) {
  const sources = room.delivery ? room.delivery.representations.filter(r => r.kind === 'audio').map(r => ({
    path: `${location.origin}/api/reviews/${room.id}/representations/${r.id}`, sourceOffset: r.start / REVIEW_TIMEBASE, duration: (r.end - r.start) / REVIEW_TIMEBASE
  })) : room.snapshot.assets.map(a => ({ path: `${location.origin}/api/reviews/${room.id}/media/${a.id}`, sourceOffset: a.sourceOffset, duration: a.duration }))
  return prepareRecordingEdges({ range, words: room.snapshot.words, bounds: reviewScope(room.snapshot),
    barriers: [...room.snapshot.cuts, ...room.snapshot.protected, ...room.proposals.flatMap(p => p.status === 'accepted' && p.edit?.kind === 'cut' ? [p.edit] : [])], silence: [], sources }, signal)
}
