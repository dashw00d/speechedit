import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BROWSER_WHISPER_MODEL,
  BROWSER_WHISPER_MODEL_REVISION,
  WHISPER_MODEL_CACHE_VERSION,
  WHISPER_MODEL_CACHE_VERSIONS,
  whisperModelRevision
} from '../../../shared/whisperModels'

const root = resolve(import.meta.dir, '../../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const revisionPattern = /['"`][0-9a-f]{40}['"`]/

describe('browser Whisper model revisions', () => {
  test('the model the worker loads has a pinned revision', () => {
    const [owner, model] = BROWSER_WHISPER_MODEL.split('/')
    expect(whisperModelRevision(owner, model)).toBe(BROWSER_WHISPER_MODEL_REVISION)
    expect(BROWSER_WHISPER_MODEL_REVISION).toMatch(/^[0-9a-f]{40}$/)
  })

  test('servers accept the cache namespace the worker requests', () => {
    expect(WHISPER_MODEL_CACHE_VERSIONS).toContain(WHISPER_MODEL_CACHE_VERSION)
    for (const path of ['vite.web.config.ts', 'scripts/web-server.ts']) {
      expect(read(path)).not.toMatch(/['"]v\d+['"]/)
    }
  })

  test('worker, vite dev/preview proxy, and web server share one revision table', () => {
    const worker = read('src/renderer/src/workers/browserWhisper.worker.ts')
    const vite = read('vite.web.config.ts')
    const server = read('scripts/web-server.ts')
    for (const source of [worker, vite, server]) {
      expect(source).not.toMatch(revisionPattern)
      expect(source).toContain('shared/whisperModels')
    }
    // The dev proxy must resolve the revision per model, not use one global pin.
    expect(vite).toContain('whisperModelRevision(')
  })
})
