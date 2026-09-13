import { afterEach, describe, expect, test } from 'bun:test'
import { host } from '../host'
import { useEditor } from '../store'
import { createDemoProject } from './demo'
import { exportVideoAction, proxyOnlyAssets, relinkProxyOriginals } from './exportActions'
import type { ToastEntry } from './toastActions'
import type { Asset } from '../types'

function stubHost(partial: Partial<typeof host>): () => void {
  const keys = Object.keys(partial) as (keyof typeof host)[]
  const prev = Object.fromEntries(keys.map((key) => [key, host[key]])) as Partial<typeof host>
  Object.assign(host, partial)
  return () => Object.assign(host, prev)
}

/** A shared editing project whose A-roll only has a preview until the original is relinked. */
function previewOnlyProject(count = 1) {
  const base = createDemoProject()
  const source = base.assets.demo_src
  const assets: Record<string, Asset> = {}
  for (let i = 0; i < count; i += 1) {
    const id = i === 0 ? source.id : `${source.id}-${i}`
    assets[id] = {
      ...source,
      id,
      path: `http://localhost/api/reviews/room-1/media/${id}`,
      proxyOnly: true
    }
  }
  return { ...base, assets }
}

function relinkStub(): () => void {
  return stubHost({
    openMedia: async () => '/tmp/spe09-local-recording.wav',
    mediaExists: async (paths) => paths.map((path) => ({ path, exists: true })),
    waveform: async () => [],
    thumbnails: async () => []
  })
}

describe('shared preview-only final render recovery', () => {
  let restore = () => undefined as void
  afterEach(() => restore())

  test('a blocked final render offers one plain-language relink action', async () => {
    useEditor.getState().loadProject(previewOnlyProject(1), { clean: true, persist: false })
    const messages: (string | ToastEntry)[] = []
    await exportVideoAction((message) => messages.push(message))
    expect(messages).toHaveLength(1)
    const entry = messages[0] as ToastEntry
    expect(typeof entry).toBe('object')
    expect(entry.message).toBe('Relink the original recording to render the final video.')
    expect(entry.message.toLowerCase()).not.toContain('proxy')
    expect(entry.action?.label).toBe('Relink original media')
  })

  test('relinking the original clears the block and resumes export on the same path', async () => {
    restore = relinkStub()
    useEditor.getState().loadProject(previewOnlyProject(1), { clean: true, persist: false })
    const messages: (string | ToastEntry)[] = []
    let retried = 0
    await relinkProxyOriginals((message) => messages.push(message), () => { retried += 1 })
    expect(proxyOnlyAssets(useEditor.getState().project)).toHaveLength(0)
    expect(retried).toBe(1)
  })

  test('more than one original names the remaining count and keeps the action', async () => {
    useEditor.getState().loadProject(previewOnlyProject(2), { clean: true, persist: false })
    const blocked: (string | ToastEntry)[] = []
    await exportVideoAction((message) => blocked.push(message))
    const entry = blocked[0] as ToastEntry
    expect(entry.message).toBe('Relink 2 original recordings to render the final video.')
    expect(entry.action?.label).toBe('Relink original media')

    restore = relinkStub()
    const progress: (string | ToastEntry)[] = []
    let retried = 0
    await relinkProxyOriginals((message) => progress.push(message), () => { retried += 1 })
    expect(retried).toBe(0)
    expect(proxyOnlyAssets(useEditor.getState().project)).toHaveLength(1)
    const next = progress[0] as ToastEntry
    expect(next.message).toContain('One original recording left')
    expect(next.action?.label).toBe('Relink original media')
  })

  test('cancelling the picker keeps a no-dead-end message with the action', async () => {
    restore = stubHost({ openMedia: async () => null })
    useEditor.getState().loadProject(previewOnlyProject(1), { clean: true, persist: false })
    const messages: (string | ToastEntry)[] = []
    await relinkProxyOriginals((message) => messages.push(message), () => {})
    const entry = messages[0] as ToastEntry
    expect(entry.message).toContain('Still needs the original recording')
    expect(entry.action?.label).toBe('Relink original media')
  })
})
