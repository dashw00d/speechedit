import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ReviewRoom, ReviewSpan } from '../../../shared/review'
import { reviewScope, REVIEW_TIMEBASE } from '../../../shared/reviewMedia'
import { ReviewAudioTransport } from '../lib/reviewAudio'
import { reviewRequest } from '../lib/reviewApi'

export interface ReviewPlayerHandle { seek: (time: number, play?: boolean, until?: number) => void; pause: () => void }
export const ReviewPlayer = forwardRef<ReviewPlayerHandle, { room: ReviewRoom; accessKey: string; cuts: ReviewSpan[]; selection: ReviewSpan; onClock: (time: number) => void; onRoom: (room: ReviewRoom) => void; onError: (message: string) => void }>(function ReviewPlayer({ room, accessKey, cuts, selection, onClock, onRoom, onError }, ref) {
  const scope = reviewScope(room.snapshot)
  const [time, setTime] = useState(scope.start), [playing, setPlaying] = useState(false), [buffering, setBuffering] = useState(false)
  const [imageReady, setImageReady] = useState(false)
  const measuredReady = useRef(false)
  const [detailPosition, setDetailPosition] = useState(selection.start)
  const [detail, setDetail] = useState<'motion' | 'detail' | null>(null), [requesting, setRequesting] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const current = useRef({ room, key: accessKey, cuts }); current.current = { room, key: accessKey, cuts }
  const callbacks = useRef({ onClock, onError }); callbacks.current = { onClock, onError }
  const transport = useRef<ReviewAudioTransport | null>(null)
  transport.current ||= new ReviewAudioTransport(() => current.current, (t, active, waiting) => { setTime(t); setPlaying(active); setBuffering(waiting); callbacks.current.onClock(t) }, message => callbacks.current.onError(message))
  const pause = () => { transport.current?.pause(); video.current?.pause() }
  useImperativeHandle(ref, () => ({ seek: (time, play, until) => { video.current?.pause(); setDetail(null); void transport.current?.seek(time, play, until).catch(e => onError(String(e))) }, pause }))
  useEffect(() => () => transport.current?.close(), [])
  useEffect(() => { if (playing) void transport.current?.seek(time, true) }, [JSON.stringify(cuts)])
  useEffect(() => {
    if (!measuredReady.current && time > scope.start && (imageReady || room.snapshot.assets[0]?.kind === 'audio')) {
      measuredReady.current = true
      performance.mark('review-first-audio-and-image')
      performance.measure('review-open-to-first-audio-and-image', { start: 0, end: 'review-first-audio-and-image' })
    }
  }, [time, imageReady, scope.start, room.snapshot.assets])
  const rows = room.delivery?.representations || []
  const thumbnail = rows.filter(r => r.kind === 'thumbnail' && r.start / REVIEW_TIMEBASE <= time).sort((a, b) => b.start - a.start)[0]
  const selectedVideo = room.snapshot.assets.find(a => a.kind === 'video' && a.sourceOffset < selection.end && a.sourceOffset + a.duration > selection.start)
  const selected = { start: Math.max(scope.start, selection.start, selectedVideo?.sourceOffset ?? scope.start), end: Math.min(scope.end, selection.end, selection.start + 30, selectedVideo ? selectedVideo.sourceOffset + selectedVideo.duration : scope.end) }
  const clips = detail ? rows.filter(r => r.kind === detail && r.start / REVIEW_TIMEBASE <= detailPosition && r.end / REVIEW_TIMEBASE > detailPosition) : []
  const clip = clips[0]
  useEffect(() => { if (clip && video.current && video.current.readyState >= 1) video.current.currentTime = Math.max(0, detailPosition - clip.start / REVIEW_TIMEBASE) }, [clip?.id, detailPosition])
  const request = room.delivery?.requests.find(r => r.kind === detail && r.start === selected.start && r.end === selected.end)
  const senderOnline = Date.now() - (room.delivery?.senderSeenAt || 0) < 20_000
  async function requestDetail(kind: 'motion' | 'detail') {
    pause(); setDetailPosition(selected.start); setDetail(kind); setRequesting(true)
    try { onRoom(await reviewRequest<ReviewRoom>(`/${room.id}/details`, accessKey, 'POST', { ...selected, kind })) }
    catch (e) { onError(e instanceof Error ? e.message : String(e)) } finally { setRequesting(false) }
  }
  return <div className="review-player">
    {detail && clip ? <video ref={video} controls playsInline preload="metadata" src={`/api/reviews/${room.id}/representations/${clip.id}`} onPlay={() => transport.current?.pause()} onLoadedMetadata={() => { if (video.current) { video.current.currentTime = Math.max(0, detailPosition - clip.start / REVIEW_TIMEBASE); if (detailPosition > selected.start) void video.current.play().catch(() => undefined) } }} onEnded={() => { if (clip.end / REVIEW_TIMEBASE < selected.end) setDetailPosition(clip.end / REVIEW_TIMEBASE) }} onTimeUpdate={() => { if (video.current) { const at = Math.min(selected.end, clip.start / REVIEW_TIMEBASE + video.current.currentTime); setTime(at); onClock(at); if (at >= selected.end) video.current.pause() } }} />
      : thumbnail ? <figure><img onLoad={() => setImageReady(true)} src={`/api/reviews/${room.id}/representations/${thumbnail.id}`} alt={`Recording at ${(thumbnail.start / REVIEW_TIMEBASE).toFixed(2)} seconds`} /><figcaption>Still image · {(thumbnail.start / REVIEW_TIMEBASE).toFixed(2)}s source time</figcaption></figure> : <p>Audio review · images arrive as they are prepared.</p>}
    <div className="review-toolbar">
      <button className="chip confirm-primary" onClick={() => { if (playing) pause(); else { setDetail(null); void transport.current?.seek(time >= scope.end ? scope.start : time, true).catch(e => onError(String(e))) } }}>{playing ? 'Pause audio' : 'Play audio'}</button>
      <span role="status">{buffering ? 'Waiting for the next audio section…' : `${time.toFixed(2)}s source time`}</span>
      {room.snapshot.assets.some(a => a.kind === 'video') && <><button className="chip" title={`${selected.start.toFixed(2)}–${selected.end.toFixed(2)}s source time`} disabled={requesting || !selectedVideo || selected.end <= selected.start} onClick={() => void requestDetail('motion')}>Watch this section</button><button className="chip" title={`${selected.start.toFixed(2)}–${selected.end.toFixed(2)}s source time`} disabled={requesting || !selectedVideo || selected.end <= selected.start} onClick={() => void requestDetail('detail')}>Detailed video</button></>}
    </div>
    <input type="range" aria-label="Source position" min={scope.start} max={scope.end} step="0.01" value={time} onChange={e => { setDetail(null); void transport.current?.seek(Number(e.target.value)) }} />
    {detail && !clip && <p role="status">{request?.status === 'failed' ? request.error : senderOnline ? 'Preparing this section. It will appear here when ready.' : 'Requested. The sender needs to reopen this project to provide video for this section.'}</p>}
    {detail === 'detail' && clip && <small>Source-rate video for this interval. This compressed detail copy is not an original-quality export.</small>}
    {room.delivery?.state !== 'complete' && <p role="status">{room.delivery?.state === 'partial' || room.delivery?.state === 'failed' || !senderOnline ? 'Upload incomplete. Available sections and feedback are saved.' : 'You can review now. More audio and images are uploading.'}</p>}
  </div>
})
