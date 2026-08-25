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

  test('mediaExists treats http stills as present and disk paths as missing on the web', async () => {
    const rows = await host.mediaExists(['https://example.com/a.png', '/tmp/se-src.mp4'])
    expect(rows).toEqual([
      { path: 'https://example.com/a.png', exists: true },
      { path: '/tmp/se-src.mp4', exists: false }
    ])
  })
})
