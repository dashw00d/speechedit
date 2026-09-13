import { useEffect, useRef, useState } from 'react'
import { editLabel, intersects, type ReviewEdit, type ReviewProposal, type ReviewRoom, type ReviewSpan } from '../../../shared/review'
import { reviewRequest, reviewMutation } from '../lib/reviewApi'
import { resolveReviewFocus, reviewPlaybackRange, type ReviewFocus } from '../lib/reviewLinks'
import { readReviewDraft, saveReviewDraft } from '../lib/reviewDraft'
import { RecordReplacementSheet } from './RecordReplacementSheet'
import { uploadRecording } from '../lib/recordingClient'

export function ReviewWorkspace({ room, accessKey, onRoom, onError, onDecide, decisionFor, focus, inbox = false }: {
  room: ReviewRoom; accessKey: string; onRoom: (room: ReviewRoom) => void; onError: (message: string) => void
  focus?: ReviewFocus; inbox?: boolean
  decisionFor?: (proposal: ReviewProposal) => 'accepted' | 'rejected' | undefined
  onDecide?: (proposal: ReviewProposal, status: 'accepted' | 'rejected') => Promise<void>
}) {
  const [landing] = useState(() => resolveReviewFocus(room.snapshot, focus))
  const draftId = `${room.id}:${focus ? `${focus.start}:${focus.end}:${focus.firstWordId || ''}:${focus.lastWordId || ''}` : 'whole'}`
  const [draft] = useState(() => readReviewDraft(draftId, !!onDecide, room.snapshot.sourceDuration))
  const [{ initialRange, initialIds }] = useState(() => {
    const ids = new Set(room.snapshot.words.map(w => w.id))
    return { initialRange: draft.range || landing?.focus || { start: 0, end: Math.min(1, room.snapshot.sourceDuration) }, initialIds: (draft.selectedIds || landing?.words.map(w => w.id) || []).filter(id => ids.has(id)) }
  })
  const [author, setAuthor] = useState(() => { try { return localStorage.getItem('speechedit.review-name') || '' } catch { return '' } })
  const [text, setText] = useState(draft.text || '')
  const [range, setRange] = useState<ReviewSpan>(initialRange)
  const [anchor, setAnchor] = useState<string | null>(initialIds[0] || null)
  const [extendSelection, setExtendSelection] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>(initialIds)
  const [correction, setCorrection] = useState(draft.correction ?? (initialIds.length === 1 ? room.snapshot.words.find(w => w.id === initialIds[0])?.text || '' : ''))
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<ReviewProposal | null>(null)
  const [sourceOnly, setSourceOnly] = useState(!!landing)
  const [assetIndex, setAssetIndex] = useState(Math.max(0, room.snapshot.assets.findIndex(a => initialRange.start >= a.sourceOffset && initialRange.start < a.sourceOffset + a.duration)))
  const [clock, setClock] = useState(initialRange.start)
  const [busy, setBusy] = useState(false)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replies, setReplies] = useState<Record<string, string>>(draft.replies || {})
  const reply = replyTo ? replies[replyTo] || '' : ''
  const setReply = (value: string) => { if (replyTo) setReplies(current => ({ ...current, [replyTo]: value })) }
  const [chapter, setChapter] = useState(draft.chapter || room.snapshot.scenes[0]?.id || '')
  const [title, setTitle] = useState(draft.title || '')
  const [draftSaved, setDraftSaved] = useState(true)
  const [filter, setFilter] = useState<'pending' | 'all'>(inbox ? 'pending' : 'all')
  const [activeProposal, setActiveProposal] = useState<string | null>(null)
  const [recording, setRecording] = useState<{ start: number; end: number; words: string } | null>(null)
  const media = useRef<HTMLVideoElement>(null)
  const feedback = useRef<HTMLDivElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const seekNext = useRef<{ time: number; play: boolean } | null>({ time: initialRange.start, play: false })
  const stopAt = useRef<number | null>(null)
  const asset = room.snapshot.assets[assetIndex]
  const selected = new Set(selectedIds)
  const selectedWord = selectedIds.length === 1 ? room.snapshot.words.find(w => w.id === selectedIds[0]) : undefined
  const selectedText = room.snapshot.words.filter(w => selected.has(w.id)).map(w => w.text).join(' ')
  const acceptedCuts = [...room.snapshot.cuts, ...room.proposals.flatMap(p => p.status === 'accepted' && p.edit?.kind === 'cut' ? [p.edit] : [])]
  const acceptedCorrections = new Map(room.proposals.flatMap(p => p.status === 'accepted' && p.edit?.kind === 'correctWord' ? [[p.edit.wordId, p.edit] as const] : []))
  const cuts = sourceOnly ? [] : [...acceptedCuts,
    ...(preview?.edit?.kind === 'cut' && preview.status !== 'accepted' ? [preview.edit] : [])]
  const cutsRef = useRef(cuts); cutsRef.current = cuts
  const pending = room.proposals.filter(p => p.status === 'pending')
  const proposals = [...room.proposals].reverse().filter(p => filter === 'all' || p.status === 'pending')
  useEffect(() => {
    setDraftSaved(saveReviewDraft(draftId, !!onDecide, { text, range, selectedIds, correction, chapter, title, replies }))
  }, [draftId, !!onDecide, text, range, selectedIds, correction, chapter, title, replies])
  useEffect(() => { try { localStorage.setItem('speechedit.review-name', author) } catch { /* Feedback is still usable without local storage. */ } }, [author])
  useEffect(() => {
    const word = transcript.current?.querySelector<HTMLElement>('[data-selected]')
    if (word && transcript.current) transcript.current.scrollTop = word.offsetTop - transcript.current.offsetTop - 60
  }, [])
  function seek(time: number, play = false) {
    stopAt.current = null
    const index = room.snapshot.assets.findIndex(a => time >= a.sourceOffset && time < a.sourceOffset + a.duration)
    if (index < 0) return
    if (index !== assetIndex) { seekNext.current = { time, play }; setAssetIndex(index) }
    else if (media.current) { if (!play) media.current.pause(); media.current.currentTime = Math.max(0, time - asset.sourceOffset); if (play) void media.current.play().catch(e => onError(String(e))) }
    setClock(time)
  }
  function playPassage(span: ReviewSpan, proposal?: ReviewProposal, original = false) {
    setPreview(proposal || null); setSourceOnly(original)
    const window = reviewPlaybackRange(span, room.snapshot.sourceDuration)
    seek(window.start, true); stopAt.current = window.end
  }
  function nextPending() {
    const index = pending.findIndex(p => p.id === activeProposal)
    const next = pending[(index + 1) % pending.length]
    if (!next) return
    setFilter('pending'); setActiveProposal(next.id)
    setRange({ start: next.start, end: next.end }); setSelectedIds([])
    seek(next.start)
    requestAnimationFrame(() => feedback.current?.querySelector<HTMLElement>(`[data-proposal-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' }))
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
        if (stopAt.current != null && time >= stopAt.current) {
          element.pause(); element.currentTime = Math.max(0, Math.min(asset.duration, stopAt.current - asset.sourceOffset)); setClock(stopAt.current); stopAt.current = null
          frame = requestAnimationFrame(tick); return
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
    setBusy(true); onError(''); setNotice('')
    try { await fn() } catch (e) { onError(e instanceof Error ? e.message : 'Review action failed.') } finally { setBusy(false) }
  }
  async function submit(edit?: ReviewEdit) {
    await act(async () => {
      const next = await reviewMutation(room.id, '/proposals', accessKey, room.revision, { author, text, ...range, ...(edit ? { edit } : {}) })
      onRoom(next); setText(value => value === text ? '' : value)
      if (edit?.kind === 'renameChapter') setTitle(value => value === edit.title ? '' : value)
      if (edit?.kind === 'correctWord') setCorrection(value => value.trim() === edit.text ? selectedWord?.text || '' : value)
      setNotice(edit ? 'Suggestion sent. The owner can review and accept it.' : 'Comment sent.')
    })
  }
  function chooseWord(id: string, shift: boolean) {
    const words = room.snapshot.words
    const first = words.find(w => w.id === (shift && anchor ? anchor : id))!, last = words.find(w => w.id === id)!
    const firstIndex = words.indexOf(first), lastIndex = words.indexOf(last)
    setSelectedIds(words.slice(Math.min(firstIndex, lastIndex), Math.max(firstIndex, lastIndex) + 1).map(w => w.id))
    setCorrection(first === last ? last.text : '')
    setPreview(null)
    setRange({ start: Math.min(first.start, last.start), end: Math.max(first.end, last.end) })
    if (!shift || !anchor) setAnchor(id)
    setExtendSelection(false)
    seek(last.start)
  }
  return <><div className="review-workspace">
    {landing && <section className="review-focus" aria-label="Shared passage">
      <strong>{landing.focus.question || 'Your friend shared this passage'}</strong>
      {landing.words.length > 0 && <blockquote>{landing.words.map(w => w.text).join(' ')}</blockquote>}
      <div className="review-toolbar"><button className="chip confirm-primary" onClick={() => playPassage(landing.focus, undefined, true)}>Play passage</button><button className="chip" onClick={() => { setRange(landing.focus); setSelectedIds(landing.words.map(w => w.id)); setCorrection(landing.words.length === 1 ? landing.words[0].text : ''); feedback.current?.scrollIntoView({ block: 'start' }); feedback.current?.querySelector('input')?.focus({ preventScroll: true }) }}>Respond to this passage</button><small>{landing.focus.start.toFixed(2)}–{landing.focus.end.toFixed(2)}s · full recording available below</small></div>
    </section>}
    {focus && !landing && <p role="status">This passage is outside the shared recording. You can still review the full video below.</p>}
    <div className="review-source">
      <div className="review-toolbar">
        <strong>Watch and review</strong>
        <select aria-label="Recording" value={assetIndex} onChange={e => { setAssetIndex(Number(e.target.value)); setPreview(null) }}>
          {room.snapshot.assets.map((a, i) => <option key={a.id} value={i}>{a.name}</option>)}
        </select>
      </div>
      <video data-audio={asset.kind === 'audio' || undefined} ref={media} controls playsInline preload="metadata" src={`/api/reviews/${room.id}/media/${asset.id}`}
        onLoadedMetadata={() => { const next = seekNext.current; if (next && media.current) { media.current.currentTime = Math.max(0, next.time - asset.sourceOffset); if (next.play) void media.current.play().catch(e => onError(String(e))); seekNext.current = null } }}
        onTimeUpdate={() => { if (media.current) setClock(asset.sourceOffset + media.current.currentTime) }}
        onEnded={() => { if (stopAt.current != null && asset.sourceOffset + asset.duration >= stopAt.current) { stopAt.current = null; return } if (assetIndex + 1 < room.snapshot.assets.length) { seekNext.current = { time: room.snapshot.assets[assetIndex + 1].sourceOffset, play: true }; setAssetIndex(assetIndex + 1) } }}
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
      <div className="review-transcript" aria-label="Shared transcript" ref={transcript}>
        <p>Tap a word to seek and suggest a correction. Select a passage using the button below, or Shift-click its last word.</p>
        <div className="review-toolbar">
          <button className="chip" disabled={!anchor} aria-pressed={extendSelection} onClick={() => setExtendSelection(!extendSelection)}>{extendSelection ? 'Cancel passage selection' : 'Select through another word'}</button>
          {!inbox && selectedIds.length > 0 && <button className="chip" onClick={() => { feedback.current?.scrollIntoView({ block: 'start' }); feedback.current?.querySelector('input')?.focus({ preventScroll: true }) }}>Suggest an edit</button>}
          {!inbox && selectedIds.length > 0 && <button className="chip" disabled={busy || range.end - range.start < 0.1 || range.end - range.start > 120} onClick={() => { if (room.snapshot.cuts.some(c => intersects(c, range))) { onError('Choose a passage without shared cuts to suggest a recording.'); return } media.current?.pause(); setRecording({ ...range, words: selectedText }) }}>Re-record audio</button>}
        </div>
        {extendSelection && <p role="status">Tap the last word of your passage. Shift-click also works.</p>}
        {!room.snapshot.words.length && <p>No spoken transcript was shared. Use source times to leave feedback.</p>}
        {room.snapshot.words.map(word => {
          const marked = room.proposals.some(p => p.status === 'pending' && (p.edit?.kind === 'cut' && intersects(word, p.edit) || p.edit?.kind === 'correctWord' && p.edit.wordId === word.id))
          const acceptedCorrection = acceptedCorrections.get(word.id)
          const shownCorrection = preview?.edit?.kind === 'correctWord' && preview.edit.wordId === word.id ? preview.edit : acceptedCorrection
          const displayedText = shownCorrection?.kind === 'correctWord' && !sourceOnly ? shownCorrection.text : word.text
          return <button key={word.id} className="review-word" data-selected={(selectedIds.length ? selected.has(word.id) : intersects(word, range)) || undefined} data-proposed={marked || undefined}
            data-current={clock >= word.start && clock < Math.max(word.end, word.start + 0.06) || undefined}
            data-cut={word.deleted || acceptedCuts.some(c => intersects(c, word)) || undefined}
            title={`${word.start.toFixed(2)}s${marked ? ' · suggested edit' : ''}`} onClick={e => chooseWord(word.id, e.shiftKey || extendSelection)}>{displayedText}</button>
        })}
      </div>
    </div>
    <div className="review-feedback" ref={feedback}>
      {inbox ? <>
        <h2>Review suggestions</h2><p role="status">{pending.length ? `${pending.length} suggestion${pending.length === 1 ? '' : 's'} waiting for your decision.` : 'You’re caught up on this review.'}</p>
        <div className="review-toolbar"><button className="chip" aria-pressed={filter === 'pending'} onClick={() => setFilter('pending')}>Needs review · {pending.length}</button><button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All feedback</button><button className="chip" disabled={!pending.length} onClick={nextPending}>Next pending</button></div>
        <label>Your name<input maxLength={80} value={author} onChange={e => setAuthor(e.target.value)} placeholder="Name shown on replies" /></label>
      </> : <>
      <h2>Suggest an edit</h2><p>No account needed. Your suggestions stay separate until the owner accepts them.</p>
      <label>Your name<input maxLength={80} value={author} onChange={e => setAuthor(e.target.value)} placeholder="Name shown on feedback" /></label>
      {selectedText && <p className="review-selection">Selected: “{selectedText}”</p>}
      {selectedWord && <div className="review-correction">
        <label>Correct selected word<input aria-label="Correct selected word" value={correction} maxLength={1000} onChange={e => setCorrection(e.target.value)} /></label>
        <button className="chip confirm-primary" disabled={busy || !author.trim() || !correction.trim() || correction.trim() === selectedWord.text} onClick={() => void submit({ kind: 'correctWord', wordId: selectedWord.id, text: correction.trim() })}>Suggest correction</button>
      </div>}
      <details><summary>Adjust selection times</summary>
      <div className="review-range">
        <label>From (seconds)<input type="number" min="0" max={room.snapshot.sourceDuration} step="0.01" value={range.start} onChange={e => { setSelectedIds([]); setRange({ ...range, start: Number(e.target.value) }) }} /></label>
        <label>To (seconds)<input type="number" min="0" max={room.snapshot.sourceDuration} step="0.01" value={range.end} onChange={e => { setSelectedIds([]); setRange({ ...range, end: Number(e.target.value) }) }} /></label>
      </div>
      <button className="chip" onClick={() => { setSelectedIds([]); setRange({ start: clock, end: Math.min(room.snapshot.sourceDuration, clock + 1) }) }}>Use playhead</button>
      </details>
      <label>Comment or reason (optional for edits)<textarea value={text} maxLength={2000} onChange={e => setText(e.target.value)} placeholder="What would you change, and why?" /></label>
      <div className="review-toolbar">
        <button className="chip" disabled={busy || !author.trim() || !text.trim() || range.end <= range.start} onClick={() => void submit()}>Add comment</button>
        <button className="chip" disabled={busy || !author.trim() || range.end - range.start < 0.03} onClick={() => void submit({ kind: 'cut', ...range })}>Propose cut</button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {room.snapshot.scenes.length > 0 && <details><summary>Propose a chapter title</summary>
        <label>Chapter<select value={chapter} onChange={e => setChapter(e.target.value)}>{room.snapshot.scenes.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        <label>New title<input value={title} maxLength={300} onChange={e => setTitle(e.target.value)} /></label>
        <button className="chip" disabled={busy || !author.trim() || !title.trim()} onClick={() => void submit({ kind: 'renameChapter', sceneId: chapter, title })}>Propose title</button>
      </details>}
      </>}
      {(text || title || Object.values(replies).some(Boolean) || selectedWord && correction !== selectedWord.text) && <small role="status">{draftSaved ? 'Unsent feedback saved on this device.' : 'Draft could not be saved on this device. Keep this page open until you send it.'}</small>}
      <h3>Feedback · {room.proposals.length}</h3>
      {!proposals.length && <p>{inbox ? filter === 'pending' ? 'No pending suggestions. Open All feedback to see earlier decisions and replies.' : 'Your friend’s suggestions will appear here.' : 'No feedback yet. Select a passage and leave the first suggestion.'}</p>}
      {proposals.map(p => <article className="review-proposal" key={p.id} data-status={p.status} data-proposal-id={p.id} data-active={activeProposal === p.id || undefined}>
        <div className="review-toolbar"><strong>{p.author}</strong><span className="review-status">{p.status}</span></div>
        <strong>{editLabel(p.edit)}</strong><small>{p.start.toFixed(2)}–{p.end.toFixed(2)}s · {new Date(p.createdAt).toLocaleString()}</small>
        {p.edit?.kind === 'correctWord' ? <p className="review-word-diff"><span>Original: “{room.snapshot.words.find(w => p.edit?.kind === 'correctWord' && w.id === p.edit.wordId)?.text}”</span><span aria-hidden="true"> → </span><strong>Suggested: “{p.edit.text}”</strong></p> : <blockquote>{room.snapshot.words.filter(w => intersects(w, p)).map(w => w.text).join(' ')}</blockquote>}
        {p.text !== editLabel(p.edit) && <p>{p.text}</p>}
        {p.edit?.kind === 'replaceAudio' && <audio controls preload="metadata" aria-label="Proposed voice recording" onPlay={() => media.current?.pause()} src={`/api/reviews/${room.id}/media/${p.edit.assetId}`} />}
        <div className="review-toolbar">
          <button className="chip" onClick={() => { setActiveProposal(p.id); playPassage(p, p, true) }}>Play original</button>
          {p.edit?.kind !== 'replaceAudio' && <button className="chip" onClick={() => { setActiveProposal(p.id); playPassage(p, p) }}>Preview</button>}
          <button className="chip" onClick={() => setReplyTo(replyTo === p.id ? null : p.id)}>Reply</button>
          {onDecide && (p.status === 'pending' || (p.status === 'accepted' && !decisionFor?.(p))) && <>
            <button className="chip confirm-primary" disabled={busy} onClick={() => void act(() => onDecide(p, 'accepted'))}>{p.status === 'accepted' ? 'Apply accepted edit' : p.edit ? 'Accept edit' : 'Resolve'}</button>
            {p.status === 'pending' && <button className="chip" disabled={busy} onClick={() => void act(() => onDecide(p, 'rejected'))}>Reject</button>}
          </>}
        </div>
        {p.replies.map(r => <p className="review-reply" key={r.id}><strong>{r.author}</strong> {r.text}</p>)}
        {replyTo === p.id && <form onSubmit={e => { e.preventDefault(); void act(async () => {
          onRoom(await reviewMutation(room.id, `/proposals/${p.id}/reply`, accessKey, room.revision, { author, text: reply })); setReplies(current => current[p.id] === reply ? { ...current, [p.id]: '' } : current); setReplyTo(current => current === p.id ? null : current)
        }) }}><label>Reply<textarea maxLength={2000} value={reply} onChange={e => setReply(e.target.value)} /></label><button className="chip" disabled={busy || !author.trim() || !reply.trim()}>Post reply</button></form>}
      </article>)}
    </div>
  </div>{recording && <RecordReplacementSheet words={recording.words} duration={recording.end - recording.start} name={author} onName={setAuthor} onClose={() => setRecording(null)} submitLabel="Send recording suggestion" onUse={async (audio, signal) => {
    const asset = await uploadRecording(audio, signal, { id: room.id, key: accessKey })
    if (signal.aborted) return
    const next = await reviewMutation(room.id, '/proposals', accessKey, room.revision, { author, text: text.trim() || 'Suggested voice replacement', edit: { kind: 'replaceAudio', start: recording.start, end: recording.end, assetId: asset.id } })
    onRoom(next); setText(''); setNotice('Recording sent. The owner can listen and accept it.')
  }} />}</>
}
