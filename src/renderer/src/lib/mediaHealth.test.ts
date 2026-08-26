import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { host } from '../host'
import { importMediaAction } from './fileActions'
import { loadMediaHealth, mediaToolsBlocker, resetMediaHealthCache } from './mediaHealth'
import type { MediaToolsHealth } from '../../../shared/mediaTools'

const unhealthy: MediaToolsHealth = {
  ffmpeg: { name: 'ffmpeg', path: 'ffmpeg', version: null, ok: false },
  ffprobe: { name: 'ffprobe', path: 'ffprobe', version: null, ok: false },
  ok: false,
  message: 'FFmpeg did not start. Install ffmpeg 4.4+ (and ffprobe) and keep them on PATH.'
}

const healthy: MediaToolsHealth = {
  ffmpeg: { name: 'ffmpeg', path: '/usr/bin/ffmpeg', version: '4.4.2', ok: true },
  ffprobe: { name: 'ffprobe', path: '/usr/bin/ffprobe', version: '4.4.2', ok: true },
  ok: true,
  message: null
}

describe('media health cache', () => {
  beforeEach(() => {
    resetMediaHealthCache()
  })
  afterEach(() => {
    resetMediaHealthCache()
  })

  test('web host is fail-closed until the desktop app probes real binaries', async () => {
    const blocked = await mediaToolsBlocker()
    expect(blocked).toMatch(/desktop app/)
  })

  test('web import reaches the browser picker without requiring ffmpeg', async () => {
    const toasts: string[] = []
    await importMediaAction((msg) => toasts.push(msg))
    expect(toasts).toEqual(['No file selected.'])
  })

  test('blocker returns the recovery sentence when either tool is down', async () => {
    const prev = host.mediaHealth
    let calls = 0
    host.mediaHealth = async () => {
      calls += 1
      return unhealthy
    }
    try {
      expect(await mediaToolsBlocker()).toMatch(/Install ffmpeg 4\.4/)
      expect(await mediaToolsBlocker()).toMatch(/Install ffmpeg 4\.4/)
      expect(calls).toBe(1)
    } finally {
      host.mediaHealth = prev
    }
  })

  test('force refresh re-probes and clears the blocker when tools recover', async () => {
    const prev = host.mediaHealth
    let calls = 0
    host.mediaHealth = async () => {
      calls += 1
      return calls === 1 ? unhealthy : healthy
    }
    try {
      expect(await mediaToolsBlocker()).toMatch(/Install ffmpeg/)
      expect(await loadMediaHealth(true)).toEqual(healthy)
      expect(await mediaToolsBlocker()).toBeNull()
      expect(calls).toBe(2)
    } finally {
      host.mediaHealth = prev
    }
  })
})
