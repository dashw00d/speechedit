import { useEffect } from 'react'
import { useEditor } from '../store'
import type { Project } from '../types'
import type { ReviewRoom } from '../../../shared/review'
import { reviewScope, ticks } from '../../../shared/reviewMedia'
import { reviewBindings, reviewRequest, type ReviewBinding } from './reviewApi'
import { ReviewEncoder, uploadRepresentation } from './reviewDelivery'

export async function provideReviewVideo(project: Project, binding: ReviewBinding, room: ReviewRoom, range: { start: number; end: number }, kind: 'motion' | 'detail', signal: AbortSignal): Promise<ReviewRoom> {
  const encoder = new ReviewEncoder(signal)
  try {
    for (const source of room.snapshot.assets) {
      if (source.kind !== 'video') continue
      const start = Math.max(range.start, source.sourceOffset), end = Math.min(range.end, source.sourceOffset + source.duration)
      if (end <= start) continue
      const asset = project.assets[source.id]
      if (!asset?.path || asset.duration !== source.duration) throw new Error('Reopen the original source recording to prepare this section.')
      await encoder.open(asset)
      for (let cursor = start; cursor < end;) {
        const next = Math.min(end, cursor + (kind === 'detail' ? 5 : 15))
        const existing = room.delivery?.representations.some(r => r.assetId === source.id && r.kind === kind && r.start <= ticks(cursor) && r.end >= ticks(next))
        if (!existing) {
          const { blob } = await encoder.encode(kind, cursor - source.sourceOffset, next - source.sourceOffset)
          room = await uploadRepresentation(binding, { assetId: source.id, kind, start: ticks(cursor), end: ticks(next) }, blob, signal)
        }
        cursor = next
      }
    }
    return room
  } finally { encoder.close() }
}
/** Requests survive closing the share sheet. Opening the source project serves queued intervals. */
export function useReviewDetails(projectId: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController(); let running = false
    async function tick() {
      const editor = useEditor.getState()
      if (running || editor.analyzing || editor.exporting || editor.project.id !== projectId) return
      running = true
      try {
        for (const binding of reviewBindings(projectId).filter(b => b.mode !== 'edit')) {
          if (controller.signal.aborted) break
          let room: ReviewRoom
          try { room = await reviewRequest<ReviewRoom>(`/${binding.id}`, binding.ownerKey, 'GET', undefined, controller.signal) } catch { continue }
          if (!room.delivery || !room.published) continue
          room = await reviewRequest<ReviewRoom>(`/${binding.id}/delivery`, binding.ownerKey, 'POST', {}, controller.signal)
          const request = room.delivery!.requests.find(r => r.status === 'pending')
          if (!request) continue
          try {
            room = await provideReviewVideo(editor.project, binding, room, request, request.kind, controller.signal)
            await reviewRequest(`/${binding.id}/details`, binding.ownerKey, 'POST', { id: request.id, status: 'ready' }, controller.signal)
          } catch (e) {
            if (controller.signal.aborted) break
            await reviewRequest(`/${binding.id}/details`, binding.ownerKey, 'POST', { id: request.id, status: 'failed', error: (e instanceof Error ? e.message : 'Video detail could not be prepared.').slice(0, 200) }, controller.signal)
          }
        }
      } catch { /* Requests stay pending across network loss; retry on the next tick. */ } finally { running = false }
    }
    void tick(); const timer = setInterval(() => void tick(), 6000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [projectId, enabled])
}
export const offlineVideoRange = (room: ReviewRoom) => reviewScope(room.snapshot)
