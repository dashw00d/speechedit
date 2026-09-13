import type { ReviewRoom, ReviewSnapshot } from '../../../shared/review'
export interface ReviewBinding { id: string; ownerKey: string; reviewerKey: string; projectId: string; mode?: 'audit' | 'edit' }
const storageKey = 'speechedit.review-links.v1'
export function reviewBindings(projectId: string): ReviewBinding[] {
  try { return (JSON.parse(localStorage.getItem(storageKey) || '[]') as ReviewBinding[]).filter(b => b.projectId === projectId) } catch { return [] }
}
export function rememberReview(binding: ReviewBinding): void {
  const all = JSON.parse(localStorage.getItem(storageKey) || '[]') as ReviewBinding[]
  localStorage.setItem(storageKey, JSON.stringify([...all.filter(b => b.id !== binding.id), binding]))
}
export function forgetReview(id: string): void {
  const all = JSON.parse(localStorage.getItem(storageKey) || '[]') as ReviewBinding[]
  localStorage.setItem(storageKey, JSON.stringify(all.filter(b => b.id !== id)))
}
export function reviewLink(binding: ReviewBinding): string { return `${location.origin}/${binding.mode === 'edit' ? 'edit' : 'review'}/${binding.id}#${binding.reviewerKey}` }
export async function reviewRequest<T>(path: string, key?: string, method = 'GET', payload?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/reviews${path}`, { method, signal, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) })
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Review server is unavailable.')
  return data as T
}
export async function createReview(snapshot: ReviewSnapshot, signal?: AbortSignal, project?: import('../types').Project) {
  return reviewRequest<{ room: ReviewRoom; ownerKey: string; reviewerKey: string }>('', undefined, 'POST', { snapshot, mode: project ? 'edit' : 'audit', ...(project ? { project } : {}) }, signal)
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
