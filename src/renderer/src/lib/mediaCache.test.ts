import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { ANALYSIS_CACHE_VERSION } from '../../../shared/importLooks'
import { host } from '../host'
import { useEditor } from '../store'
import { createEmptyProject } from './demo'
import { hydrateAssetLooks } from './documentIo'
import { openDocumentFromRaw, serializeDocument } from './projectDocument'

function withCacheHome<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.SPEECHEDIT_HOME
  process.env.SPEECHEDIT_HOME = `/tmp/se-cache-home-${Date.now()}-${Math.random().toString(16).slice(2)}`
  return fn().finally(() => {
    if (prev === undefined) delete process.env.SPEECHEDIT_HOME
    else process.env.SPEECHEDIT_HOME = prev
  })
}

describe('waveform and thumbnail disk cache', () => {
  test('second waveform read uses the on-disk peaks, not ffmpeg', async () => {
    await withCacheHome(async () => {
      const ffmpeg = Bun.which('ffmpeg')
      if (!ffmpeg) throw new Error('ffmpeg required for peak cache smoke')
      await Bun.$`${ffmpeg} -y -f lavfi -i sine=frequency=440:sample_rate=8000 -t 1 -c:a aac /tmp/se-peaks.m4a`.quiet()
      const { waveform } = await import('../../../main/ffmpeg.ts')
      const { peaksCachePath } = await import('../../../main/mediaCache.ts')
      const first = await waveform('/tmp/se-peaks.m4a')
      expect(first.length).toBe(1800)
      expect(first.some((n) => n > 0)).toBe(true)
      const cache = peaksCachePath('/tmp/se-peaks.m4a')
      expect(existsSync(cache)).toBe(true)
      writeFileSync(cache, JSON.stringify({ v: 1, samples: 1800, peaks: [0.42, 0.11] }))
      expect(await waveform('/tmp/se-peaks.m4a')).toEqual([0.42, 0.11])
    })
  }, 30000)

  test('thumbnail cache hit returns the stored frames', async () => {
    await withCacheHome(async () => {
      const ffmpeg = Bun.which('ffmpeg')
      if (!ffmpeg) throw new Error('ffmpeg required for thumb cache smoke')
      await Bun.$`${ffmpeg} -y -f lavfi -i testsrc=size=320x180:rate=10 -t 1 -pix_fmt yuv420p /tmp/se-thumbs.mp4`.quiet()
      const { thumbnails } = await import('../../../main/ffmpeg.ts')
      const { thumbsCachePath } = await import('../../../main/mediaCache.ts')
      mkdirSync(thumbsCachePath('/tmp/se-thumbs.mp4').replace(/[^/]+$/, ''), { recursive: true })
      writeFileSync(
        thumbsCachePath('/tmp/se-thumbs.mp4'),
        JSON.stringify({ v: 1, count: 20, thumbs: ['data:image/jpeg;base64,hit'] })
      )
      expect(await thumbnails('/tmp/se-thumbs.mp4')).toEqual(['data:image/jpeg;base64,hit'])
    })
  }, 30000)

  test('analyzeMedia cache hit skips ffmpeg', async () => {
    await withCacheHome(async () => {
      const ffmpeg = Bun.which('ffmpeg')
      if (!ffmpeg) throw new Error('ffmpeg required for analysis cache smoke')
      await Bun.$`${ffmpeg} -y -f lavfi -i sine=frequency=440:sample_rate=8000 -t 1 -c:a aac /tmp/se-analysis.m4a`.quiet()
      const { analyzeMedia } = await import('../../../main/ffmpeg.ts')
      const { analysisCachePath } = await import('../../../main/mediaCache.ts')
      mkdirSync(analysisCachePath('/tmp/se-analysis.m4a').replace(/[^/]+$/, ''), { recursive: true })
      const sentinel = {
        v: ANALYSIS_CACHE_VERSION,
        silence: [{ start: 0.2, end: 0.8 }],
        scenes: { times: [0.4], staticRegions: [] },
        loudness: [{ start: 0, end: 0.4, lufs: -10 }]
      }
      writeFileSync(analysisCachePath('/tmp/se-analysis.m4a'), JSON.stringify(sentinel))
      expect(await analyzeMedia('/tmp/se-analysis.m4a')).toEqual({
        silence: sentinel.silence,
        scenes: sentinel.scenes,
        loudness: sentinel.loudness
      })
    })
  }, 30000)

  test('transcribeMedia cache hit skips Whisper', async () => {
    await withCacheHome(async () => {
      const ffmpeg = Bun.which('ffmpeg')
      if (!ffmpeg) throw new Error('ffmpeg required for asr cache smoke')
      await Bun.$`${ffmpeg} -y -f lavfi -i sine=frequency=440:sample_rate=8000 -t 1 -c:a aac /tmp/se-asr.m4a`.quiet()
      const { transcribeMedia } = await import('../../../main/transcribe.ts')
      const { asrCachePath } = await import('../../../main/mediaCache.ts')
      const cues = [{ text: 'cached', start: 0, end: 0.4 }]
      mkdirSync(asrCachePath('/tmp/se-asr.m4a', 'whisper-cpp', 'tiny').replace(/[^/]+$/, ''), {
        recursive: true
      })
      writeFileSync(
        asrCachePath('/tmp/se-asr.m4a', 'whisper-cpp', 'tiny'),
        JSON.stringify({ v: 1, kind: 'whisper-cpp', model: 'tiny', cues })
      )
      expect(await transcribeMedia('/tmp/se-asr.m4a', { kind: 'whisper-cpp', model: 'tiny' })).toEqual(cues)
    })
  }, 30000)

  test('default whisper-cpp setting reuses a whisper-cli cache key', async () => {
    await withCacheHome(async () => {
      const ffmpeg = Bun.which('ffmpeg')
      if (!ffmpeg) throw new Error('ffmpeg required for asr cache smoke')
      await Bun.$`${ffmpeg} -y -f lavfi -i sine=frequency=440:sample_rate=8000 -t 1 -c:a aac /tmp/se-asr-def.m4a`.quiet()
      const { transcribeMedia } = await import('../../../main/transcribe.ts')
      const { asrCachePath } = await import('../../../main/mediaCache.ts')
      const cues = [{ text: 'default', start: 0.1, end: 0.5 }]
      mkdirSync(asrCachePath('/tmp/se-asr-def.m4a', 'whisper-cli', 'whisper-1').replace(/[^/]+$/, ''), {
        recursive: true
      })
      writeFileSync(
        asrCachePath('/tmp/se-asr-def.m4a', 'whisper-cli', 'whisper-1'),
        JSON.stringify({ v: 1, kind: 'whisper-cli', model: 'whisper-1', cues })
      )
      expect(await transcribeMedia('/tmp/se-asr-def.m4a', { kind: 'whisper-cpp', model: '' })).toEqual(cues)
    })
  }, 30000)

  test('whisper-cli import can reuse a whisper.cpp cache', async () => {
    await withCacheHome(async () => {
      const ffmpeg = Bun.which('ffmpeg')
      if (!ffmpeg) throw new Error('ffmpeg required for asr cache smoke')
      await Bun.$`${ffmpeg} -y -f lavfi -i sine=frequency=440:sample_rate=8000 -t 1 -c:a aac /tmp/se-asr-fb.m4a`.quiet()
      const { transcribeMedia } = await import('../../../main/transcribe.ts')
      const { asrCachePath } = await import('../../../main/mediaCache.ts')
      const cues = [{ text: 'fallback', start: 0.1, end: 0.5 }]
      mkdirSync(asrCachePath('/tmp/se-asr-fb.m4a', 'whisper-cpp', 'whisper-1').replace(/[^/]+$/, ''), {
        recursive: true
      })
      writeFileSync(
        asrCachePath('/tmp/se-asr-fb.m4a', 'whisper-cpp', 'whisper-1'),
        JSON.stringify({ v: 1, kind: 'whisper-cpp', model: 'whisper-1', cues })
      )
      expect(await transcribeMedia('/tmp/se-asr-fb.m4a', { kind: 'whisper-cli', model: 'whisper-1' })).toEqual(
        cues
      )
    })
  }, 30000)

  test('force transcribe ignores a planted ASR cache', async () => {
    await withCacheHome(async () => {
      const ffmpeg = Bun.which('ffmpeg')
      if (!ffmpeg) throw new Error('ffmpeg required for asr cache smoke')
      await Bun.$`${ffmpeg} -y -f lavfi -i sine=frequency=440:sample_rate=8000 -t 1 -c:a aac /tmp/se-asr-force.m4a`.quiet()
      const { transcribeMedia } = await import('../../../main/transcribe.ts')
      const { asrCachePath } = await import('../../../main/mediaCache.ts')
      const cues = [{ text: 'stale', start: 0, end: 1 }]
      mkdirSync(asrCachePath('/tmp/se-asr-force.m4a', 'whisper-cpp', 'tiny').replace(/[^/]+$/, ''), {
        recursive: true
      })
      writeFileSync(
        asrCachePath('/tmp/se-asr-force.m4a', 'whisper-cpp', 'tiny'),
        JSON.stringify({ v: 1, kind: 'whisper-cpp', model: 'tiny', cues })
      )
      let forced: unknown
      try {
        forced = await transcribeMedia('/tmp/se-asr-force.m4a', {
          kind: 'whisper-cpp',
          model: 'tiny',
          force: true
        })
      } catch (err) {
        forced = err
      }
      expect(forced).not.toEqual(cues)
    })
  }, 60000)

  test('opening a slim document refills looks without marking dirty', async () => {
    const prev = {
      waveform: host.waveform,
      thumbnails: host.thumbnails,
      mediaExists: host.mediaExists
    }
    host.mediaExists = async (paths) => paths.map((path) => ({ path, exists: true }))
    host.waveform = async () => [0.3, 0.1]
    host.thumbnails = async () => ['data:image/jpeg;base64,look']
    try {
      const project = {
        ...createEmptyProject('cache'),
        assets: {
          src: {
            id: 'src',
            path: '/tmp/se-thumbs.mp4',
            name: 'take.mp4',
            kind: 'video' as const,
            duration: 2,
            waveform: [] as number[]
          }
        }
      }
      useEditor.getState().loadProject(project, { path: '/tmp/talk.speechedit.json', clean: true })
      useEditor.getState().setMissingAssets([])
      expect(useEditor.getState().dirty).toBe(false)
      await hydrateAssetLooks()
      const asset = useEditor.getState().project.assets.src
      expect(asset.waveform).toEqual([0.3, 0.1])
      expect(asset.thumbnails).toEqual(['data:image/jpeg;base64,look'])
      expect(useEditor.getState().dirty).toBe(false)
    } finally {
      Object.assign(host, prev)
    }
  })

  test('save drops file-backed peaks; open refills them from the disk cache', async () => {
    await withCacheHome(async () => {
      const ffmpeg = Bun.which('ffmpeg')
      if (!ffmpeg) throw new Error('ffmpeg required for slim-waveform smoke')
      await Bun.$`${ffmpeg} -y -f lavfi -i sine=frequency=440:sample_rate=8000 -t 1 -c:a aac /tmp/se-slim-peaks.m4a`.quiet()
      const { waveform } = await import('../../../main/ffmpeg.ts')
      const peaks = await waveform('/tmp/se-slim-peaks.m4a')
      expect(peaks.length).toBe(1800)
      const project = {
        ...createEmptyProject('slim'),
        assets: {
          src: {
            id: 'src',
            path: '/tmp/se-slim-peaks.m4a',
            name: 'take.m4a',
            kind: 'audio' as const,
            duration: 1,
            waveform: peaks
          }
        }
      }
      const doc = serializeDocument(project, '/tmp/talk.speechedit.json')
      expect(doc.project.assets.src.waveform).toEqual([])
      const prev = { waveform: host.waveform, thumbnails: host.thumbnails, mediaExists: host.mediaExists }
      host.mediaExists = async (paths) => paths.map((path) => ({ path, exists: true }))
      host.waveform = (file) => waveform(file)
      host.thumbnails = async () => []
      try {
        const opened = openDocumentFromRaw(doc, '/tmp/talk.speechedit.json')
        useEditor.getState().loadProject(opened.project, {
          path: '/tmp/talk.speechedit.json',
          clean: true
        })
        useEditor.getState().setMissingAssets([])
        await hydrateAssetLooks()
        expect(useEditor.getState().project.assets.src.waveform).toEqual(peaks)
        expect(useEditor.getState().dirty).toBe(false)
      } finally {
        Object.assign(host, prev)
      }
    })
  }, 30000)

  test('silence still works on muxed video when looks skip the picture', async () => {
    await withCacheHome(async () => {
      const ffmpeg = Bun.which('ffmpeg')
      if (!ffmpeg) throw new Error('ffmpeg required for muxed silence smoke')
      await Bun.$`${ffmpeg} -y -f lavfi -i color=c=black:s=320x180:r=10 -f lavfi -i anullsrc=r=8000:cl=mono -t 1 -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac /tmp/se-looks-silent.mp4`.quiet()
      await Bun.$`${ffmpeg} -y -f lavfi -i anullsrc=r=8000:cl=mono -t 1 -c:a aac /tmp/se-looks-audio.m4a`.quiet()
      const { detectSilence, detectScenes, analyzeMedia } = await import('../../../main/ffmpeg.ts')
      const { analysisCachePath } = await import('../../../main/mediaCache.ts')
      const gaps = await detectSilence('/tmp/se-looks-silent.mp4')
      expect(gaps.some((gap) => gap.end - gap.start >= 0.3)).toBe(true)
      expect(await detectScenes('/tmp/se-looks-audio.m4a')).toEqual({ times: [], staticRegions: [] })
      mkdirSync(analysisCachePath('/tmp/se-looks-silent.mp4').replace(/[^/]+$/, ''), { recursive: true })
      writeFileSync(
        analysisCachePath('/tmp/se-looks-silent.mp4'),
        JSON.stringify({
          v: 1,
          silence: [{ start: 9, end: 9.5 }],
          scenes: { times: [1], staticRegions: [] },
          loudness: []
        })
      )
      const analysis = await analyzeMedia('/tmp/se-looks-silent.mp4')
      expect(analysis.silence).not.toEqual([{ start: 9, end: 9.5 }])
      expect(analysis.silence.some((gap) => gap.end - gap.start >= 0.3)).toBe(true)
    })
  }, 30000)
})
