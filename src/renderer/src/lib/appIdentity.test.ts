import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveAppIdentity } from '../../../main/appIdentity'
import { formatAppIdentity, formatAppIdentityDiagnostic } from '../../../shared/appIdentity'
import { host } from '../host'
import { loadAppIdentity, resetAppIdentityCache } from './appIdentity'

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }

describe('app identity', () => {
  beforeEach(() => {
    resetAppIdentityCache()
  })
  afterEach(() => {
    resetAppIdentityCache()
  })

  test('formats a packaged build without calling it dev', () => {
    expect(
      formatAppIdentity({
        name: 'SpeechEdit',
        version: '0.1.0',
        commit: 'a1b2c3d',
        dirty: false,
        channel: 'packaged',
        electron: '37.3.0',
        platform: 'win32',
        arch: 'x64'
      })
    ).toBe('SpeechEdit 0.1.0 · a1b2c3d')
  })

  test('marks a dirty development checkout', () => {
    expect(
      formatAppIdentity({
        name: 'SpeechEdit',
        version: '0.1.0',
        commit: 'a1b2c3d',
        dirty: true,
        channel: 'dev',
        electron: '37.3.0',
        platform: 'linux',
        arch: 'x64'
      })
    ).toBe('SpeechEdit 0.1.0 · a1b2c3d+ · dev')
  })

  test('diagnostic block is pasteable into a run record', () => {
    expect(
      formatAppIdentityDiagnostic({
        name: 'SpeechEdit',
        version: '0.1.0',
        commit: 'a1b2c3d',
        dirty: true,
        channel: 'dev',
        electron: '37.3.0',
        platform: 'linux',
        arch: 'x64'
      })
    ).toBe('SpeechEdit 0.1.0\ncommit a1b2c3d dirty\nlinux · x64 · Electron 37.3.0 · dev')
  })

  test('unpackaged identity prefers live git over the baked commit', async () => {
    const identity = await resolveAppIdentity({
      version: '0.1.0',
      packaged: false,
      electron: '37.3.0',
      platform: 'linux',
      arch: 'x64',
      bakedCommit: 'deadbeef',
      git: async () => ({ commit: 'abc1234', dirty: true })
    })
    expect(identity).toMatchObject({
      version: '0.1.0',
      commit: 'abc1234',
      dirty: true,
      channel: 'dev'
    })
    expect(formatAppIdentity(identity)).toBe('SpeechEdit 0.1.0 · abc1234+ · dev')
  })

  test('packaged identity keeps the baked commit and ignores git', async () => {
    const identity = await resolveAppIdentity({
      version: '0.1.0',
      packaged: true,
      electron: '37.3.0',
      platform: 'win32',
      arch: 'x64',
      bakedCommit: 'c0ffee1',
      git: async () => ({ commit: 'should-not-use', dirty: true })
    })
    expect(identity).toMatchObject({
      commit: 'c0ffee1',
      dirty: false,
      channel: 'packaged'
    })
  })

  test('this checkout can report a live git commit', async () => {
    const identity = await resolveAppIdentity({
      version: pkg.version,
      packaged: false,
      electron: '',
      platform: process.platform,
      arch: process.arch
    })
    expect(identity.commit).toMatch(/^[0-9a-f]{7,}$/i)
    expect(identity.channel).toBe('dev')
  })

  test('web host reports the package version so tests and the browser stay aligned', async () => {
    const identity = await host.appIdentity()
    expect(identity.version).toBe(pkg.version)
    expect(identity.channel).toBe('web')
    expect(formatAppIdentity(identity)).toBe(`SpeechEdit ${pkg.version} · web`)
  })

  test('loadAppIdentity caches until forced', async () => {
    const prev = host.appIdentity
    let calls = 0
    host.appIdentity = async () => {
      calls += 1
      return {
        name: 'SpeechEdit',
        version: '9.9.9',
        commit: 'abc',
        dirty: false,
        channel: 'dev',
        electron: '1',
        platform: 'linux',
        arch: 'x64'
      }
    }
    try {
      expect((await loadAppIdentity()).version).toBe('9.9.9')
      expect((await loadAppIdentity()).version).toBe('9.9.9')
      expect(calls).toBe(1)
    } finally {
      host.appIdentity = prev
    }
  })
})
