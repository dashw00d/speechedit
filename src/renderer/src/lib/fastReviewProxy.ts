import { REVIEW_MAX_ASSET_BYTES } from '../../../shared/review'

export class ProxyLimitError extends Error {}

/** Sparse frame sampling and a low-latency encoder avoid processing 30/60 output frames for an 8 fps preview. */
export async function encodeFastReviewProxy(source: Blob | string, kind: 'video' | 'audio', duration: number, signal: AbortSignal, progress: (ratio: number) => void): Promise<Blob> {
  const B = await import('mediabunny')
  signal.throwIfAborted()
  const input = new B.Input({ source: typeof source === 'string' ? new B.UrlSource(source) : new B.BlobSource(source), formats: B.ALL_FORMATS })
  let output: import('mediabunny').Output | undefined
  let pumps: Promise<void>[] = []
  const stop = () => { input.dispose(); void output?.cancel().catch(() => undefined) }
  signal.addEventListener('abort', stop, { once: true })
  try {
    signal.throwIfAborted()
    const actualDuration = await input.computeDuration()
    if (!Number.isFinite(actualDuration) || Math.abs(actualDuration - duration) > Math.max(1, duration * 0.01)) throw new Error('Source duration changed.')
    const video = kind === 'video' ? await input.getPrimaryVideoTrack() : null
    const audio = await input.getPrimaryAudioTrack()
    if ((kind === 'video' && !video) || (kind === 'audio' && !audio)) throw new Error('Required preview track is missing.')
    for (const track of [video, audio]) {
      if (track && !await track.canDecode()) throw new Error(`This browser cannot use fast decoding for ${await track.getCodec() || track.type}.`)
    }
    const target = new B.BufferTarget()
    output = new B.Output({ target, format: new B.WebMOutputFormat() })
    target.on('write', ({ end }) => { if (end > REVIEW_MAX_ASSET_BYTES) throw new ProxyLimitError('This preview exceeds 250 MiB. Share a shorter recording.') })
    let videoSource: import('mediabunny').VideoSampleSource | undefined, audioSource: import('mediabunny').AudioSampleSource | undefined
    if (video) {
      const w = await video.getDisplayWidth(), h = await video.getDisplayHeight(), scale = Math.min(1, 640 / w, 360 / h)
      videoSource = new B.VideoSampleSource({ codec: 'vp8', bitrate: 180_000, keyFrameInterval: 1, latencyMode: 'realtime', hardwareAcceleration: 'no-preference', transform: { width: Math.max(2, Math.round(w * scale / 2) * 2), height: Math.max(2, Math.round(h * scale / 2) * 2), fit: 'contain', force: true, alpha: 'discard' } })
      output.addVideoTrack(videoSource, { frameRate: 8 })
    }
    if (audio) {
      audioSource = new B.AudioSampleSource({ codec: 'opus', bitrate: 48_000, transform: { numberOfChannels: 2, sampleRate: 48000 } })
      output.addAudioTrack(audioSource)
    }
    await output.start()
    let videoTime = video ? 0 : duration, audioTime = audio ? 0 : duration, lastUpdate = 0
    const report = () => { const now = performance.now(); if (now - lastUpdate > 150) { lastUpdate = now; progress(Math.min(0.99, Math.min(videoTime, audioTime) / duration)) } }
    if (video && videoSource) {
      const track = video, encoder = videoSource
      pumps.push((async () => {
        const first = Math.max(0, await track.getFirstTimestamp())
        let frame = 0
        function* times() { for (let i = 0; first + i / 8 < duration; i++) yield first + i / 8 }
        const sink = new B.VideoSampleSink(track)
        for await (const sample of sink.samplesAtTimestamps(times())) {
          if (!sample) throw new Error('The fast decoder could not supply a preview frame.')
          try {
            signal.throwIfAborted()
            const timestamp = first + frame++ / 8
            sample.setTimestamp(timestamp); sample.setDuration(Math.min(1 / 8, duration - timestamp))
            await encoder.add(sample); videoTime = timestamp + sample.duration; report()
          } finally { sample.close() }
        }
        encoder.close(); videoTime = duration; report()
      })())
    }
    if (audio && audioSource) {
      const track = audio, encoder = audioSource
      pumps.push((async () => {
        for await (const sample of new B.AudioSampleSink(track).samples(0, duration)) {
          let part = sample
          try {
            signal.throwIfAborted()
            const start = Math.max(0, Math.ceil(-sample.timestamp * sample.sampleRate))
            const end = Math.min(sample.numberOfFrames, Math.round((duration - sample.timestamp) * sample.sampleRate))
            if (end <= start) continue
            if (start || end !== sample.numberOfFrames) part = sample.trim(start, end)
            await encoder.add(part); audioTime = part.timestamp + part.duration; report()
          } finally { if (part !== sample) part.close(); sample.close() }
        }
        encoder.close(); audioTime = duration; report()
      })())
    }
    await Promise.all(pumps); signal.throwIfAborted()
    await output.finalize(); signal.throwIfAborted()
    if (!target.buffer?.byteLength) throw new Error('Empty compressed preview.')
    progress(1)
    return new Blob([target.buffer], { type: `${kind}/webm` })
  } catch (error) {
    stop(); await output?.cancel().catch(() => undefined); await Promise.allSettled(pumps)
    throw error
  } finally { signal.removeEventListener('abort', stop); input.dispose() }
}
