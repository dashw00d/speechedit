import { useEffect, useRef, useState } from 'react'
import { editLabel, intersects, type ReviewEdit, type ReviewProposal, type ReviewRoom, type ReviewSpan } from '../../../shared/review'
import { reviewRequest } from '../lib/reviewApi'

export function ReviewWorkspace({ room, accessKey, onRoom, onError, onDecide, decisionFor }: {
  room: ReviewRoom; accessKey: string; onRoom: (room: ReviewRoom) => void; onError: (message: string) => void
  decisionFor?: (proposal: ReviewProposal) => 'accepted' | 'rejected' | undefined
  onDecide?: (proposal: ReviewProposal, status: 'accepted' | 'rejected') => Promise<void>
}) {
  const [author, setAuthor] = useState(() => localStorage.getItem('speechedit.review-name') || '')
  const [text, setText] = useState('')
  const [range, setRange] = useState<ReviewSpan>({ start: 0, end: Math.min(1, room.snapshot.sourceDuration) })
  const [anchor, setAnchor] = useState<string | null>(null)
  const [preview, setPreview] = useState<ReviewProposal | null>(null)
  const [sourceOnly, setSourceOnly] = useState(false)
  const [assetIndex, setAssetIndex] = useState(0)
  const [clock, setClock] = useState(0)
  const [busy, setBusy] = useState(false)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [chapter, setChapter] = useState(room.snapshot.scenes[0]?.id || '')
  const [title, setTitle] = useState('')
  const media = useRef<HTMLVideoElement>(null)
  const seekNext = useRef<{ time: number; play: boolean } | null>(null)
  const asset = room.snapshot.assets[assetIndex]
  const cuts = sourceOnly ? [] : [...room.snapshot.cuts,
    ...room.proposals.flatMap(p => p.status === 'accepted' && p.edit?.kind === 'cut' ? [p.edit] : []),
    ...(preview?.edit?.kind === 'cut' && preview.status !== 'accepted' ? [preview.edit] : [])]
  const cutsRef = useRef(cuts); cutsRef.current = cuts
  const proposals = [...room.proposals].reverse()
  function seek(time: number, play = false) {
    const index = room.snapshot.assets.findIndex(a => time >= a.sourceOffset && time < a.sourceOffset + a.duration)
    if (index < 0) return
    if (index !== assetIndex) { seekNext.current = { time, play }; setAssetIndex(index) }
    else if (media.current) { media.current.currentTime = Math.max(0, time - asset.sourceOffset); if (play) void media.current.play().catch(e => onError(String(e))) }
    setClock(time)
  }
  useEffect(() => {
    let frame: number
    const tick = () => {
      const element = media.current
      if (element && !element.paused && !element.seeking) {
        let time = asset.sourceOffset + element.currentTime
        // Merge chained/overlapping cuts by walking to the first retained source instant.
        for (let i = 0; i <= cutsRef.current.length; i++) {
          const cut = cutsRef.current.find(c => time >= c.start && time < c.end - 0.015)
          if (!cut) break
          time = cut.end
        }
        if (time >= asset.sourceOffset + asset.duration - 0.01) {
          const index = room.snapshot.assets.findIndex(a => time >= a.sourceOffset && time < a.sourceOffset + a.duration)
          if (index >= 0 && index !== assetIndex) { seekNext.current = { time, play: true }; setAssetIndex(index) }
          else element.pause()
        } else if (time - asset.sourceOffset > element.currentTime + 0.015) element.currentTime = time - asset.sourceOffset
        setClock(time)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [assetIndex, room.id, asset.sourceOffset, asset.duration])
  async function act(fn: () => Promise<void>) {
    setBusy(true)
    try { await fn() } catch (e) { onError(e instanceof Error ? e.message : 'Review action failed.') } finally { setBusy(false) }
  }
  async function submit(edit?: ReviewEdit) {
    await act(async () => {
      const next = await reviewRequest<ReviewRoom>(`/${room.id}/proposals`, accessKey, 'POST', { revision: room.revision, author, text, ...range, ...(edit ? { edit } : {}) })
      localStorage.setItem('speechedit.review-name', author); onRoom(next); setText('')
    })
  }
  function chooseWord(id: string, shift: boolean) {
    const words = room.snapshot.words
    const first = words.find(w => w.id === (shift && anchor ? anchor : id))!, last = words.find(w => w.id === id)!
    setRange({ start: Math.min(first.start, last.start), end: Math.max(first.end, last.end) })
    if (!shift || !anchor) setAnchor(id)
    seek(last.start)
  }
  return <div className="review-workspace">
    <div className="review-source">
      <div className="review-toolbar">
        <strong>Compressed source preview</strong>
        <select aria-label="Recording" value={assetIndex} onChange={e => { setAssetIndex(Number(e.target.value)); setPreview(null) }}>
          {room.snapshot.assets.map((a, i) => <option key={a.id} value={i}>{a.name}</option>)}
        </select>
      </div>
      <video data-audio={asset.kind === 'audio' || undefined} ref={media} controls playsInline preload="metadata" src={`/api/reviews/${room.id}/media/${asset.id}`}
        onLoadedMetadata={() => { const next = seekNext.current; if (next && media.current) { media.current.currentTime = Math.max(0, next.time - asset.sourceOffset); if (next.play) void media.current.play().catch(e => onError(String(e))); seekNext.current = null } }}
        onTimeUpdate={() => { if (media.current) setClock(asset.sourceOffset + media.current.currentTime) }}
        onEnded={() => { if (assetIndex + 1 < room.snapshot.assets.length) { seekNext.current = { time: room.snapshot.assets[assetIndex + 1].sourceOffset, play: true }; setAssetIndex(assetIndex + 1) } }}
        onError={() => onError('The preview could not load. Refresh this review link or ask the owner to reshare.')} />
      <div className="review-toolbar">
        <button className="chip" aria-pressed={sourceOnly} onClick={() => { setSourceOnly(true); seek(preview?.start ?? range.start) }}>Original source</button>
        <button className="chip" aria-pressed={!sourceOnly} onClick={() => { setSourceOnly(false); seek(Math.max(0, (preview?.start ?? range.start) - 1)) }}>{preview ? 'With proposal' : 'Shared cuts'}</button>
        <span>{clock.toFixed(2)}s source time</span>
      </div>
      {asset.waveform.length > 0 && <svg className="review-waveform" viewBox="0 0 1000 60" preserveAspectRatio="none" aria-label="Source audio waveform" role="img">
        {asset.waveform.map((peak, i) => <rect key={i} x={i / asset.waveform.length * 1000} y={30 - peak * 28} width={Math.max(0.5, 1000 / asset.waveform.length - 0.5)} height={Math.max(1, peak * 56)} />)}
        <line x1={(clock - asset.sourceOffset) / asset.duration * 1000} x2={(clock - asset.sourceOffset) / asset.duration * 1000} y1="0" y2="60" />
      </svg>}
      <input aria-label="Source position" type="range" min={asset.sourceOffset} max={asset.sourceOffset + asset.duration} step="0.01" value={clock} onChange={e => seek(Math.min(asset.sourceOffset + asset.duration - 0.001, Number(e.target.value)))} />
      <small>This preview shows source recordings and cuts. Titles, overlays, speed changes, and final effects stay in the owner’s editor.</small>
      {preview && <p className="review-preview-note">Previewing: {editLabel(preview.edit)} <button className="chip" onClick={() => setPreview(null)}>Clear preview</button></p>}
      <div className="review-transcript" aria-label="Shared transcript">
        <p>Click a word to seek. Shift-click another to select a passage. Proposed cuts are marked below.</p>
        {!room.snapshot.words.length && <p>No spoken transcript was shared. Use source times to leave feedback.</p>}
        {room.snapshot.words.map(word => {
          const marked = room.proposals.some(p => p.status === 'pending' && p.edit?.kind === 'cut' && intersects(word, p.edit))
          return <button key={word.id} className="review-word" data-selected={intersects(word, range) || undefined} data-proposed={marked || undefined}
            data-cut={word.deleted || [...room.snapshot.cuts, ...room.proposals.flatMap(p => p.status === 'accepted' && p.edit?.kind === 'cut' ? [p.edit] : [])].some(c => intersects(c, word)) || undefined}
            title={`${word.start.toFixed(2)}s${marked ? ' · proposed cut' : ''}`} onClick={e => chooseWord(word.id, e.shiftKey)}>{word.text}</button>
        })}
      </div>
    </div>
    <div className="review-feedback">
      <h2>Audit mode</h2><p>Proposals stay separate until the owner accepts them.</p>
      <label>Your name<input maxLength={80} value={author} onChange={e => setAuthor(e.target.value)} placeholder="Name shown on feedback" /></label>
      <div className="review-range">
        <label>From (seconds)<input type="number" min="0" max={room.snapshot.sourceDuration} step="0.01" value={range.start} onChange={e => setRange({ ...range, start: Number(e.target.value) })} /></label>
        <label>To (seconds)<input type="number" min="0" max={room.snapshot.sourceDuration} step="0.01" value={range.end} onChange={e => setRange({ ...range, end: Number(e.target.value) })} /></label>
      </div>
      <button className="chip" onClick={() => setRange({ start: clock, end: Math.min(room.snapshot.sourceDuration, clock + 1) })}>Use playhead</button>
      <label>Comment or reason<textarea value={text} maxLength={2000} onChange={e => setText(e.target.value)} placeholder="What would you change, and why?" /></label>
      <div className="review-toolbar">
        <button className="chip" disabled={busy || !author.trim() || !text.trim()} onClick={() => void submit()}>Add comment</button>
        <button className="chip confirm-primary" disabled={busy || !author.trim() || !text.trim() || range.end <= range.start} onClick={() => void submit({ kind: 'cut', ...range })}>Propose cut</button>
      </div>
      {room.snapshot.scenes.length > 0 && <details><summary>Propose a chapter title</summary>
        <label>Chapter<select value={chapter} onChange={e => setChapter(e.target.value)}>{room.snapshot.scenes.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        <label>New title<input value={title} maxLength={300} onChange={e => setTitle(e.target.value)} /></label>
        <button className="chip" disabled={busy || !author.trim() || !text.trim() || !title.trim()} onClick={() => void submit({ kind: 'renameChapter', sceneId: chapter, title })}>Propose title</button>
      </details>}
      <h3>Feedback · {room.proposals.length}</h3>
      {!proposals.length && <p>No feedback yet. Select a passage and leave the first suggestion.</p>}
      {proposals.map(p => <article className="review-proposal" key={p.id} data-status={p.status}>
        <div className="review-toolbar"><strong>{p.author}</strong><span className="review-status">{p.status}</span></div>
        <strong>{editLabel(p.edit)}</strong><small>{p.start.toFixed(2)}–{p.end.toFixed(2)}s · {new Date(p.createdAt).toLocaleString()}</small>
        <p>{p.text}</p>
        <div className="review-toolbar">
          <button className="chip" onClick={() => { setPreview(p); setSourceOnly(false); seek(Math.max(0, p.start - 1), true) }}>Preview</button>
          <button className="chip" onClick={() => { setReplyTo(replyTo === p.id ? null : p.id); setReply('') }}>Reply</button>
          {onDecide && (p.status === 'pending' || (p.status === 'accepted' && !decisionFor?.(p))) && <>
            <button className="chip confirm-primary" disabled={busy} onClick={() => void act(() => onDecide(p, 'accepted'))}>{p.status === 'accepted' ? 'Apply accepted edit' : p.edit ? 'Accept edit' : 'Resolve'}</button>
            {p.status === 'pending' && <button className="chip" disabled={busy} onClick={() => void act(() => onDecide(p, 'rejected'))}>Reject</button>}
          </>}
        </div>
        {p.replies.map(r => <p className="review-reply" key={r.id}><strong>{r.author}</strong> {r.text}</p>)}
        {replyTo === p.id && <form onSubmit={e => { e.preventDefault(); void act(async () => {
          onRoom(await reviewRequest<ReviewRoom>(`/${room.id}/proposals/${p.id}/reply`, accessKey, 'POST', { revision: room.revision, author, text: reply })); setReply(''); setReplyTo(null)
        }) }}><label>Reply<textarea maxLength={2000} value={reply} onChange={e => setReply(e.target.value)} /></label><button className="chip" disabled={busy || !author.trim() || !reply.trim()}>Post reply</button></form>}
      </article>)}
    </div>
  </div>
}
