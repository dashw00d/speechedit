import * as B from 'mediabunny'
import { EDGE_BIN, quietIntervals } from '../lib/quietEdges'
import type { Interval } from '../types'

const scope = globalThis as unknown as { onmessage: (event: MessageEvent) => void; postMessage: (value: unknown) => void }
scope.onmessage = async ({ data }: MessageEvent<{ source: Blob | string; range: Interval }>) => {
  const { source, range } = data
  const input = new B.Input({ source: typeof source === 'string' ? new B.UrlSource(source) : new B.BlobSource(source), formats: B.ALL_FORMATS })
  try {
    if (range.end <= range.start || range.end - range.start > 1) throw new Error('Invalid edge window.')
    const track = await input.getPrimaryAudioTrack()
    if (!track || !await track.canDecode()) throw new Error('Audio cannot be checked in this browser.')
    const count = Math.ceil((range.end - range.start) / EDGE_BIN)
    const energy = new Float64Array(count), coverage = new Float64Array(count)
    for await (const sample of new B.AudioSampleSink(track).samples(range.start, range.end)) {
      try {
        const pcm = new Float32Array(sample.numberOfFrames * sample.numberOfChannels)
        sample.copyTo(pcm, { format: 'f32', planeIndex: 0 })
        for (let frame = 0; frame < sample.numberOfFrames; frame++) {
          const at = sample.timestamp + frame / sample.sampleRate
          if (at < range.start || at >= range.end) continue
          const bin = Math.floor((at - range.start) / EDGE_BIN)
          let square = 0
          for (let c = 0; c < sample.numberOfChannels; c++) square = Math.max(square, pcm[frame * sample.numberOfChannels + c] ** 2)
          energy[bin] += square / sample.sampleRate
          coverage[bin] += 1 / sample.sampleRate
        }
      } finally { sample.close() }
    }
    const levels = Array.from(energy, (sum, i) => coverage[i] >= EDGE_BIN * 0.95 ? Math.sqrt(sum / coverage[i]) : NaN)
    scope.postMessage({ silence: quietIntervals(levels, range.start) })
  } catch { scope.postMessage({ error: 'Could not check the audio edges.' }) }
  finally { input.dispose() }
}
