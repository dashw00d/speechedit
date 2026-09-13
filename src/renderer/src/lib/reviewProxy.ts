import { browserMediaForPath } from './browserMediaStore'
import { encodeFastReviewProxy, ProxyLimitError } from './fastReviewProxy'
import { cachedReviewProxy, cacheReviewProxy } from './reviewProxyCache'
import type { Asset } from '../types'
import { mediaUrl } from '../host'
import { REVIEW_MAX_ASSET_BYTES } from '../../../shared/review'

/** Encode only a small preview on the owner's device. Never upload the original as a fallback. */
async function encodeRealtimeProxy(asset: Asset, signal: AbortSignal, progress: (ratio: number) => void): Promise<Blob> {
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
  const destination = context.createMediaStreamDestination(); destination.channelCount = 2
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
    if (video) { ctx.drawImage(media, 0, 0, canvas.width, canvas.height); streams.push(canvas.captureStream(8)) }
    streams.push(destination.stream)
    const stream = new MediaStream(streams.flatMap(s => s.getTracks()))
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 180_000, audioBitsPerSecond: 48_000 })
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
    drawTimer = setInterval(() => { if (video && !media.paused) ctx.drawImage(media, 0, 0, canvas.width, canvas.height); progress(Math.min(1, media.currentTime / asset.duration)) }, 1000 / 8)
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

/** Timestamp-based conversion runs as fast as decoding permits; playback capture remains a compatibility fallback. */
async function encodeCompatibleProxy(asset: Asset, signal: AbortSignal, progress: (ratio: number) => void, onFallback?: (reason: string) => void): Promise<Blob> {
  signal.throwIfAborted()
  if (asset.kind === 'image') {
    const response = await fetch(mediaUrl(asset.path), { signal })
    if (!response.ok) throw new Error(`Cannot read ${asset.name}.`)
    const bitmap = await createImageBitmap(await response.blob())
    try {
      const ratio = Math.min(1, 960 / bitmap.width, 960 / bitmap.height)
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob(v => v ? ok(v) : fail(new Error('Image compression failed.')), 'image/webp', 0.65))
      signal.throwIfAborted(); progress(1); return blob
    } finally { bitmap.close() }
  }
  let input: import('mediabunny').Input | undefined
  let conversion: import('mediabunny').Conversion | undefined
  const abort = () => { void conversion?.cancel().catch(() => undefined) }
  try {
    const { Input, Output, UrlSource, BlobSource, ALL_FORMATS, WebMOutputFormat, BufferTarget, Conversion } = await import('mediabunny')
    const file = browserMediaForPath(asset.path)
    input = new Input({ source: file ? new BlobSource(file) : new UrlSource(mediaUrl(asset.path)), formats: ALL_FORMATS })
    const duration = await input.computeDuration()
    if (!Number.isFinite(duration) || Math.abs(duration - asset.duration) > Math.max(1, asset.duration * 0.01)) throw new Error('Source duration changed.')
    const target = new BufferTarget()
    const output = new Output({ target, format: new WebMOutputFormat() })
    const track = await input.getPrimaryVideoTrack()
    const width = track ? await track.getDisplayWidth() : 640, height = track ? await track.getDisplayHeight() : 360, scale = Math.min(1, 640 / width, 360 / height)
    conversion = await Conversion.init({ input, output, tracks: 'primary',
      video: asset.kind === 'video' ? { codec: 'vp8', width: Math.max(2, Math.round(width * scale / 2) * 2), height: Math.max(2, Math.round(height * scale / 2) * 2), fit: 'contain', allowRotationMetadata: false, frameRate: 8, bitrate: 180_000, keyFrameInterval: 1, hardwareAcceleration: 'prefer-software', forceTranscode: true } : { discard: true },
      audio: { codec: 'opus', numberOfChannels: 2, sampleRate: 48000, bitrate: 48_000, forceTranscode: true }
    })
    if (!conversion.isValid || conversion.discardedTracks.length) throw new Error('The fast encoder cannot preserve every media track.')
    signal.addEventListener('abort', abort, { once: true }); signal.throwIfAborted()
    conversion.onProgress = ratio => { progress(ratio) }
    target.on('write', ({ end }) => { if (end > REVIEW_MAX_ASSET_BYTES) { void conversion?.cancel(); throw new Error('This preview exceeds 250 MiB.') } })
    await conversion.execute(); signal.throwIfAborted()
    if (!target.buffer?.byteLength) throw new Error('Empty preview.')
    return new Blob([target.buffer], { type: `${asset.kind}/webm` })
  } catch (error) {
    if (signal.aborted) throw error
    await conversion?.cancel().catch(() => undefined)
    onFallback?.(error instanceof Error ? error.message : 'Fast encoding is unavailable.'); progress(0)
  } finally { signal.removeEventListener('abort', abort); input?.dispose() }
  return encodeRealtimeProxy(asset, signal, progress)
}

export interface ProxyEncodingStatus { mode: 'fast' | 'compatible' | 'playback' | 'cached'; detail?: string }
export async function encodeReviewProxy(asset: Asset, signal: AbortSignal, progress: (ratio: number) => void, status?: (value: ProxyEncodingStatus) => void): Promise<Blob> {
  signal.throwIfAborted()
  const file = browserMediaForPath(asset.path)
  const key = file ? JSON.stringify(['proxy-v2-8fps-realtime', asset.kind, asset.duration, file.name, file.size, file.lastModified]) : undefined
  if (key) {
    const saved = await cachedReviewProxy(key)
    signal.throwIfAborted()
    if (saved) { status?.({ mode: 'cached' }); progress(1); return saved }
  }
  let blob: Blob
  try {
    status?.({ mode: 'fast' })
    blob = asset.kind === 'image' ? await encodeCompatibleProxy(asset, signal, progress)
      : await encodeFastReviewProxy(file || mediaUrl(asset.path), asset.kind, asset.duration, signal, progress)
  } catch (error) {
    if (signal.aborted || error instanceof ProxyLimitError) throw error
    status?.({ mode: 'compatible', detail: error instanceof Error ? error.message : String(error) })
    progress(0)
    blob = await encodeCompatibleProxy(asset, signal, progress, detail => status?.({ mode: 'playback', detail }))
  }
  signal.throwIfAborted()
  if (key) await cacheReviewProxy(key, blob)
  signal.throwIfAborted()
  return blob
}
