import { useSyncExternalStore } from 'react'
import type { AsrCue, TranscribeProgress } from '../../../shared/asr'
import { JobCancelled } from '../../../shared/mediaJob'
import { failActivity, finishActivity, startActivity, updateActivity } from './activity'
import { uid } from './time'

export type BrowserWhisperState = {
  state: 'idle' | 'loading' | 'ready' | 'transcribing' | 'error'
  ratio?: number
  detail: string
  backend?: 'webgpu' | 'wasm'
  fallbackReason?: string
}

type WorkerMessage =
  | { type: 'model-progress'; ratio: number; detail: string }
  | { type: 'model-status'; detail: string }
  | { type: 'ready'; backend: 'webgpu' | 'wasm'; fallbackReason?: string }
  | { type: 'fallback'; reason: string }
  | { type: 'transcription-status'; id: string; detail: string }
  | { type: 'result'; id: string; cues: AsrCue[] }
  | { type: 'error'; id: string | null; error: string }

let snapshot: BrowserWhisperState = {
  state: 'idle',
  detail: 'Waiting to start'
}
let worker: Worker | null = null
let loadPromise: Promise<BrowserWhisperState> | null = null
let resolveLoad: ((state: BrowserWhisperState) => void) | null = null
let rejectLoad: ((error: Error) => void) | null = null
const listeners = new Set<() => void>()
const requests = new Map<string, { resolve: (cues: AsrCue[]) => void; reject: (error: Error) => void }>()
let cancellationVersion = 0

function publish(next: BrowserWhisperState): void {
  snapshot = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function browserWhisperState(): BrowserWhisperState {
  return snapshot
}

export function useBrowserWhisperState(): BrowserWhisperState {
  return useSyncExternalStore(subscribe, browserWhisperState, browserWhisperState)
}

function createWorker(): Worker {
  if (worker) return worker
  const next = new Worker(new URL('../workers/browserWhisper.worker.ts', import.meta.url), { type: 'module' })
  next.onmessage = (event: MessageEvent<WorkerMessage>) => {
    if (worker !== next) return
    const message = event.data
    if (message.type === 'fallback') {
      console.warn('[SpeechEdit Whisper]', message.reason)
      next.terminate()
      worker = null
      publish({ state: 'loading', detail: 'Starting the compatibility engine', fallbackReason: message.reason })
      createWorker().postMessage({ type: 'load', backend: 'wasm', fallbackReason: message.reason })
      return
    }
    if (message.type === 'model-progress') {
      publish({ ...snapshot, state: 'loading', ratio: message.ratio, detail: message.detail })
      updateActivity('system:browser-whisper', { ratio: message.ratio, detail: message.detail })
      return
    }
    if (message.type === 'model-status') {
      publish({ ...snapshot, state: 'loading', detail: message.detail })
      updateActivity('system:browser-whisper', { detail: message.detail })
      return
    }
    if (message.type === 'ready') {
      const ready: BrowserWhisperState = {
        state: 'ready',
        detail: message.backend === 'webgpu' ? 'Ready on this device · WebGPU' : 'Ready on this device · compatibility mode',
        backend: message.backend,
        fallbackReason: message.fallbackReason
      }
      publish(ready)
      finishActivity('system:browser-whisper')
      resolveLoad?.(ready)
      resolveLoad = null
      rejectLoad = null
      return
    }
    if (message.type === 'transcription-status') {
      publish({ ...snapshot, state: 'transcribing', detail: message.detail })
      return
    }
    if (message.type === 'result') {
      const request = requests.get(message.id)
      requests.delete(message.id)
      publish({ ...snapshot, state: 'ready', detail: snapshot.backend === 'webgpu' ? 'Ready on this device · WebGPU' : 'Ready on this device · compatibility mode' })
      request?.resolve(message.cues)
      return
    }
    const error = new Error(message.error || 'Browser Whisper failed.')
    if (message.id) {
      const request = requests.get(message.id)
      requests.delete(message.id)
      request?.reject(error)
      publish({ ...snapshot, state: 'ready', detail: 'Ready for another recording' })
      return
    }
    publish({ state: 'error', detail: error.message })
    failActivity('system:browser-whisper', error.message)
    next.terminate()
    worker = null
    rejectLoad?.(error)
    resolveLoad = null
    rejectLoad = null
  }
  next.onerror = (event) => {
    if (worker !== next) return
    const error = new Error(event.message || 'Browser Whisper worker stopped.')
    publish({ state: 'error', detail: error.message })
    failActivity('system:browser-whisper', error.message)
    rejectLoad?.(error)
    for (const request of requests.values()) request.reject(error)
    requests.clear()
    resolveLoad = null
    rejectLoad = null
    next.terminate()
    worker = null
  }
  worker = next
  return next
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    worker?.terminate()
    worker = null
  })
}

export function preloadBrowserWhisper(): Promise<BrowserWhisperState> {
  if (snapshot.state === 'ready' || snapshot.state === 'transcribing') return Promise.resolve(snapshot)
  if (loadPromise) return loadPromise
  publish({ state: 'loading', detail: 'Starting private transcription' })
  startActivity({
    id: 'system:browser-whisper',
    label: 'Preparing local Whisper',
    detail: 'Starting private transcription'
  })
  loadPromise = new Promise<BrowserWhisperState>((resolve, reject) => {
    resolveLoad = resolve
    rejectLoad = reject
    createWorker().postMessage({ type: 'load' })
  }).finally(() => {
    loadPromise = null
  })
  return loadPromise
}

async function decodeBrowserAudio(filePath: string): Promise<Float32Array> {
  const AudioContextClass = window.AudioContext
  if (!AudioContextClass) throw new Error('This browser cannot decode audio for local transcription.')
  const context = new AudioContextClass({ sampleRate: 16_000 })
  try {
    const bytes = await fetch(filePath).then((response) => {
      if (!response.ok) throw new Error('The selected recording is no longer available.')
      return response.arrayBuffer()
    })
    const decoded = await context.decodeAudioData(bytes)
    const mono = new Float32Array(decoded.length)
    const channels = Math.max(1, decoded.numberOfChannels)
    for (let channelIndex = 0; channelIndex < channels; channelIndex++) {
      const channel = decoded.getChannelData(channelIndex)
      for (let index = 0; index < channel.length; index++) mono[index] += channel[index] / channels
    }
    return mono
  } finally {
    void context.close()
  }
}

export async function transcribeBrowserMedia(
  filePath: string,
  onProgress?: (progress: TranscribeProgress) => void
): Promise<AsrCue[]> {
  const version = cancellationVersion
  onProgress?.({ stage: 'prepare', ratio: 0.02 })
  const audioPromise = decodeBrowserAudio(filePath).then((audio) => {
    onProgress?.({ stage: 'audio', ratio: 0.18 })
    return audio
  })
  const readyPromise = preloadBrowserWhisper()
  const [audio] = await Promise.all([audioPromise, readyPromise])
  if (version !== cancellationVersion) throw new JobCancelled('import')
  const id = uid('browser-asr')
  onProgress?.({ stage: 'run', ratio: 0.3 })
  publish({ ...snapshot, state: 'transcribing', detail: 'Listening locally · your media stays on this device' })
  const cues = await new Promise<AsrCue[]>((resolve, reject) => {
    requests.set(id, { resolve, reject })
    createWorker().postMessage({ type: 'transcribe', id, audio }, [audio.buffer])
  })
  if (version !== cancellationVersion) throw new JobCancelled('import')
  onProgress?.({ stage: 'parse', ratio: 0.96, cues })
  onProgress?.({ stage: 'done', ratio: 1, cues })
  return cues
}

export function cancelBrowserWhisper(): void {
  cancellationVersion += 1
  if (!worker) return
  const error = new JobCancelled('import')
  rejectLoad?.(error)
  for (const request of requests.values()) request.reject(error)
  requests.clear()
  worker.terminate()
  worker = null
  loadPromise = null
  resolveLoad = null
  rejectLoad = null
  publish({ state: 'idle', detail: 'Restarting local transcription' })
  window.setTimeout(() => void preloadBrowserWhisper().catch(() => undefined), 250)
}
