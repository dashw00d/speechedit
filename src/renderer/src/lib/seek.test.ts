import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createEmptyProject } from './demo'
import { projectToExportJob } from './exportJob'
import { sampleProgram } from './programLook'
import { sourceToProgramOf } from './resolver'
import {
  advancePlayhead,
  boundPlayhead,
  mediaJumped,
  readMediaClock,
  seekSlop,
  shouldHardSeek,
  shouldSeek,
  sourceDiscontinuity
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
