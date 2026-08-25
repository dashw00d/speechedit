import { existsSync, unlinkSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { isVariableFrameRate, needsProxy, playbackPath, previewUnsafeCodec } from '../../../shared/proxy'
import { host } from '../host'
import { useEditor } from '../store'
import { applyCommand } from './commands'
import { createEmptyProject } from './demo'
import { hydrateAssetProxies } from './documentIo'
import { buildExportJob } from './exportJob'
import { importRecording } from './importMedia'
import { inspectPickedMedia } from './pickFile'

describe('preview proxy vs export original', () => {
  test('needsProxy is for HD / long / HEVC / VFR camera files, not short SD H.264', () => {
    expect(needsProxy({ hasVideo: true, width: 1920, height: 1080, duration: 8 })).toBe(true)
    expect(needsProxy({ hasVideo: true, width: 1280, height: 720, duration: 10 })).toBe(true)
    expect(needsProxy({ hasVideo: true, width: 960, height: 540, duration: 90 })).toBe(true)
    expect(needsProxy({ hasVideo: true, width: 960, height: 540, duration: 12 })).toBe(false)
    expect(needsProxy({ hasVideo: true, width: 960, height: 540, duration: 12, codec: 'h264' })).toBe(false)
    expect(needsProxy({ hasVideo: true, width: 640, height: 360, duration: 8, codec: 'hevc' })).toBe(true)
    expect(needsProxy({ hasVideo: true, width: 640, height: 360, duration: 8, codec: 'hvc1' })).toBe(true)
    expect(needsProxy({ hasVideo: true, width: 640, height: 360, duration: 8, vfr: true })).toBe(true)
    expect(needsProxy({ hasVideo: false, width: 1920, duration: 120 })).toBe(false)
    expect(isVariableFrameRate('30/1', '30/1')).toBe(false)
    expect(isVariableFrameRate('24000/1001', '30000/1001')).toBe(true)
    expect(isVariableFrameRate('24.5/1', '30/1')).toBe(true)
  })

  test('importRecording attaches a proxy for SD HEVC so the monitor can play it', async () => {
    const prev = {
      probe: host.probe,
      makeProxy: host.makeProxy,
      waveform: host.waveform,
      thumbnails: host.thumbnails,
      analyze: host.analyze,
      silence: host.silence,
      transcribe: host.transcribe
    }
    host.probe = async () => ({
      duration: 8,
      width: 640,
      height: 360,
      codec: 'hevc',
      hasVideo: true,
      hasAudio: true
    })
    host.makeProxy = async () => '/tmp/se-hevc.proxy.mp4'
    host.waveform = async () => [0.1]
    host.thumbnails = async () => []
    host.analyze = async () => ({ silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] })
    host.silence = async () => []
    host.transcribe = async () => null
    try {
      const project = await importRecording('/tmp/se-phone-hevc.mp4')
      const asset = Object.values(project.assets)[0]
      expect(previewUnsafeCodec('hevc')).toBe(true)
      expect(asset.proxyPath).toBe('/tmp/se-hevc.proxy.mp4')
      expect(asset.codec).toBe('hevc')
      expect(playbackPath(asset)).toBe('/tmp/se-hevc.proxy.mp4')
      expect(buildExportJob(project, '/tmp/out.mp4')?.input).toBe('/tmp/se-phone-hevc.mp4')
    } finally {
      Object.assign(host, prev)
    }
  })

  test('playback falls back to the camera file when the proxy is known missing', () => {
    expect(
      playbackPath(
        { path: '/data/reel/take.mp4', proxyPath: '/tmp/gone.proxy.mp4' },
        { proxyExists: false }
      )
    ).toBe('/data/reel/take.mp4')
    expect(
      playbackPath(
        { path: '/data/reel/take.mp4', proxyPath: '/tmp/live.proxy.mp4' },
        { proxyExists: true }
      )
    ).toBe('/tmp/live.proxy.mp4')
  })

  test('reopen remakes a missing preview proxy without dirtying or changing export', async () => {
    const prev = { mediaExists: host.mediaExists, makeProxy: host.makeProxy }
    let remakes = 0
    host.mediaExists = async (paths) =>
      paths.map((path) => ({ path, exists: path === '/data/reel/take.mp4' }))
    host.makeProxy = async () => {
      remakes += 1
      return '/tmp/se-remade.proxy.mp4'
    }
    try {
      const project = {
        ...createEmptyProject('reopen'),
        sourceDuration: 2,
        assets: {
          src: {
            id: 'src',
            path: '/data/reel/take.mp4',
            name: 'take.mp4',
            kind: 'video' as const,
            duration: 2,
            waveform: [],
            proxyPath: '/tmp/se-gone.proxy.mp4'
          }
        }
      }
      useEditor.getState().loadProject(project, { path: '/tmp/talk.speechedit.json', clean: true })
      useEditor.getState().setMissingAssets([])
      await hydrateAssetProxies()
      const asset = useEditor.getState().project.assets.src
      expect(remakes).toBe(1)
      expect(asset.proxyPath).toBe('/tmp/se-remade.proxy.mp4')
      expect(playbackPath(asset)).toBe('/tmp/se-remade.proxy.mp4')
      expect(useEditor.getState().dirty).toBe(false)
      expect(buildExportJob(useEditor.getState().project, '/tmp/out.mp4')?.input).toBe('/data/reel/take.mp4')
    } finally {
      Object.assign(host, prev)
    }
  })

  test('reopen drops a ghost proxy when remake fails so H.264 can still play', async () => {
    const prev = { mediaExists: host.mediaExists, makeProxy: host.makeProxy }
    host.mediaExists = async (paths) => paths.map((path) => ({ path, exists: false }))
    host.makeProxy = async () => ''
    try {
      const project = {
        ...createEmptyProject('ghost'),
        assets: {
          src: {
            id: 'src',
            path: '/data/reel/take.mp4',
            name: 'take.mp4',
            kind: 'video' as const,
            duration: 2,
            waveform: [],
            proxyPath: '/tmp/se-ghost.proxy.mp4'
          }
        }
      }
      useEditor.getState().loadProject(project, { clean: true })
      useEditor.getState().setMissingAssets([])
      await hydrateAssetProxies()
      const asset = useEditor.getState().project.assets.src
      expect(asset.proxyPath).toBeUndefined()
      expect(playbackPath(asset)).toBe('/data/reel/take.mp4')
      expect(useEditor.getState().dirty).toBe(false)
    } finally {
      Object.assign(host, prev)
    }
  })

  test('reopen remakes HEVC that never stored a proxy path', async () => {
    const prev = { mediaExists: host.mediaExists, makeProxy: host.makeProxy, probe: host.probe }
    host.makeProxy = async () => '/tmp/se-needed.proxy.mp4'
    host.probe = async () => {
      throw new Error('should use stored codec, not probe')
    }
    try {
      useEditor.getState().loadProject(
        {
          ...createEmptyProject('need-proxy'),
          assets: {
            src: {
              id: 'src',
              path: '/data/reel/phone.mp4',
              name: 'phone.mp4',
              kind: 'video',
              duration: 8,
              width: 640,
              height: 360,
              waveform: [],
              codec: 'hevc'
            }
          }
        },
        { clean: true }
      )
      useEditor.getState().setMissingAssets([])
      await hydrateAssetProxies()
      expect(useEditor.getState().project.assets.src.proxyPath).toBe('/tmp/se-needed.proxy.mp4')
      expect(useEditor.getState().dirty).toBe(false)
    } finally {
      Object.assign(host, prev)
    }
  })

  test('reopen does not invent a proxy for short SD H.264', async () => {
    const prev = { makeProxy: host.makeProxy, probe: host.probe }
    host.makeProxy = async () => {
      throw new Error('should not proxy short SD H.264')
    }
    host.probe = async () => {
      throw new Error('should use stored codec')
    }
    try {
      useEditor.getState().loadProject(
        {
          ...createEmptyProject('sd'),
          assets: {
            src: {
              id: 'src',
              path: '/data/reel/talk.mp4',
              name: 'talk.mp4',
              kind: 'video',
              duration: 8,
              width: 960,
              height: 540,
              waveform: [],
              codec: 'h264'
            }
          }
        },
        { clean: true }
      )
      await hydrateAssetProxies()
      expect(useEditor.getState().project.assets.src.proxyPath).toBeUndefined()
    } finally {
      Object.assign(host, prev)
    }
  })

  test('reopen keeps a live proxy and does not remake it', async () => {
    const prev = { mediaExists: host.mediaExists, makeProxy: host.makeProxy }
    host.mediaExists = async (paths) => paths.map((path) => ({ path, exists: true }))
    host.makeProxy = async () => {
      throw new Error('should not remake a live proxy')
    }
    try {
      const project = {
        ...createEmptyProject('live'),
        assets: {
          src: {
            id: 'src',
            path: '/data/reel/take.mp4',
            name: 'take.mp4',
            kind: 'video' as const,
            duration: 2,
            waveform: [],
            proxyPath: '/tmp/se-live.proxy.mp4'
          }
        }
      }
      useEditor.getState().loadProject(project, { clean: true })
      await hydrateAssetProxies()
      expect(useEditor.getState().project.assets.src.proxyPath).toBe('/tmp/se-live.proxy.mp4')
    } finally {
      Object.assign(host, prev)
    }
  })

  test('playback uses proxy; export job keeps the camera original', () => {
    let project = createEmptyProject('proxy')
    project = {
      ...project,
      sourceDuration: 2,
      assets: {
        src: {
          id: 'src',
          path: '/data/reel/take.mp4',
          name: 'take.mp4',
          kind: 'video',
          duration: 2,
          waveform: [],
          proxyPath: '/tmp/se-proxy.mp4'
        }
      }
    }
    expect(playbackPath(project.assets.src)).toBe('/tmp/se-proxy.mp4')
    const job = buildExportJob(project, '/tmp/se-out.mp4')
    expect(job?.input).toBe('/data/reel/take.mp4')
    const cleared = applyCommand(project, { type: 'setAssetProxy', assetId: 'src', proxyPath: null })
    expect(playbackPath(cleared.assets.src)).toBe('/data/reel/take.mp4')
    expect(buildExportJob(cleared, '/tmp/se-out.mp4')?.input).toBe('/data/reel/take.mp4')
  })

  test('relink drops a stale proxy', () => {
    let project = createEmptyProject('proxy')
    project = {
      ...project,
      assets: {
        src: {
          id: 'src',
          path: '/old/take.mp4',
          name: 'take.mp4',
          kind: 'video',
          duration: 2,
          waveform: [],
          proxyPath: '/old/take.proxy.mp4',
          codec: 'hevc'
        }
      }
    }
    const next = applyCommand(project, { type: 'relinkAsset', assetId: 'src', path: '/new/take.mp4' })
    expect(next.assets.src.path).toBe('/new/take.mp4')
    expect(next.assets.src.proxyPath).toBeUndefined()
    expect(next.assets.src.codec).toBeUndefined()
  })

  test('HEVC camera file is proxied to H.264 for preview; export keeps HEVC', async () => {
    const ffmpeg = Bun.which('ffmpeg')
    const ffprobe = Bun.which('ffprobe')
    if (!ffmpeg || !ffprobe) throw new Error('ffmpeg/ffprobe required for HEVC proxy smoke')
    const encoders = await Bun.$`${ffmpeg} -hide_banner -encoders`.text()
    if (!/libx265/.test(encoders)) return
    await Bun.$`${ffmpeg} -y -f lavfi -i testsrc=size=640x360:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 1 -c:v libx265 -pix_fmt yuv420p -c:a aac /tmp/se-hevc-src.mp4`.quiet()
    const { makeProxy, probe } = await import('../../../main/ffmpeg.ts')
    const original = await probe('/tmp/se-hevc-src.mp4')
    expect(original.codec).toMatch(/hevc|h265/i)
    expect(needsProxy(original)).toBe(true)
    const proxy = await makeProxy('/tmp/se-hevc-src.mp4', '/tmp/se-hevc-src.proxy.mp4')
    const preview = await probe(proxy)
    expect(preview.codec).toMatch(/h264|avc/i)
    expect(preview.hasVideo).toBe(true)
    expect(preview.width).toBeLessThanOrEqual(960)
    expect(buildExportJob({
      ...createEmptyProject('hevc'),
      sourceDuration: original.duration,
      assets: {
        src: {
          id: 'src',
          path: '/tmp/se-hevc-src.mp4',
          name: 'hevc.mp4',
          kind: 'video',
          duration: original.duration,
          waveform: [],
          proxyPath: proxy
        }
      }
    }, '/tmp/se-hevc-out.mp4')?.input).toBe('/tmp/se-hevc-src.mp4')
  }, 60000)

  test('hydrate remakes a deleted HEVC preview proxy; export still reads HEVC', async () => {
    const ffmpeg = Bun.which('ffmpeg')
    const ffprobe = Bun.which('ffprobe')
    if (!ffmpeg || !ffprobe) throw new Error('ffmpeg/ffprobe required for HEVC remake smoke')
    const encoders = await Bun.$`${ffmpeg} -hide_banner -encoders`.text()
    if (!/libx265/.test(encoders)) return
    await Bun.$`${ffmpeg} -y -f lavfi -i testsrc=size=640x360:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 1 -c:v libx265 -pix_fmt yuv420p -c:a aac /tmp/se-hevc-reopen.mp4`.quiet()
    const { makeProxy, probe } = await import('../../../main/ffmpeg.ts')
    const gone = '/tmp/se-hevc-reopen.gone.mp4'
    const remade = '/tmp/se-hevc-reopen.proxy.mp4'
    await makeProxy('/tmp/se-hevc-reopen.mp4', gone)
    unlinkSync(gone)
    const prev = { mediaExists: host.mediaExists, makeProxy: host.makeProxy }
    host.mediaExists = async (paths) => paths.map((path) => ({ path, exists: existsSync(path) }))
    host.makeProxy = async (file) => makeProxy(file, remade)
    try {
      const info = await probe('/tmp/se-hevc-reopen.mp4')
      useEditor.getState().loadProject(
        {
          ...createEmptyProject('reopen-hevc'),
          sourceDuration: info.duration,
          assets: {
            src: {
              id: 'src',
              path: '/tmp/se-hevc-reopen.mp4',
              name: 'hevc.mp4',
              kind: 'video',
              duration: info.duration,
              waveform: [],
              proxyPath: gone
            }
          }
        },
        { clean: true }
      )
      useEditor.getState().setMissingAssets([])
      await hydrateAssetProxies()
      const asset = useEditor.getState().project.assets.src
      expect(asset.proxyPath).toBe(remade)
      expect(existsSync(remade)).toBe(true)
      expect((await probe(remade)).codec).toMatch(/h264|avc/i)
      expect(useEditor.getState().dirty).toBe(false)
      expect(buildExportJob(useEditor.getState().project, '/tmp/se-hevc-reopen-out.mp4')?.input).toBe(
        '/tmp/se-hevc-reopen.mp4'
      )
    } finally {
      Object.assign(host, prev)
    }
  }, 60000)

  test('makeProxy writes a smaller preview file; export still reads the original', async () => {
    const ffmpeg = Bun.which('ffmpeg')
    const ffprobe = Bun.which('ffprobe')
    if (!ffmpeg || !ffprobe) throw new Error('ffmpeg/ffprobe required for proxy smoke')
    await Bun.$`${ffmpeg} -y -f lavfi -i testsrc=size=1920x1080:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 2 -pix_fmt yuv420p /tmp/se-camera.mp4`.quiet()
    const { makeProxy, probe } = await import('../../../main/ffmpeg.ts')
    const proxy = await makeProxy('/tmp/se-camera.mp4', '/tmp/se-camera.proxy.mp4')
    const original = await probe('/tmp/se-camera.mp4')
    const preview = await probe(proxy)
    expect(original.width).toBe(1920)
    expect(preview.width).toBeLessThanOrEqual(960)
    expect(preview.hasVideo).toBe(true)
    expect(preview.hasAudio).toBe(true)
    expect(preview.duration).toBeGreaterThan(1.5)
    expect(needsProxy(original)).toBe(true)
    let project = createEmptyProject('camera')
    project = {
      ...project,
      sourceDuration: original.duration,
      width: original.width ?? 1920,
      height: original.height ?? 1080,
      assets: {
        src: {
          id: 'src',
          path: '/tmp/se-camera.mp4',
          name: 'camera.mp4',
          kind: 'video',
          duration: original.duration,
          waveform: [],
          proxyPath: proxy
        }
      }
    }
    expect(playbackPath(project.assets.src)).toBe(proxy)
    expect(buildExportJob(project, '/tmp/se-camera-out.mp4')?.input).toBe('/tmp/se-camera.mp4')
  }, 60000)

  test('importRecording attaches a proxy on HD video and still exports the original', async () => {
    const prev = {
      probe: host.probe,
      makeProxy: host.makeProxy,
      waveform: host.waveform,
      thumbnails: host.thumbnails,
      analyze: host.analyze,
      silence: host.silence,
      transcribe: host.transcribe
    }
    host.probe = async () => ({
      duration: 8,
      width: 1920,
      height: 1080,
      hasVideo: true,
      hasAudio: true
    })
    host.makeProxy = async () => '/tmp/se-imported.proxy.mp4'
    host.waveform = async () => [0.1]
    host.thumbnails = async () => []
    host.analyze = async () => ({ silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] })
    host.silence = async () => []
    host.transcribe = async () => null
    try {
      const project = await importRecording('/tmp/se-camera.mp4')
      const asset = Object.values(project.assets)[0]
      expect(asset.path).toBe('/tmp/se-camera.mp4')
      expect(asset.proxyPath).toBe('/tmp/se-imported.proxy.mp4')
      expect(playbackPath(asset)).toBe('/tmp/se-imported.proxy.mp4')
      expect(buildExportJob(project, '/tmp/out.mp4')?.input).toBe('/tmp/se-camera.mp4')
    } finally {
      Object.assign(host, prev)
    }
  })

  test('HD B-roll pick attaches a proxy without changing the source path', async () => {
    const prev = { probe: host.probe, makeProxy: host.makeProxy, waveform: host.waveform }
    host.probe = async () => ({
      duration: 6,
      width: 1920,
      height: 1080,
      hasVideo: true,
      hasAudio: false
    })
    host.makeProxy = async () => '/tmp/se-broll.proxy.mp4'
    host.waveform = async () => []
    try {
      const clip = await inspectPickedMedia('/tmp/se-broll.mp4', 'broll')
      expect(clip.path).toBe('/tmp/se-broll.mp4')
      expect(clip.proxyPath).toBe('/tmp/se-broll.proxy.mp4')
    } finally {
      Object.assign(host, prev)
    }
  })
})
