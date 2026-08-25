import { describe, expect, test } from 'bun:test'
import { needsProxy, playbackPath } from '../../../shared/proxy'
import { host } from '../host'
import { applyCommand } from './commands'
import { createEmptyProject } from './demo'
import { buildExportJob } from './exportJob'
import { importRecording } from './importMedia'
import { inspectPickedMedia } from './pickFile'

describe('preview proxy vs export original', () => {
  test('needsProxy is for HD / long camera files, not short SD', () => {
    expect(needsProxy({ hasVideo: true, width: 1920, height: 1080, duration: 8 })).toBe(true)
    expect(needsProxy({ hasVideo: true, width: 1280, height: 720, duration: 10 })).toBe(true)
    expect(needsProxy({ hasVideo: true, width: 960, height: 540, duration: 90 })).toBe(true)
    expect(needsProxy({ hasVideo: true, width: 960, height: 540, duration: 12 })).toBe(false)
    expect(needsProxy({ hasVideo: false, width: 1920, duration: 120 })).toBe(false)
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
          proxyPath: '/old/take.proxy.mp4'
        }
      }
    }
    const next = applyCommand(project, { type: 'relinkAsset', assetId: 'src', path: '/new/take.mp4' })
    expect(next.assets.src.path).toBe('/new/take.mp4')
    expect(next.assets.src.proxyPath).toBeUndefined()
  })

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
