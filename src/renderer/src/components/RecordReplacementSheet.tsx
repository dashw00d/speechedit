import { useEffect, useRef, useState } from 'react'
import { useDialog } from '../useDialog'
import type { PreparedRecording } from '../lib/recordingEdges'
import type { Interval } from '../types'
import { captureAudio, type CapturedAudio, type CaptureProgress } from '../lib/recording'

export function RecordReplacementSheet({ words, duration: initialDuration, prepare, onClose, onUse, submitLabel = 'Use recording', name, onName }: {
  words: string; duration: number; onClose: () => void; onUse: (audio: CapturedAudio, signal: AbortSignal, range?: Interval) => Promise<void>; submitLabel?: string
  prepare?: (signal: AbortSignal) => Promise<PreparedRecording>
  name?: string; onName?: (name: string) => void
}) {
  const [prepareEdges] = useState(() => prepare)
  const [prepared, setPrepared] = useState<PreparedRecording | null>(null)
  const duration = prepared?.duration ?? initialDuration
  const [stage, setStage] = useState<'preparing' | 'ready' | 'permission' | 'recording' | 'listen' | 'saving'>(prepare ? 'preparing' : 'ready')
  const [progress, setProgress] = useState<CaptureProgress>({ countdown: 3, elapsed: 0, level: 0 })
  const [audio, setAudio] = useState<CapturedAudio | null>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [edgeNotice, setEdgeNotice] = useState('')
  const abort = useRef<AbortController | null>(null), finish = useRef<(() => void) | null>(null)
  const dialog = useDialog(true, () => { abort.current?.abort(); onClose() })
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    if (!prepareEdges) return
    const controller = new AbortController(); abort.current = controller
    void prepareEdges(controller.signal).then(result => {
      if (!controller.signal.aborted) { setPrepared(result); setStage('ready') }
    }).catch(() => {
      if (!controller.signal.aborted) { setEdgeNotice('Could not check the audio edges. The selected word boundaries will be used.'); setStage('ready') }
    })
    return () => controller.abort()
  }, [prepareEdges])
  useEffect(() => { if (!audio) { setUrl(''); return } const value = URL.createObjectURL(audio.blob); setUrl(value); return () => URL.revokeObjectURL(value) }, [audio])
  async function start() {
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller
    setAudio(null); setError(''); setStage('permission'); setProgress({ countdown: 3, elapsed: 0, level: 0 })
    try {
      const capture = await captureAudio(duration, controller.signal, setProgress)
      finish.current = capture.finish; setStage('recording')
      const result = await capture.result
      if (controller.signal.aborted) return
      setAudio(result); setStage('listen')
    } catch (e) { if (!controller.signal.aborted) { setStage('ready'); setError(e instanceof Error ? e.message : 'Could not record the microphone.') } }
  }
  async function useRecording() {
    if (!audio) return
    const controller = new AbortController(); abort.current = controller
    setStage('saving'); setError('')
    try { await onUse(audio, controller.signal, prepared?.range); if (!controller.signal.aborted) onClose() }
    catch (e) { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : 'Could not save this recording.'); setStage('listen') } }
  }
  return <div className="confirm-back"><section className="record-sheet" role="dialog" aria-modal="true" aria-labelledby="record-title" ref={dialog} tabIndex={-1}>
    <header className="review-toolbar"><h1 id="record-title">Re-record selected words</h1><button className="chip" onClick={() => { abort.current?.abort(); onClose() }}>Cancel</button></header>
    <blockquote>{words}</blockquote>
    <p>Your slot is <strong>{duration.toFixed(2)} seconds</strong>. The video and everything after this passage stay in place.</p>
    {onName && <label>Your name<input value={name || ''} maxLength={80} onChange={e => onName(e.target.value)} placeholder="Name shown on the recording suggestion" /></label>}
    {stage === 'preparing' && <p role="status">Finding quiet edges around the selected words…</p>}
    {(prepared || edgeNotice) && <p>{prepared?.note || edgeNotice}</p>}
    {error && <p className="review-error" role="alert">{error}</p>}
    {stage === 'ready' && <>{!error && <p>Get ready, then press Start. After 3–2–1, speak until the timer ends. You can listen and retry before using the take.</p>}<button className="chip confirm-primary" onClick={() => void start()}>{error ? 'Retry recording' : 'Start recording'}</button></>}
    {stage === 'permission' && <p role="status">Allow microphone access to begin the countdown…</p>}
    {stage === 'recording' && <>
      <div className="record-clock" role="status">{progress.countdown ? progress.countdown : `${Math.max(0, duration - progress.elapsed).toFixed(1)}s left`}</div>
      <p>{progress.countdown ? 'Get ready…' : 'Speak now'}</p>
      <progress aria-label="Recording time" max={duration} value={progress.elapsed} />
      <meter aria-label="Microphone level" min={0} max={1} value={progress.level} />
      <button className="chip" disabled={progress.countdown > 0} onClick={() => finish.current?.()}>Stop early</button>
    </>}
    {audio && <><audio controls src={url || undefined} aria-label="Listen to replacement recording" /><p>{audio.recordedDuration < duration - 0.05 ? `Stopped early. The last ${(duration - audio.recordedDuration).toFixed(2)} seconds are silence so the next section stays in place.` : 'Your recording fits the selected slot. Listen for clipped words or extra silence before using it.'}</p><div className="review-toolbar"><button className="chip" disabled={stage === 'saving'} onClick={() => void start()}>Retry recording</button><button className="chip confirm-primary" disabled={stage === 'saving' || !!onName && !name?.trim()} onClick={() => void useRecording()}>{stage === 'saving' ? 'Saving recording…' : submitLabel}</button></div></>}
  </section></div>
}
