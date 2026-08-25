/**
 * Frame-accurate source reads for export.
 * Input -ss alone snaps to a keyframe (often 0.5–2s on camera GOP).
 * Trim/atrim on the original timestamps is the cut. A short preroll
 * input -ss plus -copyts avoids decoding an hour of lead-in.
 */

export const SOURCE_SEEK_PREROLL = 4

export function sourceSeekInputArgs(start: number, preroll = SOURCE_SEEK_PREROLL): string[] {
  const inputSs = Math.max(0, start - Math.max(0, preroll))
  if (inputSs <= 0.0005) return []
  return ['-ss', inputSs.toFixed(3)]
}

export function sourceTrimFilters(start: number, end: number): { vf: string; af: string } {
  const a = Math.max(0, start)
  const b = Math.max(a + 0.02, end)
  return {
    vf: `trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS`,
    af: `atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)},asetpts=PTS-STARTPTS`
  }
}

/** Overlay/B-roll: preroll + copyts + output -ss/-t on the source clock. */
export function sourceReadArgs(
  path: string,
  start: number,
  duration: number,
  preroll = SOURCE_SEEK_PREROLL
): string[] {
  const from = Math.max(0, start)
  const dur = Math.max(0.02, duration)
  return [
    ...sourceSeekInputArgs(from, preroll),
    '-i',
    path,
    '-copyts',
    '-ss',
    from.toFixed(3),
    '-t',
    dur.toFixed(3)
  ]
}

/** Primary picture/voice: preroll + copyts. Absolute trim lives in the filter graph. */
export function primaryReadArgs(path: string, start: number, preroll = SOURCE_SEEK_PREROLL): string[] {
  return ['-noautorotate', ...sourceSeekInputArgs(start, preroll), '-i', path, '-copyts']
}
