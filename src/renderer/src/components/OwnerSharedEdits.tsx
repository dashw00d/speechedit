import { useEffect, useState } from 'react'
import type { ReviewRoom } from '../../../shared/review'
import type { Project } from '../types'
import { reviewBindings, reviewRequest, REVIEW_LINKS_CHANGED, type ReviewBinding } from '../lib/reviewApi'
import { readSharedState } from '../lib/sharedSession'
import { bringSharedEdits, OWNER_EDITS_APPLIED } from '../lib/ownerSharedEdits'

export function OwnerSharedEdits({ projectId, onToast }: { projectId: string; onToast: (message: string) => void }) {
  const [bindings, setBindings] = useState(() => reviewBindings(projectId).filter(b => b.mode === 'edit'))
  useEffect(() => {
    const refresh = () => setBindings(reviewBindings(projectId).filter(b => b.mode === 'edit'))
    window.addEventListener(REVIEW_LINKS_CHANGED, refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener(REVIEW_LINKS_CHANGED, refresh); window.removeEventListener('storage', refresh) }
  }, [projectId])
  return <>{bindings.map((binding, index) => <OwnerSharedRoom key={binding.id} binding={binding} label={bindings.length > 1 ? `Editing link ${index + 1}` : 'Editing link'} onToast={onToast} />)}</>
}

function OwnerSharedRoom({ binding, label, onToast }: { binding: ReviewBinding; label: string; onToast: (message: string) => void }) {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('Checking for updates…')
  const [error, setError] = useState('')
  const [checkError, setCheckError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const abort = new AbortController()
    let checking = false
    async function check() {
      if (checking) return
      checking = true
      try {
        const room = await reviewRequest<ReviewRoom>(`/${binding.id}`, binding.ownerKey, 'GET', undefined, abort.signal)
        const base = await readSharedState<Project>(`owner-base:${binding.id}`)
        if (abort.signal.aborted) return
        if (!room.published) { setMessage('Preparing editing link…'); return }
        if (!room.project || room.mode !== 'edit') throw new Error('Editing access is no longer available. Manage this link in Share.')
        if (!base) throw new Error('This browser cannot safely combine these edits. Open Share, then Open full editor to download an edit copy.')
        const changed = JSON.stringify(base) !== JSON.stringify(room.project)
        setPending(changed)
        setMessage(changed ? 'Your collaborator saved changes. Bring them into this project.' : 'No new updates.')
        setCheckError('')
      } catch (e) {
        if (!abort.signal.aborted) { setMessage('Unable to check for updates. Retrying…'); setCheckError(e instanceof Error ? e.message : String(e)) }
      } finally { checking = false }
    }
    void check()
    const timer = setInterval(() => void check(), 3000)
    window.addEventListener(OWNER_EDITS_APPLIED, check)
    return () => { abort.abort(); clearInterval(timer); window.removeEventListener(OWNER_EDITS_APPLIED, check) }
  }, [binding.id, binding.ownerKey])
  async function apply() {
    setBusy(true)
    try {
      await bringSharedEdits(binding)
      setError('')
      onToast('Shared edits brought into your project. Originals preserved; Undo restores the previous edit.')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <aside className="shared-edit-bar" aria-label="Collaborator updates">
    <strong>{label}</strong><span role="status">{message}</span>
    {pending && <button className="chip confirm-primary" disabled={busy} onClick={() => void apply()}>{busy ? 'Bringing in edits…' : 'Bring shared edits into this project'}</button>}
    <small>Your local edits stay on this device. Bringing in updates can be undone.</small>
    {(error || checkError) && <p className="review-error" role="alert">{error || checkError}</p>}
  </aside>
}
