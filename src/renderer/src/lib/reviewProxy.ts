import type { Asset } from '../types'
import { mediaUrl } from '../host'
import { REVIEW_MAX_ASSET_BYTES } from '../../../shared/review'

/** Encode only a small preview on the owner's device. Never upload the original as a fallback. */
export async function encodeReviewProxy(asset: Asset, signal: AbortSignal, progress: (ratio: number) => void): Promise<Blob> {
  if (!asset.path) throw new Error(`Relink ${asset.name} before sharing.`)
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot create compressed previews. Open SpeechEdit in Brave, Chrome, or Edge.')
  const video = asset.kind === 'video'
  const mime = (video ? ['video/webm;codecs=vp8,opus', 'video/webm'] : ['audio/webm;codecs=opus', 'audio/webm']).find(m => MediaRecorder.isTypeSupported(m))
  if (!mime) throw new Error('This browser cannot encode WebM previews.')
  signal.throwIfAborted()
  const media = document.createElement('video')
  media.crossOrigin = 'anonymous'; media.preload = 'auto'; media.playsInline = true
  // Keep decoding alive without showing or sounding a second player.
  media.style.cssText = 'position:fixed;left:-2px;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none'
  document.body.append(media)
  const context = new AudioContext()
  const destination = context.createMediaStreamDestination(); destination.channelCount = 1
  const source = context.createMediaElementSource(media); source.connect(destination)
  const canvas = document.createElement('canvas')
  const streams: MediaStream[] = []
  let recorder: MediaRecorder | undefined, drawTimer: ReturnType<typeof setInterval> | undefined
  let resumeVisible = false
  const visibility = () => {
    if (!recorder || media.ended) return
    if (document.hidden && !media.paused) { resumeVisible = true; media.pause(); if (recorder.state === 'recording') recorder.pause() }
    else if (!document.hidden && resumeVisible) { resumeVisible = false; if (recorder.state === 'paused') recorder.resume(); void media.play().catch(() => { media.dispatchEvent(new Event('error')) }) }
  }
  try {
    await context.resume()
    await new Promise<void>((ok, fail) => {
      const done = (error?: Error) => { clearTimeout(timer); signal.removeEventListener('abort', abort); media.onloadeddata = null; media.onerror = null; error ? fail(error) : ok() }
      const abort = () => done(new Error('Sharing cancelled.'))
      const timer = setTimeout(() => done(new Error(`Could not load ${asset.name}. Relink the recording and try again.`)), 30000)
      media.onloadeddata = () => done(); media.onerror = () => done(new Error(`Cannot decode ${asset.name}.`)); signal.addEventListener('abort', abort, { once: true })
      media.src = mediaUrl(asset.path); media.load()
    })
    signal.throwIfAborted()
    if (!Number.isFinite(media.duration) || Math.abs(media.duration - asset.duration) > Math.max(1, asset.duration * 0.01)) throw new Error(`${asset.name} has changed duration. Reimport it before sharing.`)
    const scale = Math.min(1, 640 / Math.max(1, media.videoWidth), 360 / Math.max(1, media.videoHeight))
    canvas.width = Math.max(2, Math.round(media.videoWidth * scale / 2) * 2); canvas.height = Math.max(2, Math.round(media.videoHeight * scale / 2) * 2)
    const ctx = canvas.getContext('2d')!
    if (video) { ctx.drawImage(media, 0, 0, canvas.width, canvas.height); streams.push(canvas.captureStream(15)) }
    streams.push(destination.stream)
    const stream = new MediaStream(streams.flatMap(s => s.getTracks()))
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 300_000, audioBitsPerSecond: 48_000 })
    const active = recorder
    const chunks: Blob[] = []; let size = 0
    const result = new Promise<Blob>((ok, fail) => {
      const abort = () => { cleanup(); fail(new Error('Sharing cancelled.')) }
      const deadline = setTimeout(() => { cleanup(); fail(new Error('Preview encoding stalled. Keep this tab visible and try again.')) }, Math.max(60000, asset.duration * 2000 + 30000))
      const cleanup = () => { clearTimeout(deadline); signal.removeEventListener('abort', abort) }
      active.ondataavailable = e => { if (e.data.size) { size += e.data.size; chunks.push(e.data) }; if (size > REVIEW_MAX_ASSET_BYTES) { cleanup(); fail(new Error('This preview exceeds 250 MiB. Share a shorter recording.')) } }
      active.onerror = () => { cleanup(); fail(new Error('Preview encoding failed.')) }
      active.onstop = () => { cleanup(); size ? ok(new Blob(chunks, { type: `${video ? 'video' : 'audio'}/webm` })) : fail(new Error('The compressed preview is empty.')) }
      signal.addEventListener('abort', abort, { once: true })
      media.onerror = () => { cleanup(); fail(new Error('The recording stopped decoding.')) }
      media.onended = () => { if (active.state !== 'inactive') active.stop() }
      media.onwaiting = () => { if (active.state === 'recording') active.pause() }
      media.onplaying = () => { if (active.state === 'paused' && !document.hidden) active.resume() }
    })
    // Attach rejection handling before playback can fail, and stop all resources in finally.
    void result.catch(() => undefined)
    drawTimer = setInterval(() => { if (video && !media.paused) ctx.drawImage(media, 0, 0, canvas.width, canvas.height); progress(Math.min(1, media.currentTime / asset.duration)) }, 1000 / 15)
    document.addEventListener('visibilitychange', visibility)
    active.start(1000)
    await media.play()
    visibility()
    return await result
  } finally {
    clearInterval(drawTimer); document.removeEventListener('visibilitychange', visibility)
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    for (const stream of streams) for (const track of stream.getTracks()) track.stop()
    media.pause(); media.removeAttribute('src'); media.load(); media.remove(); source.disconnect(); await context.close().catch(() => undefined)
  }
}
