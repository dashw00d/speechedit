import { REVIEW_PROFILE } from '../../../shared/reviewMedia'
import type { ReviewRoom, ReviewSnapshot } from '../../../shared/review'
import { reviewFragment, type ReviewFocus } from './reviewLinks'
export const REVIEW_LINKS_CHANGED = 'speechedit:review-links-changed'
export const REVIEW_ROOM_CHANGED = 'speechedit:review-room-changed'
export class ReviewApiError extends Error { constructor(message: string, readonly status: number) { super(message) } }
export interface ReviewBinding { id: string; ownerKey: string; reviewerKey: string; projectId: string; mode?: 'audit' | 'edit' }
const storageKey = 'speechedit.review-links.v1'
export function reviewBindings(projectId: string): ReviewBinding[] {
  try { return (JSON.parse(localStorage.getItem(storageKey) || '[]') as ReviewBinding[]).filter(b => b.projectId === projectId) } catch { return [] }
}
export function rememberReview(binding: ReviewBinding): void {
  const all = JSON.parse(localStorage.getItem(storageKey) || '[]') as ReviewBinding[]
  localStorage.setItem(storageKey, JSON.stringify([...all.filter(b => b.id !== binding.id), binding]))
  window.dispatchEvent(new Event(REVIEW_LINKS_CHANGED))
}
export function forgetReview(id: string): void {
  const all = JSON.parse(localStorage.getItem(storageKey) || '[]') as ReviewBinding[]
  localStorage.setItem(storageKey, JSON.stringify(all.filter(b => b.id !== id)))
  window.dispatchEvent(new Event(REVIEW_LINKS_CHANGED))
}
export function reviewLink(binding: ReviewBinding, focus?: ReviewFocus): string { return `${location.origin}/${binding.mode === 'edit' ? 'edit' : 'review'}/${binding.id}#${reviewFragment(binding.reviewerKey, binding.mode === 'edit' ? undefined : focus)}` }
export async function reviewRequest<T>(path: string, key?: string, method = 'GET', payload?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/reviews${path}`, { method, signal, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) })
  const data = await response.json()
  if (!response.ok) throw new ReviewApiError(typeof data.error === 'string' ? data.error : 'Review server is unavailable.', response.status)
  if (typeof window !== 'undefined' && data.id && data.snapshot && Array.isArray(data.proposals)) window.dispatchEvent(new CustomEvent(REVIEW_ROOM_CHANGED, { detail: data }))
  return data as T
}
/** A 409 guarantees no mutation happened, so fresh feedback can safely be retried once. */
export async function reviewMutation(id: string, path: string, key: string, revision: number, payload: Record<string, unknown>): Promise<ReviewRoom> {
  try { return await reviewRequest<ReviewRoom>(`/${id}${path}`, key, 'POST', { ...payload, revision }) }
  catch (e) {
    if (!(e instanceof ReviewApiError) || e.status !== 409) throw e
    const latest = await reviewRequest<ReviewRoom>(`/${id}`, key)
    return reviewRequest<ReviewRoom>(`/${id}${path}`, key, 'POST', { ...payload, revision: latest.revision })
  }
}
export async function createReview(snapshot: ReviewSnapshot, signal?: AbortSignal, project?: import('../types').Project, lightweight = false, offlineMotion = false) {
  return reviewRequest<{ room: ReviewRoom; ownerKey: string; reviewerKey: string }>('', undefined, 'POST', { snapshot, ...(lightweight ? { profile: REVIEW_PROFILE, offlineMotion } : {}), mode: project ? 'edit' : 'audit', ...(project ? { project } : {}) }, signal)
}
export async function uploadReviewPreview(binding: ReviewBinding, assetId: string, blob: Blob, signal?: AbortSignal, progress?: (ratio: number) => void) {
  const chunkSize = 512 * 1024
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    const end = Math.min(blob.size, offset + chunkSize)
    const response = await fetch(`/api/reviews/${binding.id}/media/${assetId}`, { method: 'PUT', headers: { Authorization: `Bearer ${binding.ownerKey}`, 'Content-Type': blob.type, 'Content-Range': `bytes ${offset}-${end - 1}/${blob.size}` }, body: blob.slice(offset, end, blob.type), signal })
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Preview upload failed.') }
    progress?.(end / blob.size)
  }
}

/** Delivery and feedback revisions advance independently. Never discard newer media on a reply race. */
export function latestReviewRoom(current: ReviewRoom | null, next: ReviewRoom): ReviewRoom {
  if (!current || current.id !== next.id) return next
  const feedback = current.revision > next.revision ? current : next
  const delivery = (current.delivery?.revision || 0) > (next.delivery?.revision || 0) ? current.delivery : next.delivery
  return { ...feedback, ...(delivery ? { delivery, published: current.published || next.published } : {}) }
}
