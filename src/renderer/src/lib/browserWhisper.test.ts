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
