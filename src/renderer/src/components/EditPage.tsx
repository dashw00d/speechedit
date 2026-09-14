import { useEffect, useRef, useState } from 'react'
import { App } from '../App'
import { CollaborationClient, type CollaborationStatus } from '../lib/collaborationClient'
import { useEditor } from '../store'

export function EditPage() {
  const [linkKey, setLinkKey] = useState(() => location.hash.slice(1))
  useEffect(() => {
    const changed = () => setLinkKey(location.hash.slice(1))
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  // A new fragment is a new access attempt, even on the same room. Remount
  // so the old client stops and its ready editor cannot survive a bad key.
  return <EditSession key={linkKey} linkKey={linkKey} />
}

function EditSession({ linkKey }: { linkKey: string }) {
  const [ready, setReady] = useState(false), [error, setError] = useState('')
  const [status, setStatus] = useState<CollaborationStatus>({ message: 'Opening shared editor…', revision: 0, history: [] })
  const [name, setName] = useState(() => localStorage.getItem('speechedit.editor-name') || '')
  const nameRef = useRef(name); nameRef.current = name
  const client = useRef<CollaborationClient | null>(null)
  useEffect(() => {
    const active = new CollaborationClient(location.pathname.split('/')[2], linkKey, () => nameRef.current, setStatus)
    client.current = active; let cancelled = false
    void active.open().then(() => { if (!cancelled) setReady(true) }).catch(e => { if (!cancelled) setError(String(e.message)) })
    return () => { cancelled = true; active.stop() }
  }, [linkKey])
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(useEditor.getState().project, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'shared-edit-draft.speechedit.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className="shared-editor">
    <aside className="shared-edit-bar" aria-label="Shared editing">
      <strong>Full editing</strong><span role="status">{error ? 'Link not opened' : status.message} {status.revision ? `· v${status.revision}` : ''}</span>
      <label>Your name <input aria-label="Editor name" maxLength={80} value={name} onChange={e => { setName(e.target.value); localStorage.setItem('speechedit.editor-name', e.target.value) }} placeholder="Editor" /></label>
      <button className="chip" disabled={!ready} onClick={() => void client.current?.sync()}>Save now</button>
      <button className="chip" disabled={!ready} onClick={download}>Download edit copy</button>
      <a className="chip" href="/" target="_blank" rel="noreferrer">My workspace</a>
      <small>Changes save to this shared project. Final rendering requires the originals.</small>
      {!!status.history.length && <details><summary>Recent saves</summary>{status.history.slice(-10).reverse().map(h => <p key={h.revision}>v{h.revision} · {h.author} · {new Date(h.at).toLocaleString()}</p>)}</details>}
      {(error || status.error) && <p className="review-error" role="alert">{error || status.error}</p>}
      {!!status.conflicts?.length && <div role="alert" className="shared-conflict"><strong>Another editor changed the same items.</strong><p>{status.conflicts.slice(0, 5).join(', ')}</p><p>Your draft is preserved. Download a copy before choosing which changes to keep.</p><button className="chip" onClick={() => void client.current?.resolve(true).catch(e => setError(String(e)))}>Keep my conflicting edits</button><button className="chip" onClick={() => void client.current?.resolve(false).catch(e => setError(String(e)))}>Use saved project</button></div>}
    </aside>
    {ready && <App />}
  </div>
}
