import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

function withHome<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.SPEECHEDIT_HOME
  const prevSkip = process.env.SPEECHEDIT_SKIP_WHISPER_INSTALL
  process.env.SPEECHEDIT_HOME = `/tmp/se-asr-home-${Date.now()}-${Math.random().toString(16).slice(2)}`
  delete process.env.SPEECHEDIT_SKIP_WHISPER_INSTALL
  return fn().finally(() => {
    if (prev === undefined) delete process.env.SPEECHEDIT_HOME
    else process.env.SPEECHEDIT_HOME = prev
    if (prevSkip === undefined) delete process.env.SPEECHEDIT_SKIP_WHISPER_INSTALL
    else process.env.SPEECHEDIT_SKIP_WHISPER_INSTALL = prevSkip
  })
}

describe('first-run local Whisper install', () => {
  test('maybeEnsure skips when asked and is ready after a prior install', async () => {
    const { ensureLocalWhisper, maybeEnsureLocalWhisper } = await import('../../../main/asrLocal.ts')
    const ready = await ensureLocalWhisper()
    expect((await maybeEnsureLocalWhisper()).status).toBe('ready')
    expect((await maybeEnsureLocalWhisper({ skip: true })).status).toBe('ready')
    await withHome(async () => {
      expect((await maybeEnsureLocalWhisper({ skip: true })).status).toBe('skipped')
      expect(existsSync(join(process.env.SPEECHEDIT_HOME!, 'opt', 'whisper-cpp'))).toBe(false)
    })
    expect(ready.bin).toContain('whisper-cli')
  }, 180000)

  test('transcribeMedia installs when the ASR home is empty, and skipInstall does not fetch', async () => {
    const ffmpeg = Bun.which('ffmpeg')
    if (!ffmpeg) throw new Error('ffmpeg required for install-on-transcribe smoke')
    await Bun.$`${ffmpeg} -y -f lavfi -i sine=frequency=440:sample_rate=8000 -t 1 -c:a aac /tmp/se-asr-install.m4a`.quiet()
    const { transcribeMedia } = await import('../../../main/transcribe.ts')
    await withHome(async () => {
      const stages: string[] = []
      await transcribeMedia(
        '/tmp/se-asr-install.m4a',
        { kind: 'whisper-cpp', force: true, skipInstall: true },
        (info) => stages.push(info.stage)
      ).catch(() => undefined)
      expect(stages).not.toContain('install')

      const fetched: string[] = []
      const prevFetch = globalThis.fetch
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        fetched.push(String(input))
        throw new Error('offline')
      }) as typeof fetch
      const installed: string[] = []
      try {
        await transcribeMedia(
          '/tmp/se-asr-install.m4a',
          { kind: 'whisper-cpp', force: true },
          (info) => installed.push(info.stage)
        ).catch(() => undefined)
        expect(installed).toContain('install')
        expect(fetched.length).toBeGreaterThan(0)
      } finally {
        globalThis.fetch = prevFetch
      }
    })
  }, 60000)
})
