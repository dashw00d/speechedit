/** Import look policy: cap ffmpeg, skip unused streams, cheapen hour-scale video and audio looks. */

import { throwIfAborted, type MediaJobKind } from './mediaJob'
import { transposeFilters } from './mediaOrient'

export const LOOK_LANE_LIMIT = 2
export const ANALYSIS_CACHE_VERSION = 2
export const CHEAP_SCENE_DURATION_S = 90
export const CHEAP_SCENE_MIN_EDGE = 720
export const SEEK_THUMB_DURATION_S = 90
export const SEEK_THUMB_GAP_S = 3
export const SEEK_PEAK_DURATION_S = 90
export const SEEK_PEAK_WINDOW_S = 0.06
export const SEEK_PEAK_BATCH = 16
export const WAVEFORM_SAMPLES = 1800
export const CHEAP_AUDIO_LOOK_DURATION_S = 90
export const CHEAP_AUDIO_LOOK_RATE = 8000
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

export function wantsSeekPeaks(duration: number): boolean {
  return duration >= SEEK_PEAK_DURATION_S
}

export function peakSeekTimes(duration: number, samples: number): number[] {
  const window = Math.min(SEEK_PEAK_WINDOW_S, Math.max(0.02, duration / Math.max(1, samples) / 2))
  return thumbSeekTimes(duration, samples).map((time) =>
    Number(Math.min(Math.max(0, time), Math.max(0, duration - window)).toFixed(3))
  )
}

export function waveformStrategy(duration: number): 'decode' | 'seek' {
  return wantsSeekPeaks(duration) ? 'seek' : 'decode'
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

function concatEscape(path: string): string {
  return path.replace(/\\/g, '/').replace(/'/g, "'\\''")
}

/** ffconcat that pulls short audio windows instead of decoding the whole soundtrack. */
export function waveformConcatList(file: string, times: number[], window = SEEK_PEAK_WINDOW_S): string {
  const path = concatEscape(file)
  const lines = ['ffconcat version 1.0']
  for (const time of times) {
    const start = Math.max(0, time)
    lines.push(`file '${path}'`)
    lines.push(`inpoint ${start.toFixed(3)}`)
    lines.push(`outpoint ${(start + window).toFixed(3)}`)
  }
  return `${lines.join('\n')}\n`
}

export function waveformConcatArgs(listPath: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
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

export function waveformSeekBatchArgs(file: string, times: number[], window = SEEK_PEAK_WINDOW_S): string[] {
  const args = ['-hide_banner', '-loglevel', 'error']
  for (const time of times) {
    args.push('-ss', String(Math.max(0, time)), '-t', String(window), '-i', file)
  }
  if (times.length <= 1) {
    args.push('-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1')
    return args
  }
  const filters = times
    .map((_, i) => `[${i}:a]aformat=sample_fmts=fltp:channel_layouts=mono,aresample=8000[a${i}]`)
    .join(';')
  const concat = `${times.map((_, i) => `[a${i}]`).join('')}concat=n=${times.length}:v=0:a=1[out]`
  args.push(
    '-filter_complex',
    `${filters};${concat}`,
    '-map',
    '[out]',
    '-vn',
    '-f',
    'f32le',
    '-acodec',
    'pcm_f32le',
    'pipe:1'
  )
  return args
}

export function chunkTimes<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  const n = Math.max(1, size)
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n))
  return out
}

export function wantsCheapAudioLooks(duration: number): boolean {
  return duration >= CHEAP_AUDIO_LOOK_DURATION_S
}

export function audioLookFilters(opts?: {
  duration?: number
  threshold?: string
  min?: number
  silence?: boolean
  loudness?: boolean
}): string {
  const cheap = wantsCheapAudioLooks(opts?.duration ?? 0)
  const parts: string[] = []
  if (cheap) parts.push(`aresample=${CHEAP_AUDIO_LOOK_RATE}`)
  if (opts?.silence !== false) {
    parts.push(`silencedetect=n=${opts?.threshold ?? '-30dB'}:d=${opts?.min ?? 0.35}`)
  }
  if (opts?.loudness !== false) {
    parts.push('ebur128=peak=true')
  }
  return parts.join(',')
}

export function audioLookArgs(
  file: string,
  opts?: {
    duration?: number
    threshold?: string
    min?: number
    silence?: boolean
    loudness?: boolean
  }
): string[] {
  return ['-hide_banner', '-i', file, '-vn', '-af', audioLookFilters(opts), '-f', 'null', '-']
}

export function silenceDetectArgs(
  file: string,
  threshold = '-30dB',
  min = 0.35,
  duration = 0
): string[] {
  return audioLookArgs(file, { duration, threshold, min, silence: true, loudness: false })
}

export function loudnessDetectArgs(file: string, duration = 0): string[] {
  return audioLookArgs(file, { duration, silence: false, loudness: true })
}

export function parseSilenceLog(text: string): Array<{ start: number; end: number }> {
  const starts: number[] = []
  const gaps: Array<{ start: number; end: number }> = []
  for (const line of text.split('\n')) {
    const start = line.match(/silence_start: ([\d.]+)/)
    const end = line.match(/silence_end: ([\d.]+)/)
    if (start) starts.push(Number(start[1]))
    if (end && starts.length) gaps.push({ start: starts.pop()!, end: Number(end[1]) })
  }
  return gaps
}

export function parseLoudnessLog(text: string): Array<{ start: number; end: number; lufs: number }> {
  const windows: Array<{ start: number; end: number; lufs: number }> = []
  for (const line of text.split('\n')) {
    const m = line.match(/t:\s*([\d.]+).*I:\s*([-\d.]+)/)
    if (m) {
      const t = Number(m[1])
      windows.push({ start: Math.max(0, t - 0.4), end: t, lufs: Number(m[2]) })
    }
  }
  return windows.filter((w) => w.lufs > -14)
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
