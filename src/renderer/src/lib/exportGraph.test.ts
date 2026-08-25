import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createEmptyProject } from './demo'
import {
  buildJoinGraph,
  buildMixGraph,
  buildProgramGraph,
  buildSegmentFilters,
  encoderFallback,
  explainExportError,
  explainGraphBuildError,
  programReadArgs,
  programmedSegments,
  summarizeJob,
  takeInputCount,
  validateExportJob,
  voiceAudioFilters
} from './exportGraph'
import { buildExportJob, duckGainAt, programVolume, projectToExportJob, visibleGraphicClips } from './exportJob'
import { bedGain, duckAt, sampleProgram } from './programLook'
import { resolveSegments } from './resolver'
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
    expect(filters.vf).toContain(`trim=start=${first.start.toFixed(3)}:end=${first.end.toFixed(3)}`)
    expect(filters.vf).toContain('setpts=PTS/2.000')
    expect(filters.vf).toContain('format=yuv420p')
    expect(filters.af).toContain(`atrim=start=${first.start.toFixed(3)}:end=${first.end.toFixed(3)}`)
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

    const mixed = {
      ...dissolved,
      segments: [
        ...dissolved.segments,
        { ...dissolved.segments[1], start: 1.8, end: 2.0, overlapNext: 0, programStart: 1.2 }
      ]
    }
    const mixedJoin = buildJoinGraph(mixed, mixed.segments.length)
    expect(mixedJoin?.filterComplex).toContain('concat=n=2:v=1:a=0')
    expect(mixedJoin?.filterComplex).toContain('concat=n=2:v=0:a=1')
    expect(mixedJoin?.filterComplex).not.toContain('concat=n=2:v=1:a=1')
  })

  test('dissolve then a hard cut keeps video and audio on separate concat chains', () => {
    const job = buildExportJob(parityProject(), '/tmp/se-out.mp4')!
    expect(job.segments.length).toBeGreaterThan(2)
    expect(job.segments.some((s) => (s.overlapNext ?? 0) > 0.04)).toBe(true)
    const join = buildJoinGraph(job, job.segments.length)
    expect(join?.filterComplex).toContain('xfade=transition=fade')
    expect(join?.filterComplex).toContain('acrossfade=')
    expect(join?.filterComplex).toContain('concat=n=2:v=1:a=0')
    expect(join?.filterComplex).toContain('concat=n=2:v=0:a=1')
    expect(join?.filterComplex).not.toContain('concat=n=2:v=1:a=1')
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
    expect(explainGraphBuildError(new Error('Video map label is missing from the filter graph.'))).toMatch(
      /export graph/
    )
    expect(encoderFallback('h264_nvenc', explainExportError('Unknown encoder h264_nvenc'))).toBe('libx264')
    expect(encoderFallback('libx264', explainExportError('Unknown encoder h264_nvenc'))).toBeNull()
    expect(encoderFallback('h264_nvenc', 'A media file is missing. Re-link the recording.')).toBeNull()
  })

  test('program graph encodes every keep once, not once per cut', () => {
    const job = buildExportJob(fixtureProject(), '/tmp/se-out.mp4')!
    const program = buildProgramGraph(job)
    expect(program.encodes).toBe(1)
    expect(program.filterComplex.match(/\[0:v\]/g)?.length).toBe(job.segments.length)
    expect(program.filterComplex).toContain(`concat=n=${job.segments.length}:v=1:a=0`)
    expect(program.filterComplex).toContain(`concat=n=${job.segments.length}:v=0:a=1`)
    expect(program.mapVideo).toBe('[vout]')
    expect(program.mapAudio).toBe('[aout]')
    const first = job.segments[0]
    expect(program.filterComplex).toContain(`trim=start=${first.start.toFixed(3)}:end=${first.end.toFixed(3)}`)
  })

  test('program graph folds captions, stills, and beds into the same encode', () => {
    const job = buildExportJob(fixtureProject(), '/tmp/se-out.mp4')!
    const program = buildProgramGraph(job, {
      fontFile: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    })
    expect(program.encodes).toBe(1)
    expect(takeInputCount(job)).toBe(1)
    expect(program.filterComplex).toContain("drawtext=text='Never Shotcut'")
    expect(program.filterComplex).toContain('fontfile=')
    expect(program.filterComplex).toContain('amix=inputs=2:duration=first:dropout_transition=0:normalize=0')
    expect(program.filterComplex).toContain('[vprog]')
    expect(program.filterComplex).toContain('[aprog]')
    expect(program.filterComplex).toContain('[1:v]')
    expect(program.filterComplex).toContain('[2:a]')
    expect(program.extraInputs.some((input) => input.role === 'image' && input.path === '/tmp/se-still.png')).toBe(
      true
    )
    expect(program.extraInputs.some((input) => input.role === 'bed' && input.path === '/tmp/se-bed.wav')).toBe(true)
    const args = programReadArgs(job, program.extraInputs)
    expect(args.filter((arg) => arg === '-i')).toHaveLength(1 + program.extraInputs.length)
    expect(args).toContain('/tmp/se-src.mp4')
    expect(args).toContain('/tmp/se-still.png')
    expect(args).toContain('/tmp/se-bed.wav')
    expect(program.notes.join(' ')).toMatch(/caption/)
    expect(program.notes.join(' ')).toMatch(/bed/)
  })

  test('voice-only EQ rides the program graph instead of a second -af pass', () => {
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
    const program = buildProgramGraph(job)
    expect(program.encodes).toBe(1)
    expect(program.extraInputs).toEqual([])
    expect(program.filterComplex).toContain('equalizer=f=120')
    expect(program.filterComplex).toContain('[vprog]')
    expect(program.mapVideo).toBe('[vprog]')
    expect(program.mapAudio).toBe('[aout]')
  })

  test('program graph keeps dissolves on labeled pads in the same encode', () => {
    const job = buildExportJob(fixtureProject(), '/tmp/se-out.mp4')!
    job.segments[0] = { ...job.segments[0], overlapNext: 0.2, fadeOut: 0.2 }
    job.segments[1] = { ...job.segments[1], fadeIn: 0.2 }
    const program = buildProgramGraph(job)
    expect(program.encodes).toBe(1)
    expect(program.filterComplex).toContain('[v0][v1]xfade=transition=fade')
    expect(program.filterComplex).toContain('[a0][a1]acrossfade=')
    expect(program.filterComplex).not.toContain('[0:v][1:v]xfade')
  })

  test('lifted holds render as black + silence pads', () => {
    const project = applyCommand(fixtureProject(), { type: 'insertGap', time: 0.4, duration: 0.5 })
    const job = projectToExportJob(project, '/tmp/se-out.mp4')
    expect(job.segments.some((seg) => seg.kind === 'slug')).toBe(true)
    const program = buildProgramGraph(job)
    expect(program.filterComplex).toContain('color=c=black')
    expect(program.filterComplex).toContain('anullsrc=')
    const look = sampleProgram(job, 0.55)
    expect(look.incoming?.kind).toBe('slug')
    expect(look.incomingOpacity).toBe(0)
    expect(look.voice.incomingGain).toBe(0)
  })
})

function parityProject(): Project {
  let p = applyCommand(fixtureProject(), { type: 'setSpeed', start: 0, end: 0.9, speed: 2 })
  p = applyCommand(p, {
    type: 'setCaptionStyleAll',
    style: { fill: '#ffcc00', stroke: '#111111', position: 'upper', align: 'left', fontSize: 28 }
  })
  p = applyCommand(p, { type: 'dissolveAtPlayhead', duration: 0.18, time: 0.4 })
  return p
}

describe('playback / export parity', () => {
  test('job segments match resolveSegments; sampleProgram matches duck, beds, layers, speed', () => {
    const project = parityProject()
    const job = projectToExportJob(project, '/tmp/se-out.mp4')
    const segs = resolveSegments(project)
    expect(job.segments).toHaveLength(segs.length)
    segs.forEach((seg, i) => {
      expect(job.segments[i].start).toBeCloseTo(seg.inPoint, 5)
      expect(job.segments[i].end).toBeCloseTo(seg.outPoint, 5)
      expect(job.segments[i].speed).toBe(seg.speed)
      expect(job.segments[i].volume).toBe(seg.volume)
      expect(job.segments[i].fadeIn).toBe(seg.fadeIn)
      expect(job.segments[i].fadeOut).toBe(seg.fadeOut)
      expect(job.segments[i].overlapNext).toBe(seg.overlapNext)
      expect(job.segments[i].programStart).toBeCloseTo(seg.start, 5)
    })
    expect(programmedSegments(job)[0].programStart).toBeCloseTo(job.segments[0].programStart ?? 0, 5)

    const times = [0.05, 0.35, 0.7, 1.1]
    for (const t of times) {
      const look = sampleProgram(job, t)
      const duck = duckAt(job, t)
      expect(look.voice.ducked).toBe(duck < 0.999)
      expect(look.voice.duckAmount).toBe(job.duck)
      expect(duckGainAt(project, t)).toBeCloseTo(duck, 5)

      const incoming = look.incoming
      if (incoming) {
        const local = t - incoming.programStart
        expect(look.incomingSource).toBeCloseTo(incoming.start + local * incoming.speed, 5)
        expect(look.incomingSpeed).toBe(incoming.speed)
      }

      for (const bed of job.beds ?? []) {
        const sampled = look.beds.find((b) => b.bed.path === bed.path)
        expect(sampled).toBeTruthy()
        expect(sampled!.gain).toBeCloseTo(bedGain(job, bed, t), 5)
      }

      for (const layer of job.layers) {
        const visible = t >= layer.start && t < layer.end
        const sampled = look.layers.find((l) => l.layer.id === layer.id)
        if (visible) {
          expect(sampled).toBeTruthy()
          expect(sampled!.layer.fill).toBe(layer.fill)
          expect(sampled!.layer.position).toBe(layer.position)
          expect(sampled!.layer.align).toBe(layer.align)
          expect(sampled!.opacity).toBeCloseTo((layer.opacity ?? 1) * sampled!.fade, 5)
        } else {
          expect(sampled).toBeUndefined()
        }
      }
    }
  })

  test('dissolve opacities follow the xfade envelope the renderer emits', () => {
    const job = projectToExportJob(parityProject(), '/tmp/se-out.mp4')
    const overlap = job.segments.find((s) => (s.overlapNext ?? 0) > 0.04)?.overlapNext ?? 0
    expect(overlap).toBeGreaterThan(0.04)
    const incoming = programmedSegments(job).find((s, i) => i > 0 && (job.segments[i - 1].overlapNext ?? 0) > 0.04)
    expect(incoming).toBeTruthy()
    const mid = incoming!.programStart + overlap / 2
    const look = sampleProgram(job, mid)
    expect(look.outgoing).toBeTruthy()
    expect(look.incomingOpacity).toBeCloseTo(0.5, 1)
    expect(look.outgoingOpacity).toBeCloseTo(0.5, 1)
    const join = buildJoinGraph(job, job.segments.length)
    expect(join?.filterComplex).toContain('xfade=transition=fade')
    expect(join?.filterComplex).toContain(`acrossfade=d=${overlap.toFixed(3)}`)
  })

  test('caption style and overlay speed ride the same job fields as lavfi', () => {
    const job = projectToExportJob(parityProject(), '/tmp/se-out.mp4')
    const cap = job.layers.find((l) => l.kind === 'caption')
    expect(cap?.fill).toBe('#ffcc00')
    expect(cap?.stroke).toBe('#111111')
    expect(cap?.position).toBe('upper')
    expect(cap?.align).toBe('left')
    expect(cap?.fontSize).toBe(28)
    const mix = buildMixGraph(job, { fontFile: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' })
    expect(mix.filterComplex).toContain('fontcolor=0xFFCC00')
    expect(mix.filterComplex).toContain('bordercolor=0x111111')
    expect(job.segments.some((s) => s.speed === 2)).toBe(true)
    const fast = job.segments.find((s) => s.speed === 2)!
    const filters = buildSegmentFilters(job, fast, job.segments.indexOf(fast))
    expect(filters.vf).toContain('setpts=PTS/2.000')
    expect(filters.af).toContain('atempo=2.000')
  })

  test('validateExportJob names the missing bed or empty timeline', () => {
    const job = projectToExportJob(parityProject(), '/tmp/se-out.mp4')
    expect(validateExportJob(job)).toBeNull()
    expect(validateExportJob({ ...job, segments: [] })).toMatch(/empty/)
    expect(validateExportJob({ ...job, beds: [{ ...(job.beds ?? [])[0], path: '' }] })).toMatch(/bed/)
    expect(validateExportJob({ ...job, segments: [{ ...job.segments[0], speed: 0 }] })).toMatch(/speed|0/)
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
    expect(stages.some((s) => /encoding program/.test(s))).toBe(true)
    expect(stages.some((s) => /caption|bed|still/i.test(s))).toBe(true)
    expect(stages.some((s) => /^mixing /.test(s))).toBe(false)
    expect(stages.some((s) => /encoding clip \d+\//i.test(s))).toBe(false)
  }, 60000)

  test('dissolve + speed + caption + duck encode and probe', async () => {
    const ffmpeg = Bun.which('ffmpeg')
    const ffprobe = Bun.which('ffprobe')
    if (!ffmpeg || !ffprobe) throw new Error('ffmpeg/ffprobe required for export smoke')

    await Bun.$`${ffmpeg} -y -f lavfi -i testsrc=size=320x240:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 2 -pix_fmt yuv420p /tmp/se-src.mp4`.quiet()
    await Bun.$`${ffmpeg} -y -f lavfi -i sine=frequency=220:sample_rate=48000 -t 2 /tmp/se-bed.wav`.quiet()
    await Bun.$`${ffmpeg} -y -f lavfi -i color=c=red:s=80x80 -frames:v 1 /tmp/se-still.png`.quiet()

    const { exportProgram, probe } = await import('../../../main/ffmpeg.ts')
    const job = buildExportJob(parityProject(), '/tmp/se-parity-smoke.mp4')!
    job.encoder = 'libx264'
    job.normalize = false
    expect(job.segments.some((s) => (s.overlapNext ?? 0) > 0.04)).toBe(true)
    expect(job.segments.some((s) => s.speed === 2)).toBe(true)
    expect(job.layers.some((l) => l.kind === 'caption' && l.fill === '#ffcc00')).toBe(true)
    expect(job.duckWindows.length).toBeGreaterThan(0)
    const stages: string[] = []
    await exportProgram(job, (info) => {
      stages.push(info.stage)
    })
    const info = await probe('/tmp/se-parity-smoke.mp4')
    expect(info.hasVideo).toBe(true)
    expect(info.hasAudio).toBe(true)
    expect(info.duration).toBeGreaterThan(0.6)
    expect(info.duration).toBeLessThan(2.2)
    expect(stages.some((s) => /encoding program/.test(s))).toBe(true)
    expect(stages.some((s) => /caption|duck/i.test(s))).toBe(true)
    expect(stages.some((s) => /^mixing /.test(s))).toBe(false)
    expect(stages.some((s) => /encoding clip \d+\//i.test(s))).toBe(false)
  }, 60000)

  test('importRecording + applyCommand + exportProgram writes a program', async () => {
    const ffmpeg = Bun.which('ffmpeg')
    const ffprobe = Bun.which('ffprobe')
    if (!ffmpeg || !ffprobe) throw new Error('ffmpeg/ffprobe required for export smoke')

    await Bun.$`${ffmpeg} -y -f lavfi -i testsrc=size=320x240:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 2 -pix_fmt yuv420p /tmp/se-src.mp4`.quiet()
    await Bun.$`${ffmpeg} -y -f lavfi -i sine=frequency=220:sample_rate=48000 -t 2 /tmp/se-bed.wav`.quiet()
    await Bun.$`${ffmpeg} -y -f lavfi -i color=c=red:s=80x80 -frames:v 1 /tmp/se-still.png`.quiet()

    const { exportProgram, probe, waveform, thumbnails, detectSilence, detectScenes, detectLoudness } =
      await import('../../../main/ffmpeg.ts')
    const { host } = await import('../host.ts')
    const { importRecording } = await import('./importMedia.ts')

    const prev = {
      probe: host.probe,
      waveform: host.waveform,
      thumbnails: host.thumbnails,
      silence: host.silence,
      scenes: host.scenes,
      loudness: host.loudness,
      analyze: host.analyze,
      transcribe: host.transcribe
    }
    host.probe = probe
    host.waveform = (file) => waveform(file)
    host.thumbnails = (file) => thumbnails(file)
    host.silence = detectSilence
    host.scenes = detectScenes
    host.loudness = detectLoudness
    host.analyze = async (file) => ({
      silence: await detectSilence(file),
      scenes: await detectScenes(file),
      loudness: await detectLoudness(file)
    })
    host.transcribe = async () => null

    let project
    try {
      project = await importRecording('/tmp/se-src.mp4')
    } finally {
      Object.assign(host, prev)
    }
    if (!project) throw new Error('importRecording returned nothing')
    expect(Object.values(project.assets)[0]?.path).toBe('/tmp/se-src.mp4')
    expect(project.sourceDuration).toBeGreaterThan(1.5)

    project = applyCommand(project, { type: 'deleteRange', start: 1.0, end: 1.4, source: 'manual' })
    project = applyCommand(project, {
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
    project = applyCommand(project, {
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
    project = applyCommand(project, { type: 'addCaption', start: 0.1, duration: 1.2, text: 'Never Shotcut' })

    const job = buildExportJob(project, '/tmp/se-import-export.mp4')!
    job.encoder = 'libx264'
    job.normalize = false
    await exportProgram(job)
    const info = await probe('/tmp/se-import-export.mp4')
    expect(info.hasVideo).toBe(true)
    expect(info.hasAudio).toBe(true)
    expect(info.duration).toBeGreaterThan(1.1)
    expect(info.duration).toBeLessThan(2.05)
  }, 90000)

  test('dropped Whisper JSON → setTranscript → filler cut → export', async () => {
    const ffmpeg = Bun.which('ffmpeg')
    const ffprobe = Bun.which('ffprobe')
    if (!ffmpeg || !ffprobe) throw new Error('ffmpeg/ffprobe required for export smoke')

    await Bun.$`${ffmpeg} -y -f lavfi -i testsrc=size=320x240:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 2 -pix_fmt yuv420p /tmp/se-src.mp4`.quiet()

    const { exportProgram, probe } = await import('../../../main/ffmpeg.ts')
    const { parseAnyTranscript } = await import('./transcript.ts')
    const whisper = await Bun.file(new URL('../../../../samples/whisper.json', import.meta.url)).text()
    let project = createEmptyProject('whisper-drop')
    project = {
      ...project,
      sourceDuration: 2,
      width: 320,
      height: 240,
      fps: 30,
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
    project = applyCommand(project, { type: 'setTranscript', words: parseAnyTranscript('whisper.json', whisper) })
    expect(project.transcript.words.map((w) => w.text)).toEqual(['Hello', 'there', 'um', 'world'])
    const filler = project.suggestions.find((s) => s.type === 'filler')
    expect(filler).toBeTruthy()
    project = applyCommand(project, { type: 'applySuggestion', suggestionId: filler!.id })
    expect(project.transcript.words.find((w) => w.text === 'um')?.deleted).toBe(true)

    const job = buildExportJob(project, '/tmp/se-whisper-drop.mp4')!
    job.encoder = 'libx264'
    job.normalize = false
    await exportProgram(job)
    const info = await probe('/tmp/se-whisper-drop.mp4')
    expect(info.hasVideo).toBe(true)
    expect(info.hasAudio).toBe(true)
    expect(info.duration).toBeGreaterThan(1.4)
    expect(info.duration).toBeLessThan(2.05)
  }, 90000)

  test('many Auto-Edit holes encode in one program pass', async () => {
    const ffmpeg = Bun.which('ffmpeg')
    const ffprobe = Bun.which('ffprobe')
    if (!ffmpeg || !ffprobe) throw new Error('ffmpeg/ffprobe required for multi-cut smoke')

    await Bun.$`${ffmpeg} -y -f lavfi -i testsrc=size=320x240:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 4 -pix_fmt yuv420p /tmp/se-many-cuts.mp4`.quiet()
    let project = createEmptyProject('many-cuts')
    project = {
      ...project,
      sourceDuration: 4,
      width: 320,
      height: 240,
      fps: 30,
      assets: {
        src: {
          id: 'src',
          path: '/tmp/se-many-cuts.mp4',
          name: 'many.mp4',
          kind: 'video',
          duration: 4,
          waveform: []
        }
      }
    }
    for (const [start, end] of [
      [0.4, 0.5],
      [1.0, 1.1],
      [1.6, 1.7],
      [2.2, 2.3],
      [2.8, 2.9]
    ] as const) {
      project = applyCommand(project, { type: 'deleteRange', start, end, source: 'auto' })
    }
    const job = buildExportJob(project, '/tmp/se-many-cuts-out.mp4')!
    expect(job.segments.length).toBeGreaterThanOrEqual(6)
    expect(buildProgramGraph(job).encodes).toBe(1)
    job.encoder = 'libx264'
    job.normalize = false
    const stages: string[] = []
    const { exportProgram, probe } = await import('../../../main/ffmpeg.ts')
    await exportProgram(job, (info) => stages.push(info.stage))
    const info = await probe('/tmp/se-many-cuts-out.mp4')
    expect(info.hasVideo).toBe(true)
    expect(info.duration).toBeGreaterThan(3.2)
    expect(info.duration).toBeLessThan(3.8)
    expect(stages.some((s) => /encoding program \(6 keeps\)/.test(s))).toBe(true)
    expect(stages.filter((s) => /encoding program/.test(s)).length).toBeGreaterThan(0)
    expect(stages.some((s) => /encoding clip \d+\//.test(s))).toBe(false)
  }, 90000)
})
