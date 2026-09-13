import { useEffect, useState } from 'react'
import type { ReviewRoom } from '../../../shared/review'
import { reviewRequest } from '../lib/reviewApi'
import { ReviewWorkspace } from './ReviewWorkspace'

/** Separate from App: reviewers never hydrate, overwrite, export, or autosave the owner's workspace. */
export function ReviewPage() {
  const id = location.pathname.split('/')[2]
  const [accessKey] = useState(() => location.hash.slice(1))
  const [room, setRoom] = useState<ReviewRoom | null>(null)
  const [error, setError] = useState('')
  async function refresh() {
    try { setRoom(await reviewRequest<ReviewRoom>(`/${id}`, accessKey)); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Cannot open review.') }
  }
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh() }, 15000); return () => clearInterval(timer) }, [])
  return <main className="review-page">
    <header className="review-page-header"><div><span className="brand-mark">Speech<em>Edit</em></span><h1>{room?.snapshot.name || 'Shared review'}</h1><p>Review copy · original-quality export stays with the owner</p></div><button className="chip" onClick={() => void refresh()}>Refresh feedback</button></header>
    {error && <p role="alert" className="review-error">{error}</p>}
    {room ? <><p>Source snapshot shared {new Date(room.createdAt).toLocaleDateString()} · link expires {new Date(room.expiresAt).toLocaleDateString()}</p><ReviewWorkspace room={room} accessKey={accessKey} onRoom={setRoom} onError={setError} /></> : !error && <p role="status">Opening the shared review…</p>}
  </main>
}
