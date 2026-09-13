import { env, pipeline } from '@huggingface/transformers'
import wasmUrl from '../../../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm?url'
import runtimeUrl from '../../../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs?url'
import { browserGpuUnavailableReason } from '../lib/browserGpu'

const MODEL = 'onnx-community/whisper-tiny.en_timestamped'
const MODEL_REVISION = 'aeaa13760958b03fac5062f457d317d3319c3168'
const MODEL_CACHE_VERSION = 'v3'

type WorkerRequest =
  | { type: 'load'; backend?: 'wasm'; fallbackReason?: string }
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
let fallbackReason: string | undefined
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
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1
  // Transformers defaults to a CDN even when Vite emits the WASM asset.
  // Ship the matching JS/WASM pair with the application for both backends.
  env.backends.onnx.wasm.wasmPaths = {
    wasm: new URL(wasmUrl, self.location.href).href,
    mjs: new URL(runtimeUrl, self.location.href).href
  }
}

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

async function load(forceWasm = false): Promise<Transcriber> {
  if (transcriber) return transcriber
  if (loading) return loading
  loading = (async () => {
    if (!forceWasm) {
      const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown | null> } }).gpu
      fallbackReason = await browserGpuUnavailableReason(isSecureContext, gpu)
    }
    if (!forceWasm && !fallbackReason) {
      try {
        send({ type: 'model-status', detail: 'Starting Whisper on the GPU' })
        backend = 'webgpu'
        transcriber = await build('webgpu')
      } catch (error) {
        fallbackReason = `GPU model initialization failed: ${error instanceof Error ? error.message : String(error)}`
        // ONNX initialization can stay rejected after a GPU failure. The host
        // must start WASM in a fresh worker, with a fresh runtime instance.
        send({ type: 'fallback', reason: fallbackReason })
        throw new Error(fallbackReason)
      }
    }
    if (!transcriber) {
      backend = 'wasm'
      transcriber = await build('wasm')
    }
    send({ type: 'ready', backend, fallbackReason })
    return transcriber
  })().finally(() => {
    loading = null
  })
  return loading
}

scope.onmessage = (event) => {
  const request = event.data
  if (request.type === 'load') {
    fallbackReason = request.fallbackReason
    void load(request.backend === 'wasm').catch((error) => {
      if (backend === 'webgpu' && fallbackReason) return
      send({ type: 'error', id: null, error: error instanceof Error ? error.message : String(error) })
    })
    return
  }
  void (async () => {
    try {
      const run = await load()
      send({ type: 'transcription-status', id: request.id, detail: `Listening locally with ${backend === 'webgpu' ? 'WebGPU' : 'the compatibility engine'}` })
      const output = await run(request.audio, {
        // This export includes the cross-attention tensors needed to align
        // individual words with speech, including on the CPU fallback.
        return_timestamps: 'word',
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
        if (!text || typeof start !== 'number' || !Number.isFinite(start) || start >= duration) return []
        const boundedStart = Math.max(0, start)
        const boundedEnd = typeof end === 'number' && Number.isFinite(end) ? end : start + 0.5
        return [{ text, start: boundedStart, end: Math.min(duration, Math.max(boundedStart, boundedEnd)) }]
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
