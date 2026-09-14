import { useEffect, useState } from 'react'
import { useEditor } from '../store'
import { reviewBindings, REVIEW_LINKS_CHANGED, type ReviewBinding } from '../lib/reviewApi'
import { bringSharedEdits, syncOwnerEdits, OWNER_EDITS_APPLIED } from '../lib/ownerSharedEdits'

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
        await syncOwnerEdits(binding, abort.signal, status => {
          if (abort.signal.aborted) return
          setPending(status.pending)
          setMessage(status.message)
        })
        setCheckError('')
      } catch (e) {
        if (!abort.signal.aborted) { setMessage('Your changes may not be shared yet. Retrying…'); setCheckError(e instanceof Error ? e.message : String(e)) }
      } finally { checking = false }
    }
    let editTimer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = useEditor.subscribe((state, previous) => {
      if (state.project === previous.project || state.project.id !== binding.projectId) return
      setMessage('Sharing your latest changes…')
      clearTimeout(editTimer)
      editTimer = setTimeout(() => void check(), 0)
    })
    void check()
    const timer = setInterval(() => void check(), 3000)
    window.addEventListener(OWNER_EDITS_APPLIED, check)
    return () => { abort.abort(); unsubscribe(); clearTimeout(editTimer); clearInterval(timer); window.removeEventListener(OWNER_EDITS_APPLIED, check) }
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
    <small>Your edits are shared automatically. Originals stay on this device. Bringing in updates can be undone.</small>
    {(error || checkError) && <p className="review-error" role="alert">{error || checkError}</p>}
  </aside>
}
