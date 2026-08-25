import { describe, expect, test } from 'bun:test'
import {
  displaySize,
  parseStreamRotation,
  programFrame,
  quarterTurn,
  transposeFilters
} from '../../../shared/mediaOrient'
import { host } from '../host'
import { applyCommand } from './commands'
import { createEmptyProject } from './demo'
import { buildSegmentFilters } from './exportGraph'
import { buildExportJob } from './exportJob'
import { importRecording } from './importMedia'

describe('camera display rotation', () => {
  test('display size swaps for 90/270 and displaymatrix -90', () => {
    expect(quarterTurn(-90)).toBe(270)
    expect(quarterTurn(90)).toBe(90)
    expect(displaySize(1920, 1080, 90)).toEqual({ width: 1080, height: 1920 })
    expect(displaySize(1920, 1080, 270)).toEqual({ width: 1080, height: 1920 })
    expect(displaySize(1920, 1080, 0)).toEqual({ width: 1920, height: 1080 })
    expect(parseStreamRotation({ tags: { rotate: '90' } })).toBe(90)
    expect(parseStreamRotation({ side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }] })).toBe(
      270
    )
    expect(transposeFilters(90)).toEqual(['transpose=1'])
    expect(transposeFilters(270)).toEqual(['transpose=2'])
    expect(transposeFilters(0)).toEqual([])
  })

  test('program frame matches the export canvas for portrait and landscape', () => {
    expect(programFrame(1920, 1080)).toEqual({ width: 1920, height: 1080, orientation: 'landscape' })
    expect(programFrame(1080, 1920)).toEqual({ width: 1080, height: 1920, orientation: 'portrait' })
    expect(programFrame(1080, 1080)).toEqual({ width: 1080, height: 1080, orientation: 'square' })
    let project = createEmptyProject('phone')
    project = {
      ...project,
      width: 1080,
      height: 1920,
      sourceDuration: 2,
      assets: {
        src: {
          id: 'src',
          path: '/tmp/se-phone.mp4',
          name: 'phone.mp4',
          kind: 'video',
          duration: 2,
          waveform: [],
          displayRotation: 90
        }
      }
    }
    const job = buildExportJob(project, '/tmp/se-phone-frame.mp4')!
    const frame = programFrame(project.width, project.height)
    expect(frame.width).toBe(job.width)
    expect(frame.height).toBe(job.height)
    expect(frame.orientation).toBe('portrait')
  })

  test('import of rotated camera footage sets a portrait program and export transpose', async () => {
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
      rotation: 90,
      hasVideo: true,
      hasAudio: true
    })
    host.makeProxy = async () => '/tmp/se-phone.proxy.mp4'
    host.waveform = async () => [0.1]
    host.thumbnails = async () => []
    host.analyze = async () => ({ silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] })
    host.silence = async () => []
    host.transcribe = async () => null
    try {
      const project = await importRecording('/tmp/se-phone.mp4')
      expect(project.width).toBe(1080)
      expect(project.height).toBe(1920)
      const asset = Object.values(project.assets)[0]
      expect(asset.displayRotation).toBe(90)
      expect(asset.width).toBe(1080)
      expect(asset.height).toBe(1920)
      const job = buildExportJob(project, '/tmp/se-phone-out.mp4')!
      expect(job.input).toBe('/tmp/se-phone.mp4')
      expect(job.inputRotation).toBe(90)
      expect(job.width).toBe(1080)
      expect(job.height).toBe(1920)
      const vf = buildSegmentFilters(job, {
        start: 0,
        end: 1,
        speed: 1,
        scale: 1,
        x: 0,
        y: 0,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0
      }).vf
      expect(vf.startsWith('transpose=1,')).toBe(true)
      expect(vf).toContain('scale=1080:1920')
    } finally {
      Object.assign(host, prev)
    }
  })

  test('probe reads rotate=90 and export writes a portrait program', async () => {
    const ffmpeg = Bun.which('ffmpeg')
    const ffprobe = Bun.which('ffprobe')
    if (!ffmpeg || !ffprobe) throw new Error('ffmpeg required for camera rotation smoke')
    await Bun.$`${ffmpeg} -y -f lavfi -i testsrc=size=640x360:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 1 -pix_fmt yuv420p /tmp/se-land-src.mp4`.quiet()
    await Bun.$`${ffmpeg} -y -i /tmp/se-land-src.mp4 -c copy -metadata:s:v:0 rotate=90 /tmp/se-phone-rot.mp4`.quiet()
    const { exportProgram, probe } = await import('../../../main/ffmpeg.ts')
    const info = await probe('/tmp/se-phone-rot.mp4')
    expect(info.width).toBe(640)
    expect(info.height).toBe(360)
    if (!info.rotation) {
      await Bun.$`${ffmpeg} -y -i /tmp/se-land-src.mp4 -c:v libx264 -pix_fmt yuv420p -c:a aac -metadata:s:v:0 rotate=90 /tmp/se-phone-rot.mp4`.quiet()
    }
    const stamped = info.rotation ? info : await probe('/tmp/se-phone-rot.mp4')
    expect([90, 270]).toContain(stamped.rotation)
    const shown = displaySize(stamped.width, stamped.height, stamped.rotation)
    await exportProgram({
      input: '/tmp/se-phone-rot.mp4',
      output: '/tmp/se-phone-rot-out.mp4',
      fps: 30,
      width: shown.width ?? 360,
      height: shown.height ?? 640,
      inputRotation: stamped.rotation,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      encoder: 'libx264',
      normalize: false,
      segments: [{ start: 0, end: 0.9, speed: 1, scale: 1, x: 0, y: 0, volume: 1, fadeIn: 0, fadeOut: 0 }],
      layers: []
    })
    const out = await probe('/tmp/se-phone-rot-out.mp4')
    expect(out.width).toBeLessThan(out.height ?? 0)
    expect(out.width).toBe(360)
    expect(out.height).toBe(640)
  }, 60000)

  test('landscape footage without rotation keeps the coded canvas', () => {
    let project = createEmptyProject('land')
    project = {
      ...project,
      sourceDuration: 2,
      width: 1920,
      height: 1080,
      assets: {
        src: {
          id: 'src',
          path: '/tmp/se-land.mp4',
          name: 'land.mp4',
          kind: 'video',
          duration: 2,
          waveform: []
        }
      }
    }
    project = applyCommand(project, { type: 'deleteRange', start: 0.5, end: 0.6, source: 'manual' })
    const job = buildExportJob(project, '/tmp/out.mp4')!
    expect(job.inputRotation).toBeUndefined()
    expect(buildSegmentFilters(job, job.segments[0]).vf.startsWith('scale=')).toBe(true)
  })
})
