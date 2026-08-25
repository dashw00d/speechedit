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
