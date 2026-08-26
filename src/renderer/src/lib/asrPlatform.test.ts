import { describe, expect, test } from 'bun:test'
import {
  whisperArchiveExtension,
  whisperExecutableName,
  whisperExtractFlag,
  whisperReleaseDirectory,
  whisperRuntimeReady
} from '../../../main/asrLocal'

describe('whisper.cpp platform package layout', () => {
  test('uses the released Windows zip, exe, and Release directory', () => {
    expect(whisperArchiveExtension('win32')).toBe('zip')
    expect(whisperExtractFlag('win32')).toBe('-xf')
    expect(whisperExecutableName('win32')).toBe('whisper-cli.exe')
    expect(whisperReleaseDirectory('win32', 'x64')).toBe('Release')
  })

  test('keeps Linux archives architecture-specific', () => {
    expect(whisperArchiveExtension('linux')).toBe('tar.gz')
    expect(whisperExtractFlag('linux')).toBe('-xzf')
    expect(whisperReleaseDirectory('linux', 'arm64')).toBe('whisper-bin-ubuntu-arm64')
  })

  test('requires the Windows executable and runtime DLLs', () => {
    const files = new Set(['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll'])
    const ready = whisperRuntimeReady('runtime', 'win32', (path) => files.has(path.split(/[\\/]/).pop() ?? ''))
    expect(ready).toBe(true)
    files.delete('whisper.dll')
    expect(whisperRuntimeReady('runtime', 'win32', (path) => files.has(path.split(/[\\/]/).pop() ?? ''))).toBe(
      false
    )
  })
})
