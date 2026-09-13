import * as B from 'mediabunny'

type Job = { id: number; kind: 'audio' | 'thumbnail' | 'motion' | 'detail'; start: number; end: number }
const scope = globalThis as unknown as { onmessage: (e: MessageEvent) => void; postMessage: (message: unknown) => void }
let input: B.Input | undefined, preview: B.Input | undefined
/** One input per source, reused across bounded jobs. Terminating the worker cancels decoding. */
scope.onmessage = async ({ data }) => {
  try {
    if (data.source) {
      input?.dispose(); preview?.dispose()
      preview = data.preview ? new B.Input({ source: new B.BlobSource(data.preview), formats: B.ALL_FORMATS }) : undefined
      input = new B.Input({ source: data.source instanceof Blob ? new B.BlobSource(data.source) : new B.UrlSource(data.source), formats: B.ALL_FORMATS })
      scope.postMessage({ id: data.id, ready: true }); return
    }
    if (!input) throw new Error('Open the source recording first.')
    const job = data as Job, started = performance.now()
    let decodeMs = 0, encodeMs = 0, blob: Blob
    if (job.kind === 'thumbnail') {
      const track = await (preview || input).getPrimaryVideoTrack()
      if (!track) throw new Error('This recording has no video.')
      const width = await track.getDisplayWidth(), height = await track.getDisplayHeight(), scale = Math.min(1, 640 / width, 360 / height)
      const sink = new B.CanvasSink(track, { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)), fit: 'contain' })
      // This frame is the image displayed at the first permitted instant.
      const frame = await sink.getCanvas(job.start)
      if (!frame) throw new Error('This section has no available picture.')
      decodeMs = performance.now() - started
      blob = await (frame.canvas as OffscreenCanvas).convertToBlob({ type: 'image/webp', quality: 0.6 })
    } else {
      const target = new B.BufferTarget(), output = new B.Output({ target, format: new B.WebMOutputFormat() })
      target.on('write', ({ end }) => { if (end > 16 * 1024 * 1024) throw new Error('This section is too large. Choose a shorter passage.') })
      try {
        if (job.kind === 'audio') {
          const track = await input.getPrimaryAudioTrack()
          const encoder = new B.AudioSampleSource({ codec: 'opus', bitrate: 24_000, transform: { numberOfChannels: 1, sampleRate: 48000 } })
          output.addAudioTrack(encoder); await output.start()
          const rate = track ? await track.getSampleRate() : 48000, channels = track ? await track.getNumberOfChannels() : 1
          let cursor = 0
          const silenceUntil = async (end: number) => {
            const frames = Math.round((end - cursor) * rate)
            if (frames <= 0) return
            const silence = new B.AudioSample({ format: 'f32', sampleRate: rate, numberOfChannels: channels, timestamp: cursor, data: new Float32Array(frames * channels) })
            try { await encoder.add(silence) } finally { silence.close() }
            cursor += frames / rate
          }
          if (track) {
            const samples = new B.AudioSampleSink(track).samples(job.start, job.end)
            let decodeStart = performance.now()
            for await (const sample of samples) {
              decodeMs += performance.now() - decodeStart
              let part: B.AudioSample | undefined
              try {
                const from = Math.max(0, Math.ceil((job.start - sample.timestamp) * sample.sampleRate - 1e-6))
                const to = Math.min(sample.numberOfFrames, Math.ceil((job.end - sample.timestamp) * sample.sampleRate - 1e-6))
                if (to > from) {
                  part = sample.trim(from, to); part.setTimestamp(Math.max(0, part.timestamp - job.start))
                  const encodeStart = performance.now(); await silenceUntil(part.timestamp); await encoder.add(part); cursor = part.timestamp + part.duration; encodeMs += performance.now() - encodeStart
                }
              } finally { part?.close(); sample.close(); decodeStart = performance.now() }
            }
          }
          await silenceUntil(job.end - job.start)
          encoder.close(); await output.finalize()
        } else {
          const track = await input.getPrimaryVideoTrack()
          if (!track) throw new Error('This passage has no video.')
          const width = await track.getDisplayWidth(), height = await track.getDisplayHeight()
          const scale = job.kind === 'detail' ? 1 : Math.min(1, 640 / width, 360 / height)
          const conversion = await B.Conversion.init({ input, output, tracks: 'primary', copy: false, trim: { start: job.start, end: job.end },
            video: { codec: 'vp8', fit: 'contain', width: Math.max(2, Math.round(width * scale / 2) * 2), height: Math.max(2, Math.round(height * scale / 2) * 2), ...(job.kind === 'motion' ? { frameRate: 15 } : {}), bitrate: job.kind === 'detail' ? 2_000_000 : 240_000, keyFrameInterval: 1, hardwareAcceleration: 'prefer-software' },
            audio: { codec: 'opus', numberOfChannels: 1, sampleRate: 48000, bitrate: 24_000 } })
          if (!conversion.isValid) throw new Error('This browser cannot prepare video detail.')
          await conversion.execute()
        }
        if (!target.buffer?.byteLength) throw new Error('The encoder produced no audio. Try another passage.')
        blob = new Blob([target.buffer], { type: job.kind === 'audio' ? 'audio/webm' : 'video/webm' })
      } catch (e) { await output.cancel().catch(() => undefined); throw e }
    }
    scope.postMessage({ id: data.id, blob, metrics: { decodeMs, encodeMs, totalMs: performance.now() - started } })
  } catch (error) { scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }) }
}
