import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createEmptyProject } from './demo'
import { projectToExportJob } from './exportJob'
import { sampleProgram } from './programLook'
import { programLengthOf, programToSourceOf, resolveProgram, sourceInHole, sourceToProgramOf } from './resolver'
import {
  advancePlayhead,
  boundPlayhead,
  mediaJumped,
  readMediaClock,
  seekSlop,
  shouldHardSeek,
  shouldSeek,
  shouldSetMediaTime,
  sourceDiscontinuity,
  stepProgramPlayback
} from './seek'

describe('paused seek vs playback slop', () => {
  test('paused scrub snaps within one frame; play allows decoder drift', () => {
    expect(seekSlop(false, 30)).toBeCloseTo(1 / 30, 6)
    expect(seekSlop(true, 30)).toBe(0.16)
    expect(shouldSeek(1.0, 1.04, false, 30)).toBe(true)
    expect(shouldSeek(1.0, 1.02, false, 30)).toBe(false)
    expect(shouldSeek(1.0, 1.04, true, 30)).toBe(false)
    expect(shouldSeek(1.0, 1.2, true, 30)).toBe(true)
  })

  test('a short cut or loop is a jump, continuous play is not', () => {
    expect(mediaJumped(5.0, 5.1, 0.016, 1, 30)).toBe(true)
    expect(mediaJumped(5.0, 5.016, 0.016, 1, 30)).toBe(false)
    expect(mediaJumped(5.0, 5.032, 0.016, 2, 30)).toBe(false)
    expect(mediaJumped(1.2, 0.4, 0.016, 1, 30)).toBe(true)
  })

  test('an in-flight decoder seek is never retargeted every animation frame', () => {
    expect(
      shouldSetMediaTime({
        current: 1,
        desired: 1.6,
        seeking: true,
        readyState: 4,
        playing: true,
        hard: true,
        fps: 30
      })
    ).toBe(false)
    expect(
      shouldSetMediaTime({
        current: 1,
        desired: 1.6,
        seeking: false,
        readyState: 4,
        playing: true,
        hard: true,
        fps: 30
      })
    ).toBe(true)
  })

  test('a 100ms source cut jumps incoming source across the play slop', () => {
    const project = applyCommand(
      {
        ...createEmptyProject('cut'),
        sourceDuration: 4,
        assets: {
          src: {
            id: 'src',
            path: '/tmp/take.mp4',
            name: 'take.mp4',
            kind: 'video',
            duration: 4,
            waveform: []
          }
        }
      },
      { type: 'deleteRange', start: 1, end: 1.1 }
    )
    const job = projectToExportJob(project)
    const before = sampleProgram(job, sourceToProgramOf(project, 0.99))
    const after = sampleProgram(job, sourceToProgramOf(project, 1.11))
    expect(after.incomingSource).toBeGreaterThan(before.incomingSource + 0.05)
    expect(mediaJumped(before.incomingSource, after.incomingSource, 1 / 30, 1, 30)).toBe(true)
    expect(shouldSeek(before.incomingSource, after.incomingSource, true, 30)).toBe(false)
  })
})

function videoAssetProject() {
  return applyCommand(
    {
      ...createEmptyProject('clock'),
      sourceDuration: 4,
      assets: {
        src: {
          id: 'src',
          path: '/tmp/take.mp4',
          name: 'take.mp4',
          kind: 'video',
          duration: 4,
          waveform: []
        }
      }
    },
    { type: 'deleteRange', start: 1, end: 1.1 }
  )
}

describe('program time follows the media clock', () => {
  test('stall holds the playhead; wall-clock would have drifted', () => {
    const identity = (t: number) => t
    const stalled = advancePlayhead({
      lastProgram: 1,
      requestedProgram: 1,
      dt: 0.05,
      mediaSource: 1,
      mediaPresent: true,
      sourceToProgram: identity
    })
    expect(stalled.clock).toBe('media')
    expect(stalled.program).toBe(1)
    const wall = advancePlayhead({
      lastProgram: 1,
      requestedProgram: 1,
      dt: 0.05,
      mediaSource: null,
      mediaPresent: false,
      sourceToProgram: identity
    })
    expect(wall.clock).toBe('wall')
    expect(wall.program).toBeCloseTo(1.05, 6)
  })

  test('seeking or unready picture holds; missing src uses wall', () => {
    const identity = (t: number) => t
    const hold = advancePlayhead({
      lastProgram: 2.4,
      requestedProgram: 2.4,
      dt: 0.016,
      mediaSource: null,
      mediaPresent: true,
      sourceToProgram: identity
    })
    expect(hold).toEqual({ program: 2.4, clock: 'hold' })
    expect(readMediaClock({ src: 'media://clip', currentTime: 2.4, seeking: true, readyState: 4 })).toEqual({
      source: null,
      present: true
    })
    expect(readMediaClock({ src: 'media://clip', currentTime: 2.4, seeking: false, readyState: 1 })).toEqual({
      source: null,
      present: true
    })
    expect(readMediaClock({ src: 'media://clip', currentTime: 2.41, seeking: false, readyState: 4 })).toEqual({
      source: 2.41,
      present: true
    })
    expect(readMediaClock({ src: '', currentTime: 0, seeking: false, readyState: 0 })).toEqual({
      source: null,
      present: false
    })
  })

  test('play-from-here or loop is a jump even if the decoder is still on the old frame', () => {
    const jumped = advancePlayhead({
      lastProgram: 10,
      requestedProgram: 2,
      dt: 0.016,
      mediaSource: 10,
      mediaPresent: true,
      sourceToProgram: (t) => t
    })
    expect(jumped).toEqual({ program: 2, clock: 'jump' })
  })

  test('source in a keep maps to program; source in a hole lands on the next keep', () => {
    const project = videoAssetProject()
    expect(sourceToProgramOf(project, 0.5)).toBeCloseTo(0.5, 5)
    expect(sourceToProgramOf(project, 0.99)).toBeCloseTo(0.99, 5)
    const hole = sourceToProgramOf(project, 1.05)
    const after = sourceToProgramOf(project, 1.11)
    expect(hole).toBeCloseTo(1, 5)
    expect(after).toBeCloseTo(1.01, 5)
    const followed = advancePlayhead({
      lastProgram: 0.99,
      requestedProgram: 0.99,
      dt: 0.016,
      mediaSource: 1.05,
      mediaPresent: true,
      sourceToProgram: (source) => sourceToProgramOf(project, source)
    })
    expect(followed.clock).toBe('media')
    expect(followed.program).toBeCloseTo(1, 5)
  })

  test('a stalled decoder is not a hard seek; a 100ms cut is', () => {
    expect(sourceDiscontinuity(5, 5, 0.05, 1, 30)).toBe(false)
    expect(sourceDiscontinuity(5, 5.016, 0.016, 1, 30)).toBe(false)
    expect(sourceDiscontinuity(5, 5.032, 0.016, 2, 30)).toBe(false)
    expect(sourceDiscontinuity(0.99, 1.11, 0.016, 1, 30)).toBe(true)
    expect(sourceDiscontinuity(1.2, 0.4, 0.016, 1, 30)).toBe(true)
    expect(
      shouldHardSeek({
        lastSource: 5,
        nextSource: 5,
        dt: 0.05,
        speed: 1,
        fps: 30,
        clock: 'media',
        looped: false,
        cut: false
      })
    ).toBe(false)
    expect(
      shouldHardSeek({
        lastSource: 0.99,
        nextSource: 1.11,
        dt: 0.016,
        speed: 1,
        fps: 30,
        clock: 'media',
        looped: false,
        cut: false
      })
    ).toBe(true)
  })

  test('play-until, I/O loop, and program end bound the playhead', () => {
    expect(
      boundPlayhead(3.2, {
        duration: 10,
        playUntil: 3.1,
        loopFrom: null,
        loop: false,
        markIn: null,
        markOut: null
      })
    ).toEqual({ program: 3.1, looped: false, stop: true })
    expect(
      boundPlayhead(3.2, {
        duration: 10,
        playUntil: 3.1,
        loopFrom: 1,
        loop: false,
        markIn: null,
        markOut: null
      })
    ).toEqual({ program: 1, looped: true, stop: false })
    expect(
      boundPlayhead(5, {
        duration: 10,
        playUntil: null,
        loopFrom: null,
        loop: true,
        markIn: 1,
        markOut: 4
      })
    ).toEqual({ program: 1, looped: true, stop: false })
    expect(
      boundPlayhead(10, {
        duration: 8,
        playUntil: null,
        loopFrom: null,
        loop: false,
        markIn: null,
        markOut: null
      })
    ).toEqual({ program: 8, looped: false, stop: true })
  })
})

describe('program-master playback across cuts', () => {
  test('a decoder sitting in a hole does not stall the playhead', () => {
    const project = videoAssetProject()
    const resolved = resolveProgram(project)
    expect(sourceInHole(project, 1.05)).toBe(true)
    expect(sourceInHole(project, 0.99)).toBe(false)
    expect(sourceInHole(project, 1.11)).toBe(false)
    const stepped = stepProgramPlayback({
      lastProgram: 0.99,
      requestedProgram: 0.99,
      dt: 0.016,
      mediaSource: 1.05,
      resolved,
      fps: 30
    })
    expect(stepped.clock).toBe('wall')
    expect(stepped.hard).toBe(true)
    expect(stepped.program).toBeCloseTo(1.006, 5)
    expect(sourceInHole(project, programToSourceOf(project, stepped.program))).toBe(false)
  })

  test('media inside a keep may nudge the playhead but not jump it', () => {
    const project = videoAssetProject()
    const resolved = resolveProgram(project)
    const tracked = stepProgramPlayback({
      lastProgram: 0.5,
      requestedProgram: 0.5,
      dt: 0.016,
      mediaSource: 0.516,
      resolved,
      fps: 30
    })
    expect(tracked.clock).toBe('media')
    expect(tracked.hard).toBe(false)
    expect(tracked.program).toBeCloseTo(0.516, 5)
    const drifted = stepProgramPlayback({
      lastProgram: 0.5,
      requestedProgram: 0.5,
      dt: 0.016,
      mediaSource: 0.9,
      resolved,
      fps: 30
    })
    expect(drifted.clock).toBe('wall')
    expect(drifted.hard).toBe(true)
    expect(drifted.program).toBeCloseTo(0.516, 5)
  })

  test('holds one post-cut target while Chromium completes the audio/video seek', () => {
    const project = videoAssetProject()
    const resolved = resolveProgram(project)
    const crossed = stepProgramPlayback({
      lastProgram: 0.99,
      requestedProgram: 0.99,
      dt: 0.016,
      mediaSource: 1.05,
      mediaPresent: true,
      resolved,
      fps: 30
    })
    expect(crossed.clock).toBe('wall')
    expect(crossed.hard).toBe(true)

    const waiting = stepProgramPlayback({
      lastProgram: crossed.program,
      requestedProgram: crossed.program,
      dt: 0.016,
      mediaSource: null,
      mediaPresent: true,
      resolved,
      fps: 30
    })
    expect(waiting).toEqual({ program: crossed.program, clock: 'hold', hard: false })

    const desiredSource = programToSourceOf(project, waiting.program)
    const resumed = stepProgramPlayback({
      lastProgram: waiting.program,
      requestedProgram: waiting.program,
      dt: 0.016,
      mediaSource: desiredSource + 0.016,
      mediaPresent: true,
      resolved,
      fps: 30
    })
    expect(resumed.clock).toBe('media')
    expect(resumed.hard).toBe(false)
    expect(resumed.program).toBeGreaterThan(waiting.program)
  })

  test('200 ripple cuts never ask the decoder for a deleted source time', () => {
    const cuts = 200
    const sourceDuration = cuts * 0.4 + 0.2
    const project = applyCommand(
      {
        ...createEmptyProject('dense-play'),
        sourceDuration,
        assets: {
          src: {
            id: 'src',
            path: '/tmp/dense.mp4',
            name: 'dense.mp4',
            kind: 'video',
            duration: sourceDuration,
            waveform: []
          }
        },
        cuts: Array.from({ length: cuts }, (_, i) => {
          const start = 0.2 + i * 0.4
          return { id: `c${i}`, start, end: start + 0.2, source: 'silence' as const }
        })
      },
      { type: 'setCutMargin', margin: 0.12 }
    )
    const resolved = resolveProgram(project)
    expect(resolved.media.length).toBeGreaterThan(150)
    let program = 0
    let media = resolved.media[0]?.inPoint ?? 0
    const dt = 1 / 30
    const end = programLengthOf(project) - dt
    let holesSeen = 0
    while (program < end) {
      if (sourceInHole(project, media)) holesSeen += 1
      const stepped = stepProgramPlayback({
        lastProgram: program,
        requestedProgram: program,
        dt,
        mediaSource: media,
        resolved,
        fps: 30
      })
      program = stepped.program
      const desired = programToSourceOf(project, program)
      expect(sourceInHole(project, desired)).toBe(false)
      if (stepped.hard || sourceInHole(project, media)) media = desired
      else media += dt
    }
    expect(holesSeen).toBeGreaterThan(20)
  })
})

test('decoder drift cannot move the program backwards near a recording boundary', () => {
  const resolved = resolveProgram(videoAssetProject())
  const stepped = stepProgramPlayback({ lastProgram: 0.5, requestedProgram: 0.5, dt: 1 / 60, mediaSource: 0.49, mediaPresent: true, resolved })
  expect(stepped.program).toBe(0.5)
})

test('an exhausted primary decoder lets the last fraction of the program finish', () => {
  const resolved = resolveProgram(videoAssetProject())
  let program = resolved.length - 0.01
  for (let frame = 0; frame < 3; frame++) {
    program = stepProgramPlayback({ lastProgram: program, requestedProgram: program, dt: 1 / 60, mediaSource: null, mediaPresent: false, resolved }).program
  }
  expect(program).toBeGreaterThan(resolved.length)
})
