import { useEffect, useState } from 'react'
import type { ReviewRoom } from '../../../shared/review'
import { reviewRequest } from '../lib/reviewApi'
import { ReviewWorkspace } from './ReviewWorkspace'
import { parseReviewFragment } from '../lib/reviewLinks'

/** Separate from App: reviewers never hydrate, overwrite, export, or autosave the owner's workspace. */
export function ReviewPage() {
  const id = location.pathname.split('/')[2]
  const [fragment, setFragment] = useState(() => parseReviewFragment(location.hash))
  const accessKey = fragment.key
  const [room, setRoom] = useState<ReviewRoom | null>(null)
  const [error, setError] = useState('')
  async function refresh() {
    try { const next = await reviewRequest<ReviewRoom>(`/${id}`, accessKey); setRoom(current => current && current.revision > next.revision ? current : next); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Cannot open review.') }
  }
  useEffect(() => { const changed = () => setFragment(parseReviewFragment(location.hash)); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed) }, [])
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh() }, 15000); return () => clearInterval(timer) }, [accessKey])
  return <main className="review-page">
    <header className="review-page-header"><div><span className="brand-mark">Speech<em>Edit</em></span><h1>{room?.snapshot.name || 'Shared review'}</h1><p>Watch the video, check the transcript, and suggest changes.</p></div><button className="chip" onClick={() => void refresh()}>Refresh feedback</button></header>
    {error && <p role="alert" className="review-error">{error}</p>}
    {room?.mode === 'edit' ? <p>This link grants full editing. <a className="chip" href={`/edit/${id}#${accessKey}`}>Open full editor</a></p> : room ? <><p>Source snapshot shared {new Date(room.createdAt).toLocaleDateString()} · link expires {new Date(room.expiresAt).toLocaleDateString()}</p><ReviewWorkspace key={`${room.id}:${JSON.stringify(fragment)}`} focus={fragment.focus} room={room} accessKey={accessKey} onRoom={setRoom} onError={setError} /></> : !error && <p role="status">Opening the shared review…</p>}
  </main>
}
