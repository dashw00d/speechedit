import { sourceInHoleOn, sourceToProgramOn, type ResolvedProgram } from './resolver'

/** How far the playhead may drift before we snap the media element. */

export function frameDuration(fps = 30): number {
  return 1 / Math.max(12, fps)
}

export function seekSlop(playing: boolean, fps = 30): number {
  if (playing) return 0.16
  return frameDuration(fps)
}

export function shouldSeek(current: number, desired: number, playing: boolean, fps = 30): boolean {
  return Math.abs(current - desired) > seekSlop(playing, fps)
}

/**
 * A media seek is asynchronous. Reassigning currentTime on every animation
 * frame while Chromium is still seeking starves the decoder (and its audio
 * clock), especially at ripple-cut boundaries.
 */
export function shouldSetMediaTime(input: {
  current: number
  desired: number
  seeking: boolean
  readyState: number
  playing: boolean
  hard: boolean
  fps?: number
}): boolean {
  if (input.seeking || input.readyState === 0) return false
  return shouldSeek(input.current, input.desired, input.playing && !input.hard, input.fps)
}

/** A cut, loop, or user jump — not decoder drift. Snap even while playing. */
export function mediaJumped(prevSource: number, nextSource: number, dt: number, speed = 1, fps = 30): boolean {
  const expected = prevSource + dt * Math.max(0.01, speed)
  return Math.abs(nextSource - expected) > frameDuration(fps)
}

/**
 * Source time skipped a keep, looped, or jumped back.
 * A stalled decoder (next ≈ prev while wall dt advances) is not a discontinuity.
 */
export function sourceDiscontinuity(
  prevSource: number,
  nextSource: number,
  dt: number,
  speed = 1,
  fps = 30
): boolean {
  const frame = frameDuration(fps)
  const maxAdvance = dt * Math.max(0.01, speed) + frame
  const delta = nextSource - prevSource
  return delta < -frame || delta > maxAdvance
}

export type PlayheadClock = 'media' | 'wall' | 'jump' | 'hold'

export interface MediaClockRead {
  source: number | null
  present: boolean
}

/** Primary picture clock. Missing src → audio-only (wall). Unready/seeking → hold. */
export function readMediaClock(media: {
  src: string
  currentTime: number
  seeking: boolean
  readyState: number
} | null | undefined): MediaClockRead {
  if (!media?.src) return { source: null, present: false }
  if (media.seeking || media.readyState < 2) return { source: null, present: true }
  return { source: media.currentTime, present: true }
}

export function advancePlayhead(input: {
  lastProgram: number
  requestedProgram: number
  dt: number
  mediaSource: number | null
  mediaPresent: boolean
  sourceToProgram: (source: number) => number
  fps?: number
}): { program: number; clock: PlayheadClock } {
  const frame = frameDuration(input.fps)
  const jumped = Math.abs(input.requestedProgram - input.lastProgram) > frame * 2
  if (jumped) return { program: input.requestedProgram, clock: 'jump' }
  if (input.mediaSource != null) {
    return { program: input.sourceToProgram(input.mediaSource), clock: 'media' }
  }
  if (input.mediaPresent) return { program: input.lastProgram, clock: 'hold' }
  return { program: input.requestedProgram + input.dt, clock: 'wall' }
}

export function boundPlayhead(
  program: number,
  opts: {
    duration: number
    playUntil: number | null
    loopFrom: number | null
    loop: boolean
    markIn: number | null
    markOut: number | null
  }
): { program: number; looped: boolean; stop: boolean } {
  const duration = Math.max(0, opts.duration)
  if (opts.playUntil != null && program >= opts.playUntil) {
    if (opts.loopFrom != null) return { program: opts.loopFrom, looped: true, stop: false }
    return { program: opts.playUntil, looped: false, stop: true }
  }
  const loopMarks = opts.loop && opts.markIn != null && opts.markOut != null
  if (loopMarks) {
    const markA = Math.min(opts.markIn!, opts.markOut!)
    const markB = Math.max(opts.markIn!, opts.markOut!)
    if (program >= markB) return { program: markA, looped: true, stop: false }
  } else if (program >= duration) {
    if (opts.loop) return { program: 0, looped: true, stop: false }
    return { program: duration, looped: false, stop: true }
  }
  return { program, looped: false, stop: false }
}

export function shouldHardSeek(opts: {
  lastSource: number | null
  nextSource: number
  dt: number
  speed: number
  fps: number
  clock: PlayheadClock
  looped: boolean
  cut: boolean
}): boolean {
  if (opts.lastSource == null) return true
  if (opts.clock === 'jump' || opts.looped || opts.cut) return true
  return sourceDiscontinuity(opts.lastSource, opts.nextSource, opts.dt, opts.speed, opts.fps)
}

/**
 * Program time is the master clock. Media currentTime may only nudge the playhead
 * while it stays inside a keep. A decoder walking into a cut does not stall us.
 */
export function stepProgramPlayback(input: {
  lastProgram: number
  requestedProgram: number
  dt: number
  mediaSource: number | null
  mediaPresent?: boolean
  sourceOffset?: number
  resolved: ResolvedProgram
  fps?: number
}): { program: number; clock: PlayheadClock; hard: boolean } {
  const fps = input.fps
  const frame = frameDuration(fps)
  if (Math.abs(input.requestedProgram - input.lastProgram) > frame * 2) {
    return { program: input.requestedProgram, clock: 'jump', hard: true }
  }
  const wallProgram = input.lastProgram + input.dt
  const source = input.mediaSource
  const abs = source == null ? null : source + (input.sourceOffset ?? 0)
  if (abs != null && !sourceInHoleOn(input.resolved, abs)) {
    const fromMedia = sourceToProgramOn(input.resolved, abs)
    // Audio keeps advancing while React/layout or a background tab delays RAF.
    // Catch the UI up within the same retained segment; rewinding the decoder
    // to the capped wall clock would audibly repeat words on every slow frame.
    const advancedInKeep = fromMedia >= input.lastProgram && input.resolved.media.some(seg =>
      input.lastProgram >= seg.start && input.lastProgram < seg.start + seg.duration &&
      abs >= seg.inPoint && abs <= seg.outPoint)
    if (advancedInKeep || Math.abs(fromMedia - wallProgram) <= seekSlop(true, fps)) {
      return { program: Math.max(input.lastProgram, fromMedia), clock: 'media', hard: false }
    }
    return { program: wallProgram, clock: 'wall', hard: true }
  }
  // The audio clock can reach a cut while a busy UI still shows an earlier
  // frame. The capped wall step must not seek back into that already-heard
  // speech. Finish the current segment, without skipping any following insert.
  if (abs != null) {
    const current = input.resolved.segments.find(seg =>
      input.lastProgram >= seg.start && input.lastProgram < seg.start + seg.duration)
    if (current && current.kind !== 'slug' && abs > current.outPoint) {
      return { program: current.start + current.duration, clock: 'wall', hard: true }
    }
  }
  // The first frame inside a cut advances to the next kept source and starts a
  // hard seek. While that seek is pending, hold this program frame instead of
  // moving the target and issuing a fresh seek every RAF.
  if (source == null && input.mediaPresent) {
    return { program: input.lastProgram, clock: 'hold', hard: false }
  }
  return { program: wallProgram, clock: 'wall', hard: true }
}
