import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createEmptyProject } from './demo'
import {
  buildJoinGraph,
  buildMixGraph,
  buildSegmentFilters,
  explainExportError,
  summarizeJob,
  voiceAudioFilters
} from './exportGraph'
import { buildExportJob, duckGainAt, programVolume, visibleGraphicClips } from './exportJob'
import { DEFAULT_TRANSFORM, emptyClipFields, type Project } from '../types'

function fixtureProject(): Project {
  let p = createEmptyProject('export-fixture')
  p = {
    ...p,
    sourceDuration: 2,
    width: 320,
    height: 240,
    fps: 30,
    audioMaster: {
      ...p.audioMaster,
      eqLow: 2,
      eqMid: -1,
      eqHigh: 1.5,
      compress: true,
      duck: 0.4,
      normalize: true,
      fadeIn: 0.1,
      fadeOut: 0.12
    },
    assets: {
      src: {
        id: 'src',
        path: '/tmp/se-src.mp4',
        name: 'src.mp4',
        kind: 'video',
        duration: 2,
        waveform: []
      }
    }
  }
  p = applyCommand(p, { type: 'deleteRange', start: 1.0, end: 1.4, source: 'manual' })
  p = applyCommand(p, {
    type: 'addAudio',
    start: 0.2,
    duration: 1.5,
    asset: {
      id: 'bed1',
      path: '/tmp/se-bed.wav',
      name: 'bed.wav',
      kind: 'audio',
      duration: 2,
      waveform: []
    }
  })
  p = applyCommand(p, {
    type: 'addBroll',
    start: 0.4,
    duration: 0.8,
    asset: {
      id: 'still1',
      path: '/tmp/se-still.png',
      name: 'still.png',
      kind: 'image',
      duration: 1,
      waveform: []
    }
  })
  p = applyCommand(p, { type: 'addCaption', start: 0.1, duration: 1.2, text: 'Never Shotcut' })
  p = applyCommand(p, { type: 'addOverlay', start: 0.5, duration: 0.6, text: 'CARD' })
  return p
}

describe('buildExportJob fixture', () => {
  test('cut + bed + still + captions + duck + EQ ride the command bus', () => {
    const project = fixtureProject()
    const job = buildExportJob(project, '/tmp/se-out.mp4')
    expect(job).toBeTruthy()
    expect(job!.input).toBe('/tmp/se-src.mp4')
    expect(job!.segments.length).toBeGreaterThan(1)
    expect(job!.segments.some((s) => s.end <= 1.0 + 1e-6)).toBe(true)
    expect(job!.beds.some((b) => b.path === '/tmp/se-bed.wav' && b.start === 0.2)).toBe(true)
    expect(job!.layers.some((l) => l.kind === 'caption' && l.text === 'Never Shotcut')).toBe(true)
    expect(job!.layers.some((l) => l.kind === 'overlay' && l.text === 'CARD')).toBe(true)
    const still = job!.layers.find((l) => l.kind === 'image')
    expect(still?.path).toBe('/tmp/se-still.png')
    expect(still?.loop).toBe(true)
    expect(job!.eqLow).toBe(2)
    expect(job!.eqMid).toBe(-1)
    expect(job!.eqHigh).toBe(1.5)
    expect(job!.compress).toBe(true)
    expect(job!.normalize).toBe(true)
    expect(job!.duck).toBe(0.4)
    expect(job!.duckWindows.some((w) => Math.abs(w.start - 0.4) < 1e-6 && Math.abs(w.end - 1.2) < 1e-6)).toBe(true)
    expect(duckGainAt(project, 0.7)).toBeCloseTo(0.6, 5)
    expect(duckGainAt(project, 0.1)).toBe(1)
    expect(programVolume(project, 0.7).ducked).toBe(true)
    expect(visibleGraphicClips(project, 0.7, 'overlay').length).toBeGreaterThan(1)
  })

  test('hidden and muted graphic tracks do not export', () => {
    const project = fixtureProject()
    const hidden: Project = {
      ...project,
      tracks: project.tracks.map((t) => (t.type === 'caption' ? { ...t, hidden: true } : t))
    }
    const extra = applyCommand(hidden, { type: 'addTrack', trackType: 'overlay', name: 'V4 Cards' })
    const v4 = extra.tracks.find((t) => t.name === 'V4 Cards')
    expect(v4).toBeTruthy()
    const withCard: Project = {
      ...extra,
      tracks: extra.tracks.map((t) =>
        t.id === v4!.id
          ? {
              ...t,
              clips: [
                {
                  id: 'v4clip',
                  trackId: t.id,
                  start: 0.2,
                  duration: 0.5,
                  inPoint: 0,
                  outPoint: 0.5,
                  transform: { ...DEFAULT_TRANSFORM },
                  volume: 1,
                  muted: false,
                  speed: 1,
                  text: 'V4 card',
                  ...emptyClipFields()
                }
              ]
            }
          : t
      )
    }
    const job = buildExportJob(withCard, '/tmp/se-out.mp4')
    expect(job!.layers.some((l) => l.text === 'Never Shotcut')).toBe(false)
    expect(job!.layers.some((l) => l.text === 'V4 card')).toBe(true)
    expect(visibleGraphicClips(withCard, 0.3, 'caption')).toHaveLength(0)
    expect(visibleGraphicClips(withCard, 0.3, 'overlay').some((c) => c.text === 'V4 card')).toBe(true)
  })
})

describe('export graph (ffmpeg 4.4, no process)', () => {
  test('mix graph fires captions, still loop, beds, duck after loudnorm, even scale', () => {
    const job = buildExportJob(fixtureProject(), '/tmp/se-out.mp4')!
    const mix = buildMixGraph(job, { fontFile: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' })
    expect(mix.notes.join(' ')).toMatch(/caption/)
    expect(mix.notes.join(' ')).toMatch(/still/)
    expect(mix.notes.join(' ')).toMatch(/bed/)
    expect(mix.notes.join(' ')).toMatch(/duck/)
    expect(mix.notes.join(' ')).toMatch(/EQ/)
    expect(mix.notes.join(' ')).toMatch(/loudnorm/)
    expect(summarizeJob(job, mix)).toContain('clip')

    expect(mix.filterComplex).toContain("drawtext=text='Never Shotcut'")
    expect(mix.filterComplex).toContain('fontfile=')
    expect(mix.filterComplex).toContain('overlay=')
    expect(mix.filterComplex).toContain('scale=')
    expect(mix.filterComplex).toContain(':-2')
    expect(mix.filterComplex).not.toMatch(/scale=\d+:-1[^\d]/)
    expect(mix.filterComplex).toContain('format=auto')
    expect(mix.inputs.some((i) => i.role === 'image' && i.args.includes('-loop'))).toBe(true)
    expect(mix.inputs.some((i) => i.role === 'bed' && i.path === '/tmp/se-bed.wav')).toBe(true)

    expect(mix.filterComplex).toContain('amix=inputs=2:duration=first:dropout_transition=0:normalize=0')
    expect(mix.filterComplex).toContain('adelay=delays=')
    expect(mix.filterComplex).not.toContain(':all=1')
    expect(mix.filterComplex).toContain('equalizer=f=120:width_type=q')
    expect(mix.filterComplex).toContain('loudnorm=I=-16')
    expect(mix.filterComplex).toContain("volume=0.60:enable='between(t,0.400,1.200)'")
    expect(mix.filterComplex).toContain('[aout]')
    expect(mix.filterComplex).toContain('[vout]')
    expect(mix.mapVideo).toBe('[vout]')
    expect(mix.mapAudio).toBe('[aout]')
    expect(mix.encodeVideo).toBe(true)
    expect(mix.encodeAudio).toBe(true)

    const voice = voiceAudioFilters(job).join(',')
    expect(voice.indexOf('loudnorm')).toBeLessThan(voice.indexOf('volume=0.60'))
    expect(voice.indexOf('equalizer')).toBeLessThan(voice.indexOf('loudnorm'))
  })

  test('speed ramps emit setpts + atempo; dissolves emit xfade', () => {
    const sped = applyCommand(fixtureProject(), { type: 'setSpeed', start: 0, end: 0.9, speed: 2 })
    const job = buildExportJob(sped, '/tmp/se-out.mp4')!
    const first = job.segments[0]
    const filters = buildSegmentFilters(job, first)
    expect(filters.vf).toContain('setpts=PTS/2.000')
    expect(filters.vf).toContain('format=yuv420p')
    expect(filters.af).toContain('atempo=2.000')
    expect(filters.af).toContain('sample_rates=48000')

    const dissolved = {
      ...job,
      segments: job.segments.map((s, i) => (i === 0 ? { ...s, overlapNext: 0.2, fadeOut: 0.2 } : s))
    }
    dissolved.segments[1] = { ...dissolved.segments[1], fadeIn: 0.2 }
    const join = buildJoinGraph(dissolved, dissolved.segments.length)
    expect(join?.filterComplex).toContain('xfade=transition=fade')
    expect(join?.filterComplex).toContain('acrossfade=d=0.200')
    expect(join?.mapVideo).toBe('[vout]')
    expect(join?.mapAudio).toBe('[aout]')
  })

  test('voice-only EQ uses -af and copies video (no bad [aout] map)', () => {
    const project = createEmptyProject('eq-only')
    const withSrc: Project = {
      ...project,
      sourceDuration: 2,
      assets: {
        src: {
          id: 'src',
          path: '/tmp/se-src.mp4',
          name: 'src.mp4',
          kind: 'video',
          duration: 2,
          waveform: []
        }
      },
      audioMaster: { ...project.audioMaster, eqLow: 3, duck: 0 }
    }
    const job = buildExportJob(withSrc, '/tmp/se-out.mp4')!
    const mix = buildMixGraph(job)
    expect(mix.filterComplex).toBe('')
    expect(mix.mapVideo).toBe('0:v')
    expect(mix.mapAudio).toBe('0:a?')
    expect(mix.simpleAudio).toContain('equalizer=f=120')
    expect(mix.encodeAudio).toBe(true)
    expect(mix.encodeVideo).toBe(false)
  })

  test('explainExportError tells a human what to do', () => {
    expect(explainExportError('cannot find a valid font for drawtext')).toMatch(/fonts-dejavu/)
    expect(explainExportError('Unknown encoder h264_nvenc')).toMatch(/x264/)
    expect(explainExportError('No such file or directory')).toMatch(/Re-link/)
    expect(explainExportError('width not divisible by 2')).toMatch(/even/)
  })
})

describe('lavfi smoke', () => {
  test('cut + bed + still encode on ffmpeg 4.4', async () => {
    const ffmpeg = Bun.which('ffmpeg')
    const ffprobe = Bun.which('ffprobe')
    if (!ffmpeg || !ffprobe) throw new Error('ffmpeg/ffprobe required for export smoke')

    await Bun.$`${ffmpeg} -y -f lavfi -i testsrc=size=320x240:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 2 -pix_fmt yuv420p /tmp/se-src.mp4`.quiet()
    await Bun.$`${ffmpeg} -y -f lavfi -i sine=frequency=220:sample_rate=48000 -t 2 /tmp/se-bed.wav`.quiet()
    await Bun.$`${ffmpeg} -y -f lavfi -i color=c=red:s=80x80 -frames:v 1 /tmp/se-still.png`.quiet()

    const { exportProgram, probe } = await import('../../../main/ffmpeg.ts')
    const job = buildExportJob(fixtureProject(), '/tmp/se-export-smoke.mp4')!
    job.encoder = 'libx264'
    job.normalize = false
    const stages: string[] = []
    await exportProgram(job, (info) => {
      stages.push(info.stage)
    })
    const info = await probe('/tmp/se-export-smoke.mp4')
    expect(info.hasVideo).toBe(true)
    expect(info.hasAudio).toBe(true)
    expect(info.duration).toBeGreaterThan(1.1)
    expect(info.duration).toBeLessThan(2.05)
    expect(stages.some((s) => /clip|mixing|bed|caption/i.test(s))).toBe(true)
  }, 60000)
})
