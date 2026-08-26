import { describe, expect, test } from 'bun:test'
import { host, isElectron } from '../host'
import { createDemoProject } from './demo'

describe('web host fallbacks', () => {
  test('bun tests are not Electron, so File save/open use the browser stubs', () => {
    expect(isElectron).toBe(false)
  })

  test('open pickers no-op without a document instead of hanging', async () => {
    expect(await host.openTranscript()).toBeNull()
    expect(await host.openProject()).toBeNull()
    expect(await host.openInterchange()).toBeNull()
    expect(await host.openMedia()).toBeNull()
  })

  test('saveProject downloads in a window and refuses headless', async () => {
    await expect(host.saveProject(createDemoProject())).rejects.toThrow(/browser window/)
  })

  test('web appIdentity reports a version and the web channel', async () => {
    const identity = await host.appIdentity()
    expect(identity.name).toBe('SpeechEdit')
    expect(identity.version).toMatch(/^\d+\.\d+/)
    expect(identity.channel).toBe('web')
  })

  test('web mediaHealth is fail-closed with one recovery sentence', async () => {
    const health = await host.mediaHealth()
    expect(health.ok).toBe(false)
    expect(health.message).toMatch(/desktop app/)
  })

  test('mediaExists treats live web media as present and stale blob or disk paths as missing', async () => {
    const rows = await host.mediaExists(['https://example.com/a.png', 'blob:http://localhost/stale', '/tmp/se-src.mp4'])
    expect(rows).toEqual([
      { path: 'https://example.com/a.png', exists: true },
      { path: 'blob:http://localhost/stale', exists: false },
      { path: '/tmp/se-src.mp4', exists: false }
    ])
  })

  test('web Assistant ignores browser endpoint overrides and uses locked Demo AI', async () => {
    const previous = globalThis.fetch
    const requests: { url: string; body?: Record<string, unknown>; authorization?: string | null }[] = []
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const headers = new Headers(init?.headers)
      requests.push({
        url,
        ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as Record<string, unknown> } : {}),
        authorization: headers.get('Authorization')
      })
      if (url.endsWith('/status')) {
        return Response.json({ available: true, model: 'openrouter/free' })
      }
      return Response.json({ choices: [{ message: { content: '{"status":"ok"}' } }] })
    }) as typeof fetch
    try {
      const listed = await host.listModels({
        kind: 'openai-compatible',
        baseUrl: 'https://attacker.invalid/v1',
        model: 'paid/model',
        apiKey: 'browser-secret'
      })
      expect(listed.models.map((model) => model.id)).toEqual(['openrouter/free'])
      expect(await host.complete({
        endpoint: {
          kind: 'openai-compatible',
          baseUrl: 'https://attacker.invalid/v1',
          model: 'paid/model',
          apiKey: 'browser-secret'
        },
        messages: [{ role: 'user', content: 'hello' }]
      })).toBe('{"status":"ok"}')
      expect(requests.at(-1)).toMatchObject({
        url: '/api/demo-ai/chat/completions',
        body: { model: 'openrouter/free' },
        authorization: null
      })
    } finally {
      globalThis.fetch = previous
    }
  })
})
