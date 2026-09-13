import type { Asset, Project } from '../types'
import type { ReviewRoom, ReviewSnapshot } from '../../../shared/review'
import { REVIEW_PROFILE, reviewScope, audioCoverage, ticks, type ReviewRepresentation, type ReviewMediaKind } from '../../../shared/reviewMedia'
import { browserMediaForPath } from './browserMediaStore'
import { mediaUrl } from '../host'
import { cacheReviewProxy, cachedReviewProxy } from './reviewProxyCache'
import { reviewRequest, type ReviewBinding } from './reviewApi'

export interface DeliveryMetrics { bytes: number; cached: number; decodeMs: number; encodeMs: number; totalMs: number; usefulMs?: number }
type Result = { blob: Blob; metrics: { decodeMs: number; encodeMs: number; totalMs: number } }
export class ReviewEncoder {
  private worker = new Worker(new URL('../workers/reviewMedia.worker.ts', import.meta.url), { type: 'module' })
  private sequence = 0
  private file?: File
  private asset?: Asset
  constructor(private signal: AbortSignal) { signal.addEventListener('abort', this.close, { once: true }) }
  close = () => { this.worker.terminate(); this.signal.removeEventListener('abort', this.close) }
  private request(payload: object): Promise<Result> {
    this.signal.throwIfAborted()
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const cleanup = () => { this.worker.removeEventListener('message', message); this.worker.removeEventListener('error', error); this.signal.removeEventListener('abort', abort) }
      const abort = () => { cleanup(); reject(new DOMException('Sharing cancelled.', 'AbortError')) }
      const error = () => { cleanup(); reject(new Error('Media processing stopped. Keep the source available and try again.')) }
      const message = (e: MessageEvent) => { if (e.data.id !== id) return; cleanup(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data) }
      this.worker.addEventListener('message', message); this.worker.addEventListener('error', error); this.signal.addEventListener('abort', abort, { once: true })
      this.worker.postMessage({ ...payload, id })
    })
  }
  async open(asset: Asset) {
    this.asset = asset; this.file = browserMediaForPath(asset.path)
    const f = this.file
    const preview = f ? await cachedReviewProxy(JSON.stringify(['proxy-v2-8fps-realtime', asset.kind, asset.duration, f.name, f.size, f.lastModified])) : undefined
    await this.request({ source: f || mediaUrl(asset.path), preview })
  }
  async encode(kind: ReviewMediaKind, start: number, end: number): Promise<Result & { cached: boolean }> {
    const f = this.file, key = f ? JSON.stringify([REVIEW_PROFILE, kind, this.asset!.id, f.name, f.size, f.lastModified, ticks(start), ticks(end)]) : undefined
    if (key) { const blob = await cachedReviewProxy(key); this.signal.throwIfAborted(); if (blob) return { blob, cached: true, metrics: { decodeMs: 0, encodeMs: 0, totalMs: 0 } } }
    const result = await this.request({ kind, start, end })
    if (key) await cacheReviewProxy(key, result.blob)
    return { ...result, cached: false }
  }
}
export async function uploadRepresentation(binding: ReviewBinding, range: { assetId: string; kind: ReviewMediaKind; start: number; end: number }, blob: Blob, signal: AbortSignal): Promise<ReviewRoom> {
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('')
  const identity = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(range))))].map(n => n.toString(16).padStart(2, '0')).join('')
  const row: ReviewRepresentation = { ...range, id: `${range.kind}-${identity.slice(0, 40)}`, bytes: blob.size, sha256, mime: blob.type }
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`/api/reviews/${binding.id}/representations/${row.id}`, { method: 'PUT', signal, headers: { Authorization: `Bearer ${binding.ownerKey}`, 'Content-Type': blob.type, 'X-Review-Representation': JSON.stringify(row) }, body: blob })
      const data = await response.json()
      if (!response.ok) { if (response.status >= 500 && attempt < 2) continue; throw new Error(data.error || 'Section upload failed.') }
      return data
    } catch (e) { signal.throwIfAborted(); if (attempt >= 2 || !(e instanceof TypeError)) throw e }
  }
}
/** One upload overlaps one bounded encode. No full-recording Blob is ever constructed. */
export async function deliverReview(project: Project, snapshot: ReviewSnapshot, binding: ReviewBinding, signal: AbortSignal, update: (room: ReviewRoom, ratio: number, metrics: DeliveryMetrics) => void, existing?: ReviewRoom): Promise<ReviewRoom> {
  const scope = reviewScope(snapshot), started = performance.now(), encoder = new ReviewEncoder(signal)
  const metrics: DeliveryMetrics = { bytes: 0, cached: 0, decodeMs: 0, encodeMs: 0, totalMs: 0 }
  let upload: Promise<void> = Promise.resolve(), latest: ReviewRoom | undefined = existing
  metrics.bytes = existing?.delivery?.representations.reduce((n, r) => n + r.bytes, 0) || 0
  const queue = async (assetId: string, kind: ReviewMediaKind, start: number, end: number, sourceOffset: number) => {
    if (latest?.delivery?.representations.some(r => r.assetId === assetId && r.kind === kind && r.start === ticks(start) && r.end === ticks(end))) return
    const result = await encoder.encode(kind, start - sourceOffset, end - sourceOffset)
    await upload; signal.throwIfAborted()
    metrics.cached += Number(result.cached); metrics.decodeMs += result.metrics.decodeMs; metrics.encodeMs += result.metrics.encodeMs
    upload = uploadRepresentation(binding, { assetId, kind, start: ticks(start), end: ticks(end) }, result.blob, signal).then(room => {
      latest = room; metrics.bytes += result.blob.size; metrics.totalMs = performance.now() - started
      if (room.published && metrics.usefulMs == null) metrics.usefulMs = metrics.totalMs
      update(room, (audioCoverage(room.snapshot, room.delivery!.representations) - scope.start) / (scope.end - scope.start), { ...metrics })
    })
    void upload.catch(() => undefined)
  }
  try {
    for (const asset of snapshot.assets) {
      await encoder.open(project.assets[asset.id])
      const start = Math.max(scope.start, asset.sourceOffset), end = Math.min(scope.end, asset.sourceOffset + asset.duration)
      const imageTimes = [...new Set([start, ...Array.from({ length: Math.ceil((end - start) / 10) }, (_, i) => start + i * 10), ...(project.analysis.sceneTimes || []).filter(t => t > start && t < end)])].sort((a, b) => a - b)
      let nextImage = 0
      for (let cursor = start; cursor < end - 1e-6;) {
        const next = Math.min(end, cursor + (cursor === start ? 2 : 8))
        if (asset.kind === 'video') while (nextImage < imageTimes.length && imageTimes[nextImage] < next) {
          const time = imageTimes[nextImage++]; await queue(asset.id, 'thumbnail', time, Math.min(end, imageTimes[nextImage] ?? end), asset.sourceOffset)
        }
        await queue(asset.id, 'audio', cursor, next, asset.sourceOffset); cursor = next
      }
    }
    await upload
    latest = await reviewRequest<ReviewRoom>(`/${binding.id}/delivery`, binding.ownerKey, 'POST', latest?.delivery?.offlineMotion ? {} : { state: 'complete' }, signal)
    metrics.totalMs = performance.now() - started; update(latest, 1, { ...metrics }); return latest
  } finally { encoder.close(); await upload.catch(() => undefined) }
}
