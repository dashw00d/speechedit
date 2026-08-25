/** Import look policy: cap ffmpeg, skip unused streams, cheapen hour-scale video. */

import { throwIfAborted, type MediaJobKind } from './mediaJob'
import { transposeFilters } from './mediaOrient'

export const LOOK_LANE_LIMIT = 2
export const ANALYSIS_CACHE_VERSION = 2
export const CHEAP_SCENE_DURATION_S = 90
export const CHEAP_SCENE_MIN_EDGE = 720
export const SEEK_THUMB_DURATION_S = 90
export const SEEK_THUMB_GAP_S = 3
export const CHEAP_SCENE_FPS = 5
export const CHEAP_SCENE_WIDTH = 320

export function wantsCheapScenes(info: { duration?: number; width?: number; height?: number }): boolean {
  const duration = info.duration ?? 0
  const edge = Math.max(info.width ?? 0, info.height ?? 0)
  return duration >= CHEAP_SCENE_DURATION_S || edge >= CHEAP_SCENE_MIN_EDGE
}

export function wantsSeekThumbs(duration: number, count: number): boolean {
  return duration >= SEEK_THUMB_DURATION_S && duration / Math.max(1, count) >= SEEK_THUMB_GAP_S
}

export function thumbSeekTimes(duration: number, count: number): number[] {
  if (duration < 0.2 || count < 1) return []
  return Array.from({ length: count }, (_, i) => Number((((i + 0.5) * duration) / count).toFixed(3)))
}

export function waveformLookArgs(file: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    file,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '8000',
    '-f',
    'f32le',
    '-acodec',
    'pcm_f32le',
    'pipe:1'
  ]
}

export function silenceDetectArgs(file: string, threshold = '-30dB', min = 0.35): string[] {
  return ['-hide_banner', '-i', file, '-vn', '-af', `silencedetect=n=${threshold}:d=${min}`, '-f', 'null', '-']
}

export function loudnessDetectArgs(file: string): string[] {
  return ['-hide_banner', '-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']
}

export function sceneDetectFilters(info: {
  duration?: number
  width?: number
  height?: number
  rotation?: number
}): string[] {
  const cheap = wantsCheapScenes(info)
  return [
    ...transposeFilters(info.rotation),
    ...(cheap ? [`fps=${CHEAP_SCENE_FPS}`, `scale='min(${CHEAP_SCENE_WIDTH},iw)':-2`] : []),
    "select='gt(scene,0.22)'",
    'showinfo'
  ]
}

export function sceneDetectArgs(
  file: string,
  info: { duration?: number; width?: number; height?: number; rotation?: number }
): string[] {
  return ['-hide_banner', '-i', file, '-an', '-vf', sceneDetectFilters(info).join(','), '-f', 'null', '-']
}

function thumbScaleCrop(rotation?: number): string[] {
  return [...transposeFilters(rotation), 'scale=160:90:force_original_aspect_ratio=increase', 'crop=160:90']
}

export function thumbPassArgs(
  file: string,
  destPattern: string,
  fps: number,
  count: number,
  rotation?: number
): string[] {
  return [
    '-y',
    '-noautorotate',
    '-i',
    file,
    '-an',
    '-vf',
    [...transposeFilters(rotation), `fps=${fps.toFixed(3)}`, 'scale=160:90:force_original_aspect_ratio=increase', 'crop=160:90'].join(
      ','
    ),
    '-frames:v',
    String(count),
    '-q:v',
    '6',
    destPattern
  ]
}

export function thumbSeekArgs(file: string, dest: string, time: number, rotation?: number): string[] {
  return [
    '-y',
    '-noautorotate',
    '-ss',
    String(time),
    '-i',
    file,
    '-an',
    '-vf',
    thumbScaleCrop(rotation).join(','),
    '-frames:v',
    '1',
    '-q:v',
    '6',
    dest
  ]
}

/** At most `limit` look ffmpeg processes. Proxy and Whisper stay off this lane. */
export class WorkLane {
  private running = 0
  private readonly waiters: Array<() => void> = []

  constructor(readonly limit: number) {
    if (limit < 1) throw new Error('WorkLane limit must be at least 1')
  }

  get active(): number {
    return this.running
  }

  get waiting(): number {
    return this.waiters.length
  }

  async run<T>(work: () => Promise<T>, signal?: AbortSignal, kind?: MediaJobKind): Promise<T> {
    throwIfAborted(signal, kind)
    await this.acquire()
    try {
      throwIfAborted(signal, kind)
      return await work()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.running += 1
        resolve()
      })
    })
  }

  private release(): void {
    this.running = Math.max(0, this.running - 1)
    const next = this.waiters.shift()
    if (next) next()
  }
}
