import { describe, expect, test } from 'bun:test'
import { mediaToolMissingMessage, mediaToolPath } from '../../../main/mediaTools'

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
})
