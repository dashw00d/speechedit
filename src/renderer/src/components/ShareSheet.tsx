import { mergeSharedProjects, prepareSharedProject } from '../../../shared/collaboration'
import { readSharedState, writeSharedState, mountSharedProject } from '../lib/sharedSession'
import type { Project } from '../types'
import { useEffect, useRef, useState } from 'react'
import { useDialog } from '../useDialog'
import { useEditor, usePlayback } from '../store'
import { isElectron } from '../host'
import { applyReviewDecision, snapshotForReview } from '../lib/reviewProject'
import { createReview, forgetReview, rememberReview, reviewBindings, reviewLink, reviewRequest, uploadReviewPreview, type ReviewBinding } from '../lib/reviewApi'
import { encodeReviewProxy } from '../lib/reviewProxy'
import { type ReviewProposal, type ReviewRoom } from '../../../shared/review'
import { ReviewWorkspace } from './ReviewWorkspace'

export function ShareSheet({ onClose, onToast }: { onClose: () => void; onToast: (message: string) => void }) {
  const projectId = useEditor(s => s.project.id)
  const originalId = useRef(projectId)
  const [bindings, setBindings] = useState(() => reviewBindings(projectId))
  const [binding, setBinding] = useState<ReviewBinding | null>(bindings.at(-1) || null)
  const [room, setRoom] = useState<ReviewRoom | null>(null)
  const [mode, setMode] = useState<'audit' | 'edit'>('edit')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [ratio, setRatio] = useState(0)
  const [busy, setBusy] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const dialog = useDialog(true, () => { if (!busy) onClose() })
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    setRoom(current => current?.id === binding?.id ? current : null); setError('')
    if (!binding) return
    let cancelled = false
    void reviewRequest<ReviewRoom>(`/${binding.id}`, binding.ownerKey).then(value => { if (!cancelled) setRoom(value) }).catch(e => { if (!cancelled) setError(String(e.message)) })
    return () => { cancelled = true }
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
        setStatus(`Compressing ${asset.name} (${i + 1}/${assets.length})`)
        const blob = await encodeReviewProxy(asset, controller.signal, progress => setRatio((i + progress * 0.9) / assets.length), () => setStatus(`Compressing ${asset.name} at playback speed · keep this tab visible`))
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
      const latest = await reviewRequest<ReviewRoom>(`/${binding.id}`, binding.ownerKey)
      if (!latest.project) return
      const base = await readSharedState<Project>(`owner-base:${binding.id}`)
      if (!base) throw new Error('The original sharing baseline is missing in this browser. Open the shared editor and download its edit copy to recover it safely.')
      const current = useEditor.getState().project
      const merged = mergeSharedProjects(base, prepareSharedProject(current), latest.project)
      if (merged.conflicts.length) throw new Error(`Local and remote edits overlap: ${merged.conflicts.slice(0, 4).join(', ')}. Open the shared editor to review and download those edits before replacing local work.`)
      useEditor.getState().dispatch({ type: 'replaceProject', project: { ...mountSharedProject(merged.project, binding.id, current), reviewDecisions: current.reviewDecisions } })
      await writeSharedState(`owner-base:${binding.id}`, latest.project)
      setRoom(latest); setError(''); onToast('Shared edits brought into your project. Originals preserved; Undo restores the previous edit.')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  async function refresh() { if (binding) { try { setRoom(await reviewRequest<ReviewRoom>(`/${binding.id}`, binding.ownerKey)); setError('') } catch (e) { setError(String(e)) } } }
  async function decide(proposal: ReviewProposal, decision: 'accepted' | 'rejected') {
    if (!room || !binding) return
    const current = useEditor.getState().project
    const next = applyReviewDecision(current, room, proposal, decision)
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
    <header className="review-toolbar"><div><h1 id="share-title">Share project</h1><p>Give someone the full editor, or ask for feedback.</p></div><button className="chip" disabled={busy} onClick={onClose}>Close</button></header>
    {error && <p className="review-error" role="alert">{error}</p>}
    {isElectron ? <p>Open this project in the hosted web editor to create and manage review links.</p> : <>
      <p>Anyone with a full editing link can change the timeline, transcript, captions, effects, and audio, and add media. Audit links collect proposals for your approval. Original-quality rendering requires the source files.</p>
      <p>Previews use 8 fps video with continuous audio. Compression runs locally; older browsers may need playback-speed capture. Links expire after 30 days and can be revoked here.</p>
      <label>Access <select aria-label="Share access" value={mode} disabled={busy} onChange={e => setMode(e.target.value as 'edit' | 'audit')}><option value="edit">Full editing — changes save to the shared project</option><option value="audit">Audit — comments and proposed edits</option></select></label>
      <div className="review-toolbar"><button className="chip confirm-primary" disabled={busy} onClick={() => void create()}>{mode === 'edit' ? 'Create editing link' : binding ? 'Create fresh review snapshot' : 'Create review link'}</button>
        {bindings.length > 0 && <select aria-label="Review link" value={binding?.id || ''} disabled={busy} onChange={e => setBinding(bindings.find(b => b.id === e.target.value) || null)}><option value="">Choose a review</option>{bindings.map((b, i) => <option key={b.id} value={b.id}>Review {i + 1} · {b.id.slice(0, 6)}</option>)}</select>}
      </div>
      {busy && <div role="status"><p>{status}</p><progress max={1} value={ratio} /><button className="chip" onClick={() => abort.current?.abort()}>Cancel sharing</button></div>}
      {binding && <div className="review-link-box">
        {room?.published && <><label>{binding.mode === 'edit' ? 'Full editing link' : 'Audit link'}<input readOnly value={reviewLink(binding)} onFocus={e => e.target.select()} /></label><button className="chip" onClick={() => void navigator.clipboard.writeText(reviewLink(binding)).then(() => onToast('Review link copied.')).catch(() => setError('Select and copy the link above.'))}>Copy link</button><a className="chip" href={reviewLink(binding)} target="_blank" rel="noreferrer">{binding.mode === 'edit' ? 'Open full editor' : 'Open review'}</a></>}
        <button className="chip" onClick={() => void refresh()}>Refresh feedback</button>
        {room?.mode === 'edit' && <button className="chip confirm-primary" onClick={() => void pullEdits()}>Bring shared edits into this project</button>}
        <button className="chip" onClick={() => setConfirmRevoke(!confirmRevoke)}>Revoke link…</button>
        {confirmRevoke && <p>Remove this link, its previews, and feedback from the server? Your local edits stay. <button className="chip" onClick={() => void revoke()}>Revoke and delete previews</button></p>}
        <small>Owner access is saved in this browser. Save your project after accepting edits.</small>
      </div>}
      {room?.published && room.mode !== 'edit' && binding && <ReviewWorkspace room={room} accessKey={binding.ownerKey} onRoom={setRoom} onError={setError} onDecide={decide} decisionFor={p => useEditor.getState().project.reviewDecisions?.[`${room.id}:${p.id}`]} />}
    </>}
  </section></div>
}
