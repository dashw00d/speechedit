import { prepareSharedProject } from '../../../shared/collaboration'
import { writeSharedState } from '../lib/sharedSession'
import { bringSharedEdits } from '../lib/ownerSharedEdits'
import { useEffect, useRef, useState } from 'react'
import { useDialog } from '../useDialog'
import { useEditor, usePlayback } from '../store'
import { isElectron } from '../host'
import { applyReviewDecision, snapshotForReview } from '../lib/reviewProject'
import { createReview, forgetReview, rememberReview, reviewBindings, reviewLink, reviewRequest, uploadReviewPreview, type ReviewBinding } from '../lib/reviewApi'
import { encodeReviewProxy } from '../lib/reviewProxy'
import { type ReviewProposal, type ReviewRoom } from '../../../shared/review'
import { ReviewWorkspace } from './ReviewWorkspace'
import { focusForWords, resolveReviewFocus } from '../lib/reviewLinks'
import type { useReviewInbox } from '../lib/useReviewInbox'
import { keepRecordingOriginal, recordingPreview } from '../lib/recordingClient'

export function ShareSheet({ onClose, onToast, initialView = 'share', inbox }: { onClose: () => void; onToast: (message: string) => void; initialView?: 'share' | 'inbox'; inbox: ReturnType<typeof useReviewInbox> }) {
  const projectId = useEditor(s => s.project.id)
  const originalId = useRef(projectId)
  const [bindings, setBindings] = useState(() => reviewBindings(projectId))
  const [binding, setBinding] = useState<ReviewBinding | null>(() => initialView === 'inbox' ? bindings.find(b => inbox.summaries[b.id]?.pending > 0) || bindings.find(b => b.mode !== 'edit') || null : bindings.at(-1) || null)
  const [view, setView] = useState(initialView)
  const [selectedIds] = useState(() => [...useEditor.getState().selectedWordIds])
  const [passage, setPassage] = useState(selectedIds.length > 0)
  const [question, setQuestion] = useState('')
  const [room, setRoom] = useState<ReviewRoom | null>(null)
  const [mode, setMode] = useState<'audit' | 'edit'>(bindings.at(-1)?.mode || 'audit')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [ratio, setRatio] = useState(0)
  const [busy, setBusy] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const localWords = useEditor(s => s.project.transcript.words)
  const localFocus = focusForWords(localWords, selectedIds, question)
  const linkFocus = room ? focusForWords(room.snapshot.words, selectedIds, question) : undefined
  const passageWords = room && linkFocus ? resolveReviewFocus(room.snapshot, linkFocus)?.words : localWords.filter(w => selectedIds.includes(w.id))
  const link = binding ? reviewLink(binding, passage ? linkFocus : undefined) : ''
  const passageMissing = passage && binding?.mode !== 'edit' && room?.published && !linkFocus
  const abort = useRef<AbortController | null>(null)
  const dialog = useDialog(true, () => { if (!busy) onClose() })
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    setRoom(current => current?.id === binding?.id ? current : null); setError('')
    if (!binding) return
    let cancelled = false
    const refreshRoom = () => void reviewRequest<ReviewRoom>(`/${binding.id}`, binding.ownerKey).then(value => { if (!cancelled) setRoom(current => current?.id === value.id && current.revision > value.revision ? current : value) }).catch(e => { if (!cancelled) setError(String(e.message)) })
    refreshRoom()
    const timer = setInterval(refreshRoom, 15000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [binding?.id])
  useEffect(() => { if (projectId !== originalId.current) onClose() }, [projectId])
  async function create() {
    const editor = useEditor.getState(), project = editor.project
    if (editor.analyzing || editor.exporting) { setError('Finish the current media job before sharing.'); return }
    setBusy(true); setError(''); setStatus('Preparing review'); setRatio(0)
    const controller = new AbortController(); abort.current = controller
    let made: ReviewBinding | null = null
    usePlayback.getState().pause()
    editor.setAnalyzing('share')
    try {
      const snapshot = snapshotForReview(project)
      const shared = mode === 'edit' ? prepareSharedProject(project) : undefined
      const result = await createReview(snapshot, controller.signal, shared)
      made = { id: result.room.id, projectId: project.id, ownerKey: result.ownerKey, reviewerKey: result.reviewerKey, mode }
      rememberReview(made)
      const assets = mode === 'edit' ? Object.values(project.assets) : snapshot.assets.map(a => project.assets[a.id])
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i]
        let modeLabel = 'fast encoder', detail = '', started = performance.now()
        setStatus(`Compressing ${asset.name} (${i + 1}/${assets.length})`)
        const blob = await recordingPreview(asset, controller.signal) || await encodeReviewProxy(asset, controller.signal, progress => {
          setRatio((i + progress * 0.9) / assets.length)
          const elapsed = (performance.now() - started) / 1000
          const remaining = progress > 0.02 && elapsed > 2 ? Math.ceil(elapsed * (1 - progress) / progress) : null
          const eta = remaining == null ? '' : remaining >= 60 ? ` · about ${Math.ceil(remaining / 60)} min left` : ` · about ${remaining}s left`
          setStatus(`${asset.name} · ${modeLabel}${eta}${detail}`)
        }, value => {
          started = performance.now()
          modeLabel = value.mode === 'cached' ? 'reusing saved preview' : value.mode === 'playback' ? 'playback speed — keep this tab visible' : `${value.mode === 'fast' ? 'fast' : 'compatibility'} encoder`
          detail = value.mode === 'playback' && value.detail ? `. ${value.detail}` : ''
          setStatus(`${asset.name} · ${modeLabel}${detail}`)
        })
        setStatus(`Uploading ${asset.name} · ${(blob.size / 1024 / 1024).toFixed(1)} MiB`)
        await uploadReviewPreview(made, asset.id, blob, controller.signal, progress => setRatio((i + 0.9 + progress * 0.1) / assets.length))
        setRatio((i + 1) / assets.length)
      }
      const published = await reviewRequest<ReviewRoom>(`/${made.id}/publish`, made.ownerKey, 'POST', {}, controller.signal)
      if (shared) await writeSharedState(`owner-base:${made.id}`, shared)
      setBindings(reviewBindings(project.id)); setBinding(made); setRoom(published); setStatus('Share link ready.'); onToast(mode === 'edit' ? 'Full editing link ready. Collaborators can use the complete editor.' : 'Audit link ready. Your originals stayed on this device.')
    } catch (e) {
      setError(controller.signal.aborted ? 'Sharing cancelled.' : e instanceof Error ? e.message : 'Sharing failed.')
      if (made) {
        try { await reviewRequest(`/${made.id}`, made.ownerKey, 'DELETE'); forgetReview(made.id) }
        catch { setBindings(reviewBindings(project.id)); setBinding(made); setError('Sharing did not finish. The incomplete upload is saved here so you can revoke it.') }
      }
    } finally { setBusy(false); abort.current = null; if (useEditor.getState().project.id === project.id) useEditor.getState().setAnalyzing(null) }
  }
  async function pullEdits() {
    if (!binding) return
    try {
      const latest = await bringSharedEdits(binding)
      setRoom(latest); setError(''); onToast('Shared edits brought into your project. Originals preserved; Undo restores the previous edit.')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  async function refresh() { if (binding) { try { setRoom(await reviewRequest<ReviewRoom>(`/${binding.id}`, binding.ownerKey)); setError('') } catch (e) { setError(String(e)) } } }
  async function decide(proposal: ReviewProposal, decision: 'accepted' | 'rejected') {
    if (!room || !binding) return
    let decisionRoom = room
    if (decision === 'accepted' && proposal.edit?.kind === 'replaceAudio') {
      const asset = room.mediaAssets?.[proposal.edit.assetId]
      if (!asset) throw new Error('This replacement recording is unavailable.')
      decisionRoom = { ...room, mediaAssets: { ...room.mediaAssets, [asset.id]: await keepRecordingOriginal(asset, room.id, binding.ownerKey) } }
    }
    const current = useEditor.getState().project
    const next = applyReviewDecision(current, decisionRoom, proposal, decision)
    if (next !== current) useEditor.getState().dispatch({ type: 'replaceProject', project: next })
    // The decision is durable in the local project before acknowledgment, so a network failure is retryable without applying twice.
    try {
      const latest = await reviewRequest<ReviewRoom>(`/${room.id}`, binding.ownerKey)
      const remote = latest.proposals.find(p => p.id === proposal.id)
      if (remote?.status === decision) { setRoom(latest); return }
      setRoom(await reviewRequest<ReviewRoom>(`/${room.id}/proposals/${proposal.id}/resolve`, binding.ownerKey, 'POST', { revision: latest.revision, status: decision }))
      setError(''); onToast(decision === 'accepted' ? 'Accepted into your project. Undo restores the previous edit.' : 'Feedback rejected.')
    } catch { throw new Error('Decision saved in your project; server acknowledgment failed. Refresh and click the same decision to sync it safely.') }
  }
  async function revoke() {
    if (!binding) return
    try {
      try { await reviewRequest(`/${binding.id}`, binding.ownerKey, 'DELETE') }
      catch (e) { if (!(e instanceof Error) || !/expired, was revoked, or does not exist/.test(e.message)) throw e }
      forgetReview(binding.id); setBindings(reviewBindings(projectId)); setBinding(null); setRoom(null); setConfirmRevoke(false); setError('')
    } catch (e) { setError(String(e)) }
  }
  return <div className="confirm-back"><section className="share-sheet" role="dialog" aria-modal="true" aria-labelledby="share-title" ref={dialog} tabIndex={-1}>
    <header className="review-toolbar"><div><h1 id="share-title">{view === 'inbox' ? 'Feedback inbox' : 'Share project'}</h1><p>{view === 'inbox' ? 'Listen, compare, and decide. Accepted edits are undoable.' : 'Send a link. Your friend can watch, read, and suggest edits without an account.'}</p></div><button className="chip" disabled={busy} onClick={onClose}>Close</button></header>
    <nav className="review-toolbar" aria-label="Sharing workspace"><button className="chip" aria-pressed={view === 'share'} disabled={busy} onClick={() => setView('share')}>Share a link</button><button className="chip" aria-pressed={view === 'inbox'} disabled={busy} onClick={() => { setView('inbox'); if (binding?.mode === 'edit') setBinding(bindings.find(b => b.mode !== 'edit') || null) }}>Feedback · {inbox.pending}</button></nav>
    {error && <p className="review-error" role="alert">{error}</p>}
    {isElectron ? <p>Open this project in the hosted web editor to create and manage review links.</p> : <>
      {view === 'share' && <>
      <p>Audit links let your friend comment, correct transcript words, and suggest cuts for your approval. Choose Full editing to let them edit the shared project directly.</p>
      <p>Anyone with the link has the access you choose. Links expire after 30 days; you can revoke them here.</p>
      <details><summary>What gets shared?</summary><p>A compressed video preview with continuous audio and your transcript. Originals stay on this device. Previews use 8 fps; older browsers may need playback-speed capture. Original-quality rendering requires the source files.</p></details>
      <label>Access <select aria-label="Share access" value={mode} disabled={busy} onChange={e => setMode(e.target.value as 'edit' | 'audit')}><option value="audit">Audit — comments and suggested edits</option><option value="edit">Full editing — changes save to the shared project</option></select></label>
      {mode === 'audit' && localFocus && <div className="review-share-passage">
        <label><input type="checkbox" checked={passage} disabled={busy} onChange={e => setPassage(e.target.checked)} /> Open at the selected passage</label>
        {passage && <><blockquote>{passageWords?.map(w => w.text).join(' ')}</blockquote><label>Ask your friend (optional)<textarea aria-label="Question for your friend" maxLength={500} value={question} disabled={busy} onChange={e => setQuestion(e.target.value)} placeholder="Does this sound right?" /></label><small>The link opens at these words. Your friend can still watch the whole video.</small></>}
      </div>}
      <div className="review-toolbar"><button className="chip confirm-primary" disabled={busy} onClick={() => void create()}>{mode === 'edit' ? 'Create editing link' : binding ? 'Create fresh review snapshot' : 'Create review link'}</button>
        {bindings.length > 0 && <select aria-label="Review link" value={binding?.id || ''} disabled={busy} onChange={e => setBinding(bindings.find(b => b.id === e.target.value) || null)}><option value="">Choose a review</option>{bindings.map((b, i) => <option key={b.id} value={b.id}>Review {i + 1} · {b.id.slice(0, 6)}</option>)}</select>}
      </div>
      </>}
      {view === 'inbox' && <div className="review-toolbar" aria-label="Review copies">
        {!inbox.bindings.length && <p>No review links yet. Share an Audit link to collect suggestions.</p>}
        {inbox.bindings.map((b, i) => <button key={b.id} className="chip" aria-pressed={binding?.id === b.id} onClick={() => setBinding(b)}>{inbox.summaries[b.id]?.name || `Review ${i + 1}`} · {inbox.summaries[b.id]?.pending ?? '…'} pending{inbox.unavailable[b.id] ? ' · unavailable' : ''}</button>)}
      </div>}
      {busy && <div role="status"><p>{status}</p><progress max={1} value={ratio} /><button className="chip" onClick={() => abort.current?.abort()}>Cancel sharing</button></div>}
      {view === 'share' && binding && <div className="review-link-box">
        {passageMissing && <p role="alert">These words are not in this review copy. Create a fresh review snapshot to share this passage.</p>}
        {room?.published && !passageMissing && <><label>{binding.mode === 'edit' ? 'Full editing link' : passage && linkFocus ? 'Passage review link' : 'Audit link'}<input readOnly value={link} onFocus={e => e.target.select()} /></label><button className="chip" onClick={() => void navigator.clipboard.writeText(link).then(() => onToast('Review link copied.')).catch(() => setError('Select and copy the link above.'))}>Copy link</button><a className="chip" href={link} target="_blank" rel="noreferrer">{binding.mode === 'edit' ? 'Open full editor' : 'Open review'}</a></>}
        <button className="chip" onClick={() => void refresh()}>Refresh feedback</button>
        {room?.mode === 'edit' && <button className="chip confirm-primary" onClick={() => void pullEdits()}>Bring shared edits into this project</button>}
        <button className="chip" onClick={() => setConfirmRevoke(!confirmRevoke)}>Revoke link…</button>
        {confirmRevoke && <p>Remove this link, its previews, and feedback from the server? Your local edits stay. <button className="chip" onClick={() => void revoke()}>Revoke and delete previews</button></p>}
        <small>Owner access is saved in this browser. Save your project after accepting edits.</small>
      </div>}
      {room?.published && room.mode !== 'edit' && binding && <ReviewWorkspace key={`${room.id}:${view}`} inbox={view === 'inbox'} room={room} accessKey={binding.ownerKey} onRoom={setRoom} onError={setError} onDecide={decide} decisionFor={p => useEditor.getState().project.reviewDecisions?.[`${room.id}:${p.id}`]} />}
    </>}
  </section></div>
}
