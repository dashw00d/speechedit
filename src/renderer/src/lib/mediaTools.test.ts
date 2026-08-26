import { describe, expect, test } from 'bun:test'
import {
  checkMediaTools,
  mediaToolMissingMessage,
  mediaToolPath,
  parseMediaToolVersion
} from '../../../main/mediaTools'
import { mediaToolsHealthMessage, mediaToolsHealthSummary } from '../../../shared/mediaTools'

describe('packaged media tools', () => {
  test('uses the Windows binary copied into Electron resources', () => {
    expect(
      mediaToolPath('ffmpeg', {
        platform: 'win32',
        resourcesPath: 'C:\\SpeechEdit\\resources',
        env: {},
        exists: (path) => path.endsWith('bin\\ffmpeg.exe')
      })
    ).toBe('C:\\SpeechEdit\\resources\\bin\\ffmpeg.exe')
  })

  test('uses an explicit operator override first', () => {
    expect(
      mediaToolPath('ffprobe', {
        platform: 'win32',
        resourcesPath: 'C:\\SpeechEdit\\resources',
        env: { SPEECHEDIT_FFPROBE: 'D:\\tools\\ffprobe.exe' },
        exists: () => true
      })
    ).toBe('D:\\tools\\ffprobe.exe')
  })

  test('keeps PATH lookup in an unpackaged development environment', () => {
    expect(mediaToolPath('ffmpeg', { platform: 'linux', env: {}, resourcesPath: '', exists: () => false })).toBe(
      'ffmpeg'
    )
  })

  test('distinguishes a damaged package from missing developer setup', () => {
    expect(mediaToolMissingMessage('ffmpeg', 'C:\\SpeechEdit\\resources\\bin\\ffmpeg.exe')).toContain(
      'Re-download SpeechEdit'
    )
    expect(mediaToolMissingMessage('ffmpeg', 'ffmpeg')).toContain('keep them on PATH')
  })

  test('parses common ffmpeg version banners', () => {
    expect(parseMediaToolVersion('ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright')).toBe('4.4.2')
    expect(parseMediaToolVersion('ffprobe version n6.1.1 Copyright (c) 2007-2023')).toBe('6.1.1')
    expect(parseMediaToolVersion('not a tool')).toBeNull()
  })

  test('health check reports a mock PATH install', async () => {
    const health = await checkMediaTools({
      env: {},
      resourcesPath: '',
      exists: () => false,
      run: async (command) =>
        command.includes('ffprobe') ? 'ffprobe version 6.1.1 Copyright' : 'ffmpeg version 6.1.1 Copyright'
    })
    expect(health.ok).toBe(true)
    expect(health.message).toBeNull()
    expect(health.ffmpeg).toEqual({ name: 'ffmpeg', path: 'ffmpeg', version: '6.1.1', ok: true })
    expect(health.ffprobe.version).toBe('6.1.1')
    expect(mediaToolsHealthSummary(health)).toBe('FFmpeg 6.1.1')
  })

  test('missing override uses the packaged recovery sentence without spawning', async () => {
    const health = await checkMediaTools({
      env: {
        SPEECHEDIT_FFMPEG: 'C:\\missing\\ffmpeg.exe',
        SPEECHEDIT_FFPROBE: 'C:\\missing\\ffprobe.exe'
      },
      exists: () => false,
      run: async () => {
        throw new Error('should not spawn')
      }
    })
    expect(health.ok).toBe(false)
    expect(health.ffmpeg.ok).toBe(false)
    expect(health.ffprobe.ok).toBe(false)
    expect(health.message).toContain('Re-download SpeechEdit')
    expect(health.message).toContain('SPEECHEDIT_FFMPEG')
  })

  test('PATH spawn failure uses one install sentence', async () => {
    const health = await checkMediaTools({
      env: {},
      resourcesPath: '',
      exists: () => false,
      run: async () => {
        throw new Error('spawn ffmpeg ENOENT')
      }
    })
    expect(health.ok).toBe(false)
    expect(health.message).toBe(mediaToolsHealthMessage(health.ffmpeg, health.ffprobe))
    expect(health.message).toContain('keep them on PATH')
  })

  test('unparseable -version output is not treated as healthy', async () => {
    const health = await checkMediaTools({
      env: {},
      resourcesPath: '',
      exists: () => false,
      run: async () => 'ready'
    })
    expect(health.ok).toBe(false)
    expect(health.ffmpeg.version).toBeNull()
  })

  test('this machine can report ffmpeg and ffprobe versions', async () => {
    const health = await checkMediaTools()
    expect(health.ok).toBe(true)
    expect(health.message).toBeNull()
    expect(health.ffmpeg.version).toMatch(/^\d+\.\d+/)
    expect(health.ffprobe.version).toMatch(/^\d+\.\d+/)
  })
})
