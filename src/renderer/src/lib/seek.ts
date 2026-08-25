/** How far the playhead may drift before we snap the media element. */

export function seekSlop(playing: boolean, fps = 30): number {
  if (playing) return 0.16
  return 1 / Math.max(12, fps)
}

export function shouldSeek(current: number, desired: number, playing: boolean, fps = 30): boolean {
  return Math.abs(current - desired) > seekSlop(playing, fps)
}
