import type { ReviewSpan } from '../../../shared/review'

export interface ReviewDraft {
  text: string
  range: ReviewSpan
  selectedIds: string[]
  correction: string
  chapter: string
  title: string
  replies: Record<string, string>
}
const key = (roomId: string, owner: boolean) => `speechedit.review-draft.v1:${owner ? 'owner' : 'guest'}:${roomId}`
export function readReviewDraft(roomId: string, owner: boolean, duration: number): Partial<ReviewDraft> {
  try {
    const value = JSON.parse(localStorage.getItem(key(roomId, owner)) || 'null')
    if (!value || typeof value !== 'object') return {}
    const result: Partial<ReviewDraft> = {}
    for (const field of ['text', 'correction', 'chapter', 'title'] as const) if (typeof value[field] === 'string') result[field] = value[field].slice(0, 2000)
    if (value.range && Number.isFinite(value.range.start) && Number.isFinite(value.range.end) && value.range.start >= 0 && value.range.end >= value.range.start && value.range.end <= duration) result.range = value.range
    if (Array.isArray(value.selectedIds)) result.selectedIds = value.selectedIds.filter((id: unknown) => typeof id === 'string').slice(0, 150000)
    if (value.replies && typeof value.replies === 'object' && !Array.isArray(value.replies)) result.replies = Object.fromEntries(Object.entries(value.replies).filter(([, text]) => typeof text === 'string').map(([id, text]) => [id, (text as string).slice(0, 2000)]))
    return result
  } catch { return {} }
}
export function saveReviewDraft(roomId: string, owner: boolean, draft: ReviewDraft): boolean {
  try { localStorage.setItem(key(roomId, owner), JSON.stringify(draft)); return true } catch { return false }
}
