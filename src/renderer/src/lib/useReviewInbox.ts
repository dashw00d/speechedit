import { useEffect, useState } from 'react'
import { summarizeReview, type ReviewRoom, type ReviewSummary } from '../../../shared/review'
import { REVIEW_LINKS_CHANGED, REVIEW_ROOM_CHANGED, reviewBindings, reviewRequest } from './reviewApi'

export function useReviewInbox(projectId: string, enabled: boolean) {
  const [bindings, setBindings] = useState(() => enabled ? reviewBindings(projectId) : [])
  const [summaries, setSummaries] = useState<Record<string, ReviewSummary>>({})
  const [unavailable, setUnavailable] = useState<Record<string, string>>({})
  useEffect(() => {
    const update = () => setBindings(enabled ? reviewBindings(projectId) : [])
    update(); setSummaries({}); setUnavailable({})
    window.addEventListener(REVIEW_LINKS_CHANGED, update)
    window.addEventListener('storage', update)
    return () => { window.removeEventListener(REVIEW_LINKS_CHANGED, update); window.removeEventListener('storage', update) }
  }, [projectId, enabled])
  useEffect(() => {
    const controller = new AbortController()
    const audit = bindings.filter(b => b.projectId === projectId && b.mode !== 'edit')
    const ids = new Set(audit.map(b => b.id))
    const accept = (summary: ReviewSummary) => {
      if (controller.signal.aborted || !ids.has(summary.id)) return
      setSummaries(current => current[summary.id]?.revision > summary.revision ? current : { ...current, [summary.id]: summary })
      setUnavailable(current => { const next = { ...current }; delete next[summary.id]; return next })
    }
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      await Promise.all(audit.map(async binding => {
        try { accept(await reviewRequest<ReviewSummary>(`/${binding.id}/summary`, binding.ownerKey, 'GET', undefined, controller.signal)) }
        catch (e) { if (!controller.signal.aborted) setUnavailable(current => ({ ...current, [binding.id]: e instanceof Error ? e.message : 'Feedback could not refresh.' })) }
      }))
      pending = false
    }
    const changed = (event: Event) => accept(summarizeReview((event as CustomEvent<ReviewRoom>).detail))
    void refresh()
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, 15000)
    window.addEventListener(REVIEW_ROOM_CHANGED, changed)
    window.addEventListener('focus', refresh)
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener(REVIEW_ROOM_CHANGED, changed); window.removeEventListener('focus', refresh) }
  }, [bindings, projectId])
  const current = bindings.filter(b => b.projectId === projectId && b.mode !== 'edit')
  return { bindings: current, summaries, unavailable, pending: current.reduce((n, b) => n + (summaries[b.id]?.published ? summaries[b.id].pending : 0), 0) }
}
