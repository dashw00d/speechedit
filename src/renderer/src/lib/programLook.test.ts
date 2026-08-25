import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createEmptyProject } from './demo'
import {
  buildJoinGraph,
  buildMixGraph,
  buildSegmentFilters,
  dissolveIn,
  drawtextX,
  drawtextY,
  explainGraphBuildError,
  ffmpegColor,
  programmedSegments,
  timedFade,
  validateExportJob
} from './exportGraph'
import {
  audioBeds,
  bedGainAt,
  buildExportJob,
  duckGainAt,
  programVolume,
  projectToExportJob,
  visibleGraphicClips
} from './exportJob'
import { duckAt, masterFadeAt, sampleProgram, segmentFadeAt, xfadeProgress } from './programLook'
import { resolveSegments, segmentsAtProgram } from './resolver'
import { DEFAULT_TRANSFORM, emptyClipFields, type Project } from '../types'

function fixtureProject(): Project {
  let p = createEmptyProject('parity-fixture')
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

function parityProject(): Project {
  let p = applyCommand(fixtureProject(), { type: 'setSpeed', start: 0, end: 0.9, speed: 2 })
  p = applyCommand(p, { type: 'dissolveAtPlayhead', duration: 0.18, time: 0.4 })
  p = applyCommand(p, {
    type: 'setCaptionStyleAll',
    style: { fill: '#ffcc00', stroke: '#110000', align: 'left', position: 'upper', fontSize: 28 }
  })
  return p
}

describe('preview / export job parity', () => {
  test('job segments, layers, beds, and duck match monitor/engine sampling', () => {
    const project = parityProject()
    const job = buildExportJob(project, '/tmp/se-parity.mp4')
    expect(job).toBeTruthy()
    const segs = resolveSegments(project)
    const laid = programmedSegments(job!)

    expect(laid.map((s) => Number(s.programStart.toFixed(4)))).toEqual(
      segs.map((s) => Number(s.start.toFixed(4)))
    )
    expect(job!.segments.map((s) => s.speed)).toEqual(segs.map((s) => s.speed))
    expect(job!.segments.map((s) => s.overlapNext)).toEqual(segs.map((s) => s.overlapNext))
    expect(job!.segments.some((s) => (s.overlapNext ?? 0) > 0.04)).toBe(true)
    expect(job!.segments[0].speed).toBe(2)
    expect(job!.duckWindows.some((w) => Math.abs(w.start - 0.4) < 1e-6 && Math.abs(w.end - 1.2) < 1e-6)).toBe(true)

    const caption = job!.layers.find((l) => l.kind === 'caption' && l.text === 'Never Shotcut')
    expect(caption?.fill).toBe('#ffcc00')
    expect(caption?.stroke).toBe('#110000')
    expect(caption?.align).toBe('left')
    expect(caption?.position).toBe('upper')
    expect(caption?.fontSize).toBe(28)

    const times = [0.05, 0.22, 0.42, 0.55, 0.7, 1.0]
    for (const t of times) {
      const look = sampleProgram(job!, t)
      const stack = segmentsAtProgram(project, t)
      expect(look.stack.length).toBe(stack.length)
      expect(look.incomingSource).toBeCloseTo(
        look.incoming
          ? look.incoming.start + (t - look.incoming.programStart) * look.incoming.speed
          : 0,
        5
      )

      const ducked = job!.duckWindows.some((w) => t >= w.start && t < w.end)
      expect(look.voice.ducked).toBe(ducked && (job!.duck ?? 0) > 0)
      expect(look.voice.ducked).toBe(programVolume(project, t).ducked)
      expect(duckGainAt(project, t)).toBeCloseTo(duckAt(job!, t), 5)

      const incoming = look.incoming
      const fade = look.incomingIndex >= 0 ? segmentFadeAt(job!, look.incomingIndex, t) : 1
      const duck = duckAt(job!, t)
      const master = masterFadeAt(job!, t)
      const inFull = job!.volume * (incoming?.volume ?? 1) * duck * master * fade
      const progress = look.outgoing ? xfadeProgress(job!, look.outgoingIndex, t) : 1
      const expectedVoice = look.outgoing
        ? inFull * progress +
          job!.volume *
            look.outgoing.volume *
            duck *
            master *
            segmentFadeAt(job!, look.outgoingIndex, t) *
            (1 - progress)
        : inFull
      expect(look.voice.gain).toBeCloseTo(expectedVoice, 5)
      expect(programVolume(project, t).gain).toBeCloseTo(look.voice.gain, 5)

      const capTexts = look.layers.filter((l) => l.layer.kind === 'caption').map((l) => l.layer.text)
      expect(capTexts).toEqual(visibleGraphicClips(project, t, 'caption').map((c) => c.text ?? ''))
      const overlayIds = look.layers
        .filter((l) => l.layer.kind === 'overlay' || l.layer.kind === 'image' || l.layer.kind === 'blur')
        .map((l) => l.layer.id)
        .sort()
      const previewIds = visibleGraphicClips(project, t, 'overlay').map((c) => c.id).sort()
      expect(overlayIds).toEqual(previewIds)

      for (const bed of audioBeds(project)) {
        const sampled = look.beds.find((b) => b.bed.id === bed.id)
        expect(sampled).toBeTruthy()
        expect(sampled!.gain).toBeCloseTo(bedGainAt(project, bed, t), 5)
        expect(sampled!.gain).toBeCloseTo(
          job!.volume * bed.volume * timedFade(t - bed.start, bed.duration, bed.fadeIn, bed.fadeOut),
          5
        )
      }
    }
  })

  test('xfade offsets and bake-fades match the job dissolve', () => {
    const job = buildExportJob(parityProject(), '/tmp/se-parity.mp4')!
    const laid = programmedSegments(job)
    const overlap = job.segments[0].overlapNext ?? 0
    expect(overlap).toBeGreaterThan(0.04)
    expect(dissolveIn(job, 1)).toBeCloseTo(overlap, 5)

    const join = buildJoinGraph(job, job.segments.length)
    expect(join?.filterComplex).toContain('xfade=transition=fade')
    expect(join?.filterComplex).toContain(`offset=${laid[1].programStart.toFixed(3)}`)
    expect(join?.filterComplex).toContain(`acrossfade=d=${overlap.toFixed(3)}`)

    const mid = laid[1].programStart + overlap / 2
    const look = sampleProgram(job, mid)
    expect(look.stack.length).toBe(2)
    expect(look.dissolveProgress).toBeCloseTo(0.5, 1)
    expect(look.incomingOpacity + look.outgoingOpacity).toBeCloseTo(1, 1)
    expect(look.voice.incomingGain + look.voice.outgoingGain).toBeCloseTo(look.voice.gain, 5)

    const first = buildSegmentFilters(job, job.segments[0], 0)
    const second = buildSegmentFilters(job, job.segments[1], 1)
    expect(first.vf).toContain('setpts=PTS/2.000')
    expect(first.af).toContain('atempo=2.000')
    expect(first.vf).not.toContain('fade=t=out')
    expect(second.vf).not.toContain('fade=t=in')
  })

  test('caption style rides into drawtext; muted b-roll does not duck', () => {
    const project = parityProject()
    const job = buildExportJob(project, '/tmp/se-parity.mp4')!
    const mix = buildMixGraph(job, { fontFile: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' })
    expect(mix.filterComplex).toContain('fontcolor=0xFFCC00')
    expect(mix.filterComplex).toContain('bordercolor=0x110000')
    const caption = job.layers.find((l) => l.kind === 'caption')!
    expect(drawtextX(caption, job)).toBe(String(Math.round(job.width * 0.08 + caption.x)))
    expect(drawtextY(caption, job)).toBe(String(Math.round(job.height * 0.1 + caption.y)))
    expect(ffmpegColor('#f4e', 'white')).toBe('0xFF44EE')

    const muted = {
      ...project,
      tracks: project.tracks.map((t) =>
        t.type === 'overlay'
          ? {
              ...t,
              clips: t.clips.map((c) => (c.assetId === 'still1' ? { ...c, muted: true } : c))
            }
          : t
      )
    }
    const mutedJob = projectToExportJob(muted)
    expect(mutedJob.duckWindows.some((w) => w.start === 0.4)).toBe(false)
    expect(sampleProgram(mutedJob, 0.7).voice.ducked).toBe(false)
  })

  test('validateExportJob and graph-build errors tell a human what to do', () => {
    const job = buildExportJob(fixtureProject(), '/tmp/se-out.mp4')!
    expect(validateExportJob(job)).toBeNull()
    expect(validateExportJob({ ...job, segments: [] })).toMatch(/empty/)
    expect(validateExportJob({ ...job, beds: [{ ...job.beds![0], path: '' }] })).toMatch(/Relink the bed/)
    expect(validateExportJob({ ...job, segments: [{ ...job.segments[0], speed: 12 }] })).toMatch(/0\.25× and 8×/)
    expect(validateExportJob(job, { fontFile: undefined })).toMatch(/fonts-dejavu/)
    expect(explainGraphBuildError(new Error('cannot find a valid font'))).toMatch(/fonts-dejavu/)
    expect(explainGraphBuildError(new Error('xfade duration longer than clip'))).toMatch(/dissolve|clip|bed/i)
  })

  test('overlay video speed lands on the mix graph', () => {
    const withVideo = applyCommand(fixtureProject(), {
      type: 'addBroll',
      start: 0.1,
      duration: 0.5,
      asset: {
        id: 'clipv',
        path: '/tmp/se-broll.mp4',
        name: 'broll.mp4',
        kind: 'video',
        duration: 2,
        waveform: []
      }
    })
    const sped: Project = {
      ...withVideo,
      tracks: withVideo.tracks.map((t) =>
        t.type === 'overlay'
          ? {
              ...t,
              clips: t.clips.map((c) =>
                c.assetId === 'clipv' ? { ...c, speed: 2, ...emptyClipFields(), transform: { ...DEFAULT_TRANSFORM } } : c
              )
            }
          : t
      )
    }
    const job = buildExportJob(sped, '/tmp/se-out.mp4')!
    const layer = job.layers.find((l) => l.path === '/tmp/se-broll.mp4')
    expect(layer?.speed).toBe(2)
    expect(layer?.loop).toBe(false)
    const mix = buildMixGraph(job)
    expect(mix.filterComplex).toContain('setpts=(PTS-STARTPTS)/2.000')
    expect(mix.inputs.some((i) => i.path === '/tmp/se-broll.mp4' && i.args.includes('-t'))).toBe(true)
  })
})

