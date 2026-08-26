import { env, pipeline } from '@huggingface/transformers'

const MODEL = 'onnx-community/whisper-tiny.en'
const MODEL_REVISION = '2575352d61be1bf7225cf8f8b268a4678025fc58'
const MODEL_CACHE_VERSION = 'v2'

type WorkerRequest =
  | { type: 'load' }
  | { type: 'transcribe'; id: string; audio: Float32Array }

type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>
) => Promise<{ text?: string; chunks?: Array<{ text?: string; timestamp?: [number | null, number | null] }> }>

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: unknown) => void
}

let transcriber: Transcriber | null = null
let loading: Promise<Transcriber> | null = null
let backend: 'webgpu' | 'wasm' = 'wasm'
const downloads = new Map<string, { loaded: number; total: number }>()

env.allowLocalModels = true
// Keep the browser cache URL versioned independently from the model revision.
// If a browser cached a partial/failed response, a release can move to a new
// namespace without forcing the server to download the model again.
env.localModelPath = `/whisper-models/${MODEL_CACHE_VERSION}/`
// Static deployments can still fall back to the Hub, while the SpeechEdit
// dev/preview server supplies a same-origin cached copy.
env.allowRemoteModels = true
env.useBrowserCache = true
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1

function send(message: unknown): void {
  scope.postMessage(message)
}

function progress(raw: unknown): void {
  const info = raw as {
  status: string
  file?: string
  name?: string
  loaded?: number
  total?: number
  progress?: number
  }
  if (info.status === 'progress' && info.file) {
    downloads.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 })
    const rows = [...downloads.values()]
    const total = rows.reduce((sum, row) => sum + row.total, 0)
    const loaded = rows.reduce((sum, row) => sum + Math.min(row.loaded, row.total || row.loaded), 0)
    send({
      type: 'model-progress',
      ratio: total > 0 ? loaded / total : Math.max(0, Math.min(1, (info.progress ?? 0) / 100)),
      detail: info.file.split('/').pop() ?? 'Whisper model'
    })
    return
  }
  if (info.status === 'initiate') send({ type: 'model-status', detail: 'Finding the local model cache' })
  if (info.status === 'download') send({ type: 'model-status', detail: 'Downloading private transcription model' })
}

async function build(device: 'webgpu' | 'wasm'): Promise<Transcriber> {
  const options = device === 'webgpu'
    ? {
        device,
        dtype: { encoder_model: 'fp32' as const, decoder_model_merged: 'q4' as const },
        revision: MODEL_REVISION,
        progress_callback: progress
      }
    : { device, dtype: 'q8' as const, revision: MODEL_REVISION, progress_callback: progress }
  return await pipeline('automatic-speech-recognition', MODEL, options) as unknown as Transcriber
}

async function load(): Promise<Transcriber> {
  if (transcriber) return transcriber
  if (loading) return loading
  loading = (async () => {
    const hasWebGpu = 'gpu' in navigator
    if (hasWebGpu) {
      try {
        send({ type: 'model-status', detail: 'Starting Whisper on the GPU' })
        backend = 'webgpu'
        transcriber = await build('webgpu')
      } catch {
        send({
          type: 'model-status',
          detail: 'GPU unavailable; starting the compatibility engine'
        })
      }
    }
    if (!transcriber) {
      backend = 'wasm'
      transcriber = await build('wasm')
    }
    send({ type: 'ready', backend })
    return transcriber
  })().finally(() => {
    loading = null
  })
  return loading
}

scope.onmessage = (event) => {
  const request = event.data
  if (request.type === 'load') {
    void load().catch((error) => {
      send({ type: 'error', id: null, error: error instanceof Error ? error.message : String(error) })
    })
    return
  }
  void (async () => {
    try {
      const run = await load()
      send({ type: 'transcription-status', id: request.id, detail: `Listening locally with ${backend === 'webgpu' ? 'WebGPU' : 'the compatibility engine'}` })
      const output = await run(request.audio, {
        // The compact WebGPU export does not include cross-attention tensors,
        // so native word timestamps are unavailable. Segment timestamps are
        // stable; SpeechEdit expands those phrases onto its Word timeline.
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        force_full_sequences: false,
        do_sample: false
      })
      const duration = request.audio.length / 16_000
      const cues = (output.chunks ?? []).flatMap((chunk) => {
        const text = chunk.text?.trim() ?? ''
        const start = chunk.timestamp?.[0]
        const end = chunk.timestamp?.[1]
        if (!text || typeof start !== 'number') return []
        return [{ text, start, end: typeof end === 'number' ? Math.max(start, end) : Math.min(duration, start + 0.5) }]
      })
      send({
        type: 'result',
        id: request.id,
        cues: cues.length
          ? cues
          : output.text?.trim()
            ? [{ text: output.text.trim(), start: 0, end: duration }]
            : []
      })
    } catch (error) {
      send({ type: 'error', id: request.id, error: error instanceof Error ? error.message : String(error) })
    }
  })()
}
