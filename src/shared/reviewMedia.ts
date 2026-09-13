import type { ReviewSnapshot, ReviewSpan } from './review'

/** Integer microseconds on the original source timeline. Encoded files start at zero. */
export const REVIEW_TIMEBASE = 1_000_000
export const REVIEW_PROFILE = 'opus24-storyboard-v1'
export type ReviewMediaKind = 'audio' | 'thumbnail' | 'motion' | 'detail'
export interface ReviewRepresentation {
  id: string; assetId: string; kind: ReviewMediaKind
  start: number; end: number; bytes: number; sha256: string; mime: string
}
export interface ReviewDetailRequest extends ReviewSpan {
  id: string; kind: 'motion' | 'detail'; status: 'pending' | 'ready' | 'failed'; error?: string
}
export interface ReviewDelivery {
  profile: typeof REVIEW_PROFILE; timebase: typeof REVIEW_TIMEBASE; revision: number
  state: 'preparing' | 'playable' | 'complete' | 'partial' | 'failed'
  representations: ReviewRepresentation[]; requests: ReviewDetailRequest[]
  offlineMotion?: boolean
  senderSeenAt?: number; playableAt?: number; completedAt?: number
}
export const reviewScope = (s: ReviewSnapshot): ReviewSpan => s.scope || { start: 0, end: s.sourceDuration }
export const ticks = (seconds: number) => Math.round(seconds * REVIEW_TIMEBASE)
export function assertReviewRange(s: ReviewSnapshot, range: ReviewSpan): void {
  const scope = reviewScope(s)
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || ticks(range.start) < ticks(scope.start) || ticks(range.end) > ticks(scope.end) || range.end < range.start) throw new Error('This range is outside the shared passage.')
}
/** Scope metadata as well as media; never include neighbouring text or waveform peaks. */
export function scopeReviewSnapshot(s: ReviewSnapshot, scope: ReviewSpan): ReviewSnapshot {
  assertReviewRange(s, scope)
  if (scope.end <= scope.start) throw new Error('Select a passage with audio to share.')
  const overlaps = (r: ReviewSpan) => r.start < scope.end && r.end > scope.start
  const clip = <T extends ReviewSpan>(r: T): T => ({ ...r, start: Math.max(scope.start, r.start), end: Math.min(scope.end, r.end) })
  return { ...s, scope: { start: scope.start, end: scope.end },
    assets: s.assets.filter(a => overlaps({ start: a.sourceOffset, end: a.sourceOffset + a.duration })).map(a => ({ ...a, waveform: [] })),
    words: s.words.filter(w => w.start >= scope.start && w.end <= scope.end),
    // A partial chapter cannot safely propose a rename of the entire chapter.
    scenes: s.scenes.filter(s => s.start >= scope.start && s.end <= scope.end),
    cuts: s.cuts.filter(overlaps).map(clip), protected: s.protected.filter(overlaps).map(clip) }
}
export function parseRepresentation(raw: unknown, snapshot: ReviewSnapshot): ReviewRepresentation {
  const r = raw as ReviewRepresentation
  if (!r || !/^[a-zA-Z0-9_-]{1,120}$/.test(r.id) || !['audio', 'thumbnail', 'motion', 'detail'].includes(r.kind) || !/^[a-f0-9]{64}$/.test(r.sha256)) throw new Error('Invalid media representation.')
  if (![r.start, r.end, r.bytes].every(Number.isSafeInteger) || r.bytes <= 0 || r.bytes > 16 * 1024 * 1024 || r.end <= r.start) throw new Error('Invalid media interval or size.')
  assertReviewRange(snapshot, { start: r.start / REVIEW_TIMEBASE, end: r.end / REVIEW_TIMEBASE })
  const asset = snapshot.assets.find(a => a.id === r.assetId)
  if (!asset || r.start < ticks(asset.sourceOffset) || r.end > ticks(asset.sourceOffset + asset.duration)) throw new Error('Media is outside its source recording.')
  if (r.end - r.start > (r.kind === 'thumbnail' ? 30 : r.kind === 'audio' ? 10 : 30) * REVIEW_TIMEBASE) throw new Error('Media interval is too long.')
  if (r.mime !== (r.kind === 'thumbnail' ? 'image/webp' : r.kind === 'audio' ? 'audio/webm' : 'video/webm')) throw new Error('Invalid representation format.')
  return { id: r.id, assetId: r.assetId, kind: r.kind, start: r.start, end: r.end, bytes: r.bytes, sha256: r.sha256, mime: r.mime }
}
export function audioCoverage(snapshot: ReviewSnapshot, rows: ReviewRepresentation[]): number {
  let end = ticks(reviewScope(snapshot).start)
  for (const r of rows.filter(r => r.kind === 'audio').sort((a, b) => a.start - b.start)) {
    if (r.start > end) break
    end = Math.max(end, r.end)
  }
  return end / REVIEW_TIMEBASE
}
export function reviewPlayable(snapshot: ReviewSnapshot, rows: ReviewRepresentation[]): boolean {
  const start = ticks(reviewScope(snapshot).start), asset = snapshot.assets.find(a => ticks(a.sourceOffset) <= start && ticks(a.sourceOffset + a.duration) > start)
  return audioCoverage(snapshot, rows) > start / REVIEW_TIMEBASE && (asset?.kind === 'audio' || rows.some(r => r.kind === 'thumbnail' && r.start === start))
}

/** Offline watch copies must cover every video interval that was authorized. */
export function reviewMotionComplete(snapshot: ReviewSnapshot, rows: ReviewRepresentation[]): boolean {
  const scope = reviewScope(snapshot)
  return snapshot.assets.filter(a => a.kind === 'video').every(asset => {
    let end = ticks(Math.max(scope.start, asset.sourceOffset))
    const until = ticks(Math.min(scope.end, asset.sourceOffset + asset.duration))
    for (const row of rows.filter(r => r.kind === 'motion' && r.assetId === asset.id).sort((a, b) => a.start - b.start)) {
      if (row.start > end) break
      end = Math.max(end, row.end)
    }
    return end >= until
  })
}
