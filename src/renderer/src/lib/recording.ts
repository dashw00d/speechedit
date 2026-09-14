export interface CapturedAudio { blob: Blob; duration: number; recordedDuration: number; sampleRate: number }
export interface CaptureProgress { countdown: number; elapsed: number; level: number }

export function pcmWave(samples: Float32Array, sampleRate: number): Blob {
  const data = new ArrayBuffer(44 + samples.length * 2), view = new DataView(data)
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767)), true))
  return new Blob([data], { type: 'audio/wav' })
}

// The audio thread records a fixed number of sample frames after the countdown.
// UI timers never determine where capture starts or ends; the output is silent.
export const captureProcessor = `
class SlotRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.start = options.processorOptions.startFrame;
    this.samples = new Float32Array(options.processorOptions.frames); this.written = 0; this.done = false;
    this.port.onmessage = event => { if (event.data === 'finish') this.finish(); };
  }
  finish() {
    if (this.done) return; this.done = true;
    this.port.postMessage({ samples: this.samples, written: this.written }, [this.samples.buffer]);
  }
  process(inputs, outputs) {
    if (this.done) return false;
    const channels = inputs[0] || [], frames = outputs[0][0].length;
    let peak = 0;
    for (let i = 0; i < frames; i++) {
      const position = currentFrame + i - this.start;
      if (position < 0) continue;
      if (position >= this.samples.length) { this.finish(); return false; }
      let sample = 0; for (const channel of channels) sample += channel[i] || 0;
      sample /= Math.max(1, channels.length);
      this.samples[position] = sample; this.written = position + 1; peak = Math.max(peak, Math.abs(sample));
    }
    if (currentFrame % 2048 < frames) this.port.postMessage({ countdown: Math.max(0, Math.ceil((this.start - currentFrame) / sampleRate)), elapsed: this.written / sampleRate, level: peak });
    return true;
  }
}
registerProcessor('slot-recorder', SlotRecorder);
`

export async function captureAudio(duration: number, signal: AbortSignal, progress: (value: CaptureProgress) => void): Promise<{ result: Promise<CapturedAudio>; finish: () => void }> {
  if (!Number.isFinite(duration) || duration < 0.1 || duration > 120) throw new Error('Choose a passage between 0.1 and 120 seconds to re-record.')
  if (signal.aborted) throw new DOMException('Recording cancelled.', 'AbortError')
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is unavailable in this window. Open SpeechEdit using HTTPS or the desktop app, then retry. Nothing was recorded.')
  const context = new AudioContext({ sampleRate: 48000 })
  let stream: MediaStream | undefined, node: AudioWorkletNode | undefined
  const cleanup = () => { stream?.getTracks().forEach(track => track.stop()); node?.disconnect(); void context.close().catch(() => undefined) }
  signal.addEventListener('abort', cleanup, { once: true })
  try {
    await context.resume()
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false })
    if (signal.aborted) throw new DOMException('Recording cancelled.', 'AbortError')
    const url = URL.createObjectURL(new Blob([captureProcessor], { type: 'text/javascript' }))
    try { await context.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
    if (signal.aborted) throw new DOMException('Recording cancelled.', 'AbortError')
    const frames = Math.round(duration * context.sampleRate), startFrame = Math.ceil((context.currentTime + 3) * context.sampleRate)
    node = new AudioWorkletNode(context, 'slot-recorder', { processorOptions: { startFrame, frames }, numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    const source = context.createMediaStreamSource(stream)
    const result = new Promise<CapturedAudio>((resolve, reject) => {
      const abort = () => { cleanup(); reject(new DOMException('Recording cancelled.', 'AbortError')) }
      signal.addEventListener('abort', abort, { once: true })
      node!.onprocessorerror = () => { signal.removeEventListener('abort', abort); cleanup(); reject(new Error('Microphone recording stopped unexpectedly. Please retry.')) }
      node!.port.onmessage = ({ data }) => {
        if (!data.samples) { progress(data); return }
        signal.removeEventListener('abort', abort)
        const sampleRate = context.sampleRate
        cleanup(); resolve({ blob: pcmWave(data.samples, sampleRate), duration: frames / sampleRate, recordedDuration: data.written / sampleRate, sampleRate })
      }
    })
    signal.removeEventListener('abort', cleanup)
    source.connect(node); node.connect(context.destination)
    return { result, finish: () => node?.port.postMessage('finish') }
  } catch (e) {
    signal.removeEventListener('abort', cleanup); cleanup()
    const name = e instanceof Error ? e.name : ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      throw new Error('Your microphone is blocked. Allow microphone access in your browser or system settings, then retry. Nothing was recorded.')
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      throw new Error('No microphone was found. Connect a microphone, then retry. Nothing was recorded.')
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      throw new Error('Your microphone could not start. Check that it works and is not in use by another app, then retry. Nothing was recorded.')
    }
    throw e
  }
}
