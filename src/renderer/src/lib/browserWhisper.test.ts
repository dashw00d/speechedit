import { expect, test } from 'bun:test'
import { browserWhisperState, preloadBrowserWhisper } from './browserWhisper'
import { finishActivity } from './activity'

test('GPU failure restarts on CPU, ignores the old worker, and permits retry after a crash', async () => {
  const original = globalThis.Worker
  const workers: FakeWorker[] = []
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void
    onerror?: (event: { message: string }) => void
    messages: unknown[] = []
    terminated = false
    constructor() { workers.push(this) }
    postMessage(message: unknown) { this.messages.push(message) }
    terminate() { this.terminated = true }
    send(data: unknown) { this.onmessage?.({ data }) }
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker
  try {
    const loading = preloadBrowserWhisper()
    expect(preloadBrowserWhisper()).toBe(loading)
    workers[0].send({ type: 'fallback', reason: 'GPU model initialization failed: adapter lost' })
    expect(workers[0].terminated).toBe(true)
    expect(workers[1].messages).toEqual([{
      type: 'load', backend: 'wasm', fallbackReason: 'GPU model initialization failed: adapter lost'
    }])
    workers[0].send({ type: 'error', id: null, error: 'stale GPU failure' })
    workers[1].send({ type: 'ready', backend: 'wasm', fallbackReason: 'adapter lost' })
    expect((await loading).backend).toBe('wasm')
    expect(browserWhisperState().fallbackReason).toBe('adapter lost')

    workers[1].onerror?.({ message: 'worker crashed' })
    expect(workers[1].terminated).toBe(true)
    const retry = preloadBrowserWhisper()
    expect(workers).toHaveLength(3)
    workers[2].send({ type: 'error', id: null, error: 'model download failed' })
    await expect(retry).rejects.toThrow('model download failed')
    expect(workers[2].terminated).toBe(true)
    expect(browserWhisperState().state).toBe('error')
  } finally {
    globalThis.Worker = original
    finishActivity('system:browser-whisper')
  }
})

test('automatic transcription survives GPU startup failure and inference crashes, and cancellation stops the retry', async () => {
  const { transcribeBrowserMedia, cancelBrowserWhisper } = await import('./browserWhisper')
  const savedWorker = globalThis.Worker
  const savedFetch = globalThis.fetch
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const workers: FakeWorker[] = []
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void
    onerror?: (event: { message: string }) => void
    messages: any[] = []
    terminated = false
    constructor() { workers.push(this) }
    postMessage(message: unknown) { this.messages.push(message) }
    terminate() { this.terminated = true }
    send(data: unknown) { this.onmessage?.({ data }) }
  }
  class AudioContext {
    async decodeAudioData() { return { length: 3, numberOfChannels: 1, getChannelData: () => new Float32Array([0.1, 0.2, 0.3]) } }
    async close() {}
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker
  globalThis.fetch = (async () => new Response(new Uint8Array(4))) as typeof fetch
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { AudioContext } })
  const tick = async (predicate: () => boolean) => {
    for (let i = 0; i < 30 && !predicate(); i++) await Bun.sleep(1)
    expect(predicate()).toBe(true)
  }
  try {
    for (const mode of ['startup', 'inference', 'crash', 'cancel', 'cpu-error']) {
      const start = workers.length
      const done = transcribeBrowserMedia('blob:test')
      const gpu = workers[start]
      if (mode === 'startup') gpu.send({ type: 'fallback', reason: 'GPU initialization failed' })
      else {
        gpu.send({ type: 'ready', backend: 'webgpu' })
        await tick(() => gpu.messages.some(message => message.type === 'transcribe'))
        const request = gpu.messages.find(message => message.type === 'transcribe')
        if (mode === 'crash') gpu.onerror?.({ message: 'GPU process crashed' })
        else gpu.send({ type: 'error', id: request.id, error: 'GPU device lost' })
      }
      const cpu = workers[start + 1]
      expect(gpu.terminated).toBe(true)
      expect(cpu.messages[0].backend).toBe('wasm')
      if (mode === 'cancel') {
        cancelBrowserWhisper()
        await expect(done).rejects.toThrow()
        cpu.send({ type: 'ready', backend: 'wasm' })
        expect(cpu.messages.some(message => message.type === 'transcribe')).toBe(false)
        continue
      }
      cpu.send({ type: 'ready', backend: 'wasm', fallbackReason: 'GPU failed' })
      await tick(() => cpu.messages.some(message => message.type === 'transcribe'))
      const replay = cpu.messages.find(message => message.type === 'transcribe')
      expect(replay.audio.length).toBe(3)
      expect(replay.audio[1]).toBeCloseTo(0.2)
      if (mode === 'cpu-error') {
        cpu.send({ type: 'error', id: replay.id, error: 'CPU failed too' })
        await expect(done).rejects.toThrow('CPU failed too')
        expect(workers.length).toBe(start + 2)
      } else {
        const cues = [{ text: 'Words after fallback', start: 0, end: 1 }]
        cpu.send({ type: 'result', id: replay.id, cues })
        expect(await done).toEqual(cues)
        cpu.onerror?.({ message: 'end test session' })
      }
    }
  } finally {
    globalThis.Worker = savedWorker
    globalThis.fetch = savedFetch
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    finishActivity('system:browser-whisper')
  }
})
