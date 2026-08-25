import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { analysisCachePath, peaksCachePath, readJsonCache, thumbsCachePath, writeJsonCache } from './mediaCache'
import {
  assertMixGraph,
  buildJoinGraph,
  buildMixGraph,
  buildSegmentFilters,
  explainExportError,
  explainGraphBuildError,
  jobDuration,
  summarizeJob,
  validateExportJob,
  type GraphJob
} from '../renderer/src/lib/exportGraph'
import { JobCancelled, isJobCancelled, throwIfAborted, type MediaJobKind } from '../shared/mediaJob'
import { parseStreamRotation, transposeFilters, type QuarterTurn } from '../shared/mediaOrient'
import { isVariableFrameRate } from '../shared/proxy'
import { killChild, runChild, withTempDir } from './childJob'
import type { ModelEndpointOpts } from './transcribe'

export type { ModelEndpointOpts, TranscribeProgress } from './transcribe'
export { listAsrPath, transcribe, transcribeMedia } from './transcribe'

export interface EncoderOption {
  id: string
  label: string
  hardware: boolean
}

export interface ProgramExportJob {
  input: string
  output: string
  fps: number
  width: number
  height: number
  volume: number
  fadeIn: number
  fadeOut: number
  encoder?: string
  inputRotation?: number
  normalize?: boolean
  eqLow?: number
  eqMid?: number
  eqHigh?: number
  compress?: boolean
  duck?: number
  duckWindows?: { start: number; end: number }[]
  duration?: number
  beds?: {
    path: string
    start: number
    duration: number
    inPoint: number
    volume: number
    fadeIn: number
    fadeOut: number
    id?: string
  }[]
  segments: {
    start: number
    end: number
    speed: number
    scale: number
    x: number
    y: number
    volume: number
    fadeIn: number
    fadeOut: number
    overlapNext?: number
    programStart?: number
  }[]
  layers: {
    kind: 'caption' | 'overlay' | 'image' | 'blur'
    start: number
    end: number
    text: string
    fontSize: number
    x: number
    y: number
    scale: number
    opacity: number
    path?: string
    fadeIn?: number
    fadeOut?: number
    inPoint?: number
    loop?: boolean
    id?: string
    speed?: number
    align?: 'left' | 'center' | 'right'
    fill?: string
    stroke?: string
    position?: 'lower' | 'center' | 'upper'
    rotation?: number
  }[]
}

export type ExportProgress = { ratio: number; stage: string }

export interface ProbeResult {
  duration: number
  width?: number
  height?: number
  fps?: number
  sampleRate?: number
  hasVideo: boolean
  hasAudio: boolean
  codec?: string
  rotation?: QuarterTurn
  vfr?: boolean
}

export interface SilenceGap {
  start: number
  end: number
}

const FFMPEG_MISSING = 'FFmpeg did not start. Install ffmpeg 4.4+ (and ffprobe) and keep them on PATH.'

function toolMissing(cmd: string): string {
  if (cmd === 'ffmpeg' || cmd === 'ffprobe') return FFMPEG_MISSING
  return `${cmd} did not start. Install it and keep it on PATH.`
}

function run(cmd: string, args: string[], signal?: AbortSignal, kind?: MediaJobKind): Promise<string> {
  return runChild(cmd, args, {
    signal,
    kind,
    allowFailure: cmd === 'ffmpeg',
    missing: toolMissing(cmd)
  })
}

function runStrict(cmd: string, args: string[], signal?: AbortSignal, kind?: MediaJobKind): Promise<string> {
  return runChild(cmd, args, { signal, kind, missing: toolMissing(cmd) })
}

function parseFfmpegTime(line: string): number | null {
  const m = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

function runFfmpeg(
  args: string[],
  onTime?: (seconds: number) => void,
  signal?: AbortSignal,
  kind: MediaJobKind = 'export'
): Promise<string> {
  return runChild('ffmpeg', args, {
    signal,
    kind,
    missing: FFMPEG_MISSING,
    fail: (_code, stderr) => new Error(explainExportError(stderr)),
    onStderr: (text) => {
      if (!onTime) return
      for (const line of text.split(/\r|\n/)) {
        const t = parseFfmpegTime(line)
        if (t != null) onTime(t)
      }
    }
  })
}

const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
  'C:/Windows/Fonts/arial.ttf'
]

export function findExportFont(): string | undefined {
  return FONT_CANDIDATES.find((p) => existsSync(p))
}

const ENCODER_CANDIDATES: EncoderOption[] = [
  { id: 'h264_nvenc', label: 'NVIDIA NVENC', hardware: true },
  { id: 'h264_qsv', label: 'Intel Quick Sync', hardware: true },
  { id: 'h264_amf', label: 'AMD AMF', hardware: true },
  { id: 'h264_videotoolbox', label: 'Apple VideoToolbox', hardware: true }
]

let encoderCache: EncoderOption[] | null = null

export async function detectEncoders(): Promise<EncoderOption[]> {
  if (encoderCache) return encoderCache
  const listed = await run('ffmpeg', ['-hide_banner', '-encoders']).catch(() => '')
  const found: EncoderOption[] = [{ id: 'libx264', label: 'x264 (CPU)', hardware: false }]
  for (const candidate of ENCODER_CANDIDATES) {
    if (!listed.includes(candidate.id)) continue
    try {
      await runStrict('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=64x64:d=0.12',
        '-frames:v',
        '2',
        '-c:v',
        candidate.id,
        '-f',
        'null',
        '-'
      ])
      found.push(candidate)
    } catch {
      /* listed but no device */
    }
  }
  encoderCache = found
  return found
}

export function videoEncodeArgs(encoder: string): string[] {
  switch (encoder) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '19', '-pix_fmt', 'yuv420p']
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '19', '-pix_fmt', 'yuv420p']
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', 'balanced', '-qp_i', '18', '-pix_fmt', 'yuv420p']
    case 'h264_videotoolbox':
      return ['-c:v', 'h264_videotoolbox', '-q:v', '65', '-pix_fmt', 'yuv420p']
    default:
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p']
  }
}

function audioEncodeArgs(): string[] {
  return ['-c:a', 'aac', '-b:a', '192k']
}

async function resolveEncoder(requested?: string): Promise<string> {
  if (requested && requested !== 'auto') return requested
  const list = await detectEncoders()
  return list.find((e) => e.hardware)?.id ?? 'libx264'
}

export async function probe(file: string, signal?: AbortSignal): Promise<ProbeResult> {
  throwIfAborted(signal, 'import')
  if (!file) throw new Error('Pick a media file to import.')
  if (!existsSync(file)) {
    throw new Error(`Can't open that recording:\n${file}\nPick a real media file.`)
  }
  const raw = await run(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file],
    signal,
    'import'
  )
  const json = JSON.parse(raw) as {
    format?: { duration?: string }
    streams?: Array<{
      codec_type?: string
      codec_name?: string
      width?: number
      height?: number
      avg_frame_rate?: string
      r_frame_rate?: string
      sample_rate?: string
      tags?: Record<string, string>
      side_data_list?: Array<{ side_data_type?: string; rotation?: number | string }>
    }>
  }
  const video = json.streams?.find((s) => s.codec_type === 'video')
  const audio = json.streams?.find((s) => s.codec_type === 'audio')
  const [num, den] = (video?.avg_frame_rate ?? '0/1').split('/').map(Number)
  const rotation = video ? parseStreamRotation(video) : 0
  const vfr = video ? isVariableFrameRate(video.avg_frame_rate, video.r_frame_rate) : false
  return {
    duration: Number(json.format?.duration ?? 0),
    width: video?.width,
    height: video?.height,
    fps: den ? num / den : undefined,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : undefined,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    codec: video?.codec_name ?? audio?.codec_name,
    ...(rotation ? { rotation } : {}),
    ...(vfr ? { vfr } : {})
  }
}

export async function makeProxy(file: string, output: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal, 'import')
  if (!file) throw new Error('Pick a media file to import.')
  if (!existsSync(file)) {
    throw new Error(`Can't open that recording:\n${file}\nPick a real media file.`)
  }
  await mkdir(dirname(output), { recursive: true })
  if (existsSync(output)) {
    const cached = await probe(output, signal).catch(() => null)
    if (cached?.hasVideo && cached.duration > 0.2) return output
  }
  const info = await probe(file, signal)
  const orient = transposeFilters(info.rotation)
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-noautorotate',
    '-i',
    file,
    '-vf',
    [...orient, "scale='min(960,iw)':-2"].join(','),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart'
  ]
  if (info.hasAudio) args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2')
  else args.push('-an')
  args.push(output)
  await runStrict('ffmpeg', args, signal, 'import')
  return output
}

export async function waveform(file: string, samples = 1800, signal?: AbortSignal): Promise<number[]> {
  throwIfAborted(signal, 'import')
  const cache = peaksCachePath(file)
  const hit = await readJsonCache<{ v: number; samples: number; peaks: number[] }>(cache)
  if (hit?.v === 1 && hit.samples === samples && Array.isArray(hit.peaks) && hit.peaks.length) {
    return hit.peaks
  }
  const args = ['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1']
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args)
    const chunks: Buffer[] = []
    const onAbort = () => killChild(child)
    signal?.addEventListener('abort', onAbort, { once: true })
    const finish = (fn: () => void) => {
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    child.stdout.on('data', (d: Buffer) => chunks.push(d))
    child.on('error', (err) =>
      finish(() => {
        if (signal?.aborted) reject(new JobCancelled('import'))
        else reject(new Error(FFMPEG_MISSING + ` (${err.message})`))
      })
    )
    child.on('close', (code, sig) => {
      finish(() => {
        if (signal?.aborted || sig === 'SIGTERM' || sig === 'SIGKILL') {
          reject(new JobCancelled('import'))
          return
        }
        if (code !== 0) {
          reject(new Error('waveform ffmpeg failed'))
          return
        }
        const buf = Buffer.concat(chunks)
        const floats = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
        const bucket = Math.max(1, Math.floor(floats.length / samples))
        const out: number[] = []
        for (let i = 0; i < samples; i++) {
          let peak = 0
          const start = i * bucket
          for (let j = start; j < start + bucket && j < floats.length; j++) {
            peak = Math.max(peak, Math.abs(floats[j]))
          }
          out.push(Math.min(1, peak))
        }
        void writeJsonCache(cache, { v: 1, samples, peaks: out })
          .catch(() => undefined)
          .then(() => resolve(out))
      })
    })
  })
}

export async function detectSilence(
  file: string,
  threshold = '-30dB',
  min = 0.35,
  signal?: AbortSignal
): Promise<SilenceGap[]> {
  const text = await run(
    'ffmpeg',
    ['-i', file, '-af', `silencedetect=n=${threshold}:d=${min}`, '-f', 'null', '-'],
    signal,
    'import'
  )
  const starts: number[] = []
  const gaps: SilenceGap[] = []
  for (const line of text.split('\n')) {
    const start = line.match(/silence_start: ([\d.]+)/)
    const end = line.match(/silence_end: ([\d.]+)/)
    if (start) starts.push(Number(start[1]))
    if (end && starts.length) gaps.push({ start: starts.pop()!, end: Number(end[1]) })
  }
  return gaps
}

export async function detectScenes(
  file: string,
  signal?: AbortSignal
): Promise<{ times: number[]; staticRegions: SilenceGap[] }> {
  const text = await run(
    'ffmpeg',
    ['-i', file, '-vf', "select='gt(scene,0.22)',showinfo", '-f', 'null', '-'],
    signal,
    'import'
  )
  const times: number[] = []
  for (const line of text.split('\n')) {
    const hit = line.match(/pts_time:([\d.]+)/)
    if (hit) times.push(Number(hit[1]))
  }
  const info = await probe(file, signal)
  const staticRegions: SilenceGap[] = []
  let cursor = 0
  const marks = [...times, info.duration]
  for (const mark of marks) {
    if (mark - cursor >= 2.4) staticRegions.push({ start: cursor, end: mark })
    cursor = mark
  }
  return { times, staticRegions }
}

export async function detectLoudness(
  file: string,
  signal?: AbortSignal
): Promise<{ start: number; end: number; lufs: number }[]> {
  const text = await run('ffmpeg', ['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], signal, 'import')
  const windows: { start: number; end: number; lufs: number }[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/t:\s*([\d.]+).*I:\s*([-\d.]+)/)
    if (m) {
      const t = Number(m[1])
      windows.push({ start: Math.max(0, t - 0.4), end: t, lufs: Number(m[2]) })
    }
  }
  return windows.filter((w) => w.lufs > -14)
}

export interface CachedAnalysis {
  silence: SilenceGap[]
  scenes: { times: number[]; staticRegions: SilenceGap[] }
  loudness: { start: number; end: number; lufs: number }[]
}

export async function analyzeMedia(
  file: string,
  signal?: AbortSignal,
  onProgress?: (info: { stage: string; ratio: number }) => void
): Promise<CachedAnalysis> {
  throwIfAborted(signal, 'import')
  const cache = analysisCachePath(file)
  const hit = await readJsonCache<{ v: number } & CachedAnalysis>(cache)
  if (hit?.v === 1 && Array.isArray(hit.silence) && hit.scenes && Array.isArray(hit.loudness)) {
    onProgress?.({ stage: 'done', ratio: 1 })
    return { silence: hit.silence, scenes: hit.scenes, loudness: hit.loudness }
  }
  onProgress?.({ stage: 'silence', ratio: 0.15 })
  const silence = await detectSilence(file, '-30dB', 0.35, signal)
  onProgress?.({ stage: 'motion', ratio: 0.45 })
  const scenes = await detectScenes(file, signal).catch((err) => {
    if (isJobCancelled(err)) throw err
    return { times: [], staticRegions: [] }
  })
  onProgress?.({ stage: 'loudness', ratio: 0.7 })
  const loudness = await detectLoudness(file, signal).catch((err) => {
    if (isJobCancelled(err)) throw err
    return []
  })
  onProgress?.({ stage: 'done', ratio: 1 })
  await writeJsonCache(cache, { v: 1, silence, scenes, loudness }).catch(() => undefined)
  return { silence, scenes, loudness }
}

function asGraphJob(job: ProgramExportJob): GraphJob {
  return job
}

async function joinParts(
  dir: string,
  parts: string[],
  job: ProgramExportJob,
  encoder: string,
  onProgress?: (info: ExportProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  const body = join(dir, 'body.mp4')
  if (parts.length === 1) {
    await runFfmpeg(['-y', '-i', parts[0], '-c', 'copy', body], undefined, signal)
    return body
  }
  const joinGraph = buildJoinGraph(asGraphJob(job), parts.length)
  if (!joinGraph) {
    const concatList = join(dir, 'list.txt')
    await writeFile(concatList, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', body], undefined, signal)
    return body
  }
  const args = ['-y']
  for (const part of parts) args.push('-i', part)
  args.push(
    '-filter_complex',
    joinGraph.filterComplex,
    '-map',
    joinGraph.mapVideo,
    '-map',
    joinGraph.mapAudio,
    ...videoEncodeArgs(encoder),
    ...audioEncodeArgs(),
    body
  )
  const total = jobDuration(asGraphJob(job))
  await runFfmpeg(
    args,
    (seconds) => {
      onProgress?.({
        ratio: 0.72 + Math.min(0.1, (seconds / Math.max(0.01, total)) * 0.1),
        stage: 'joining dissolves'
      })
    },
    signal
  )
  return body
}

export async function exportProgram(
  job: ProgramExportJob,
  onProgress?: (info: ExportProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal, 'export')
  if (!job.segments.length) throw new Error('Nothing to export — the timeline is empty.')
  if (!existsSync(job.input)) {
    throw new Error(`Recording is missing:\n${job.input}\nRe-import the media and export again.`)
  }
  const graphJob = asGraphJob(job)
  const invalid = validateExportJob(graphJob)
  if (invalid) throw new Error(invalid)
  for (const bed of job.beds ?? []) {
    if (bed.path && !existsSync(bed.path)) {
      throw new Error(`Music bed is missing:\n${bed.path}\nRelink the bed and export again.`)
    }
  }
  for (const layer of job.layers) {
    if (layer.path && !existsSync(layer.path)) {
      throw new Error(`Overlay or still is missing:\n${layer.path}\nRelink it and export again.`)
    }
  }
  let mix
  try {
    mix = buildMixGraph(graphJob, { fontFile: findExportFont() })
    assertMixGraph(mix)
  } catch (err) {
    throw new Error(explainGraphBuildError(err))
  }
  throwIfAborted(signal, 'export')
  onProgress?.({ ratio: 0, stage: summarizeJob(graphJob, mix) })
  const encoder = await resolveEncoder(job.encoder)
  throwIfAborted(signal, 'export')
  const duration = jobDuration(graphJob)
  let wroteOutput = false
  let completed = false
  try {
    await withTempDir('speechedit-', async (dir) => {
      throwIfAborted(signal, 'export')
      const parts: string[] = []
      for (let i = 0; i < job.segments.length; i++) {
        throwIfAborted(signal, 'export')
        const seg = job.segments[i]
        const part = join(dir, `p${i}.mp4`)
        parts.push(part)
        let filters
        try {
          filters = buildSegmentFilters(graphJob, seg, i)
        } catch (err) {
          throw new Error(explainGraphBuildError(err))
        }
        const stage = `encoding clip ${i + 1}/${job.segments.length}`
        await runFfmpeg(
          [
            '-y',
            '-noautorotate',
            '-ss',
            seg.start.toFixed(3),
            '-to',
            seg.end.toFixed(3),
            '-i',
            job.input,
            '-vf',
            filters.vf,
            '-af',
            filters.af,
            '-t',
            filters.duration.toFixed(3),
            ...videoEncodeArgs(encoder),
            ...audioEncodeArgs(),
            part
          ],
          (seconds) => {
            const inner = Math.min(1, seconds / Math.max(0.01, filters.duration))
            onProgress?.({
              ratio: ((i + inner) / (job.segments.length + 2)) * 0.72,
              stage
            })
          },
          signal
        )
        onProgress?.({ ratio: ((i + 1) / (job.segments.length + 2)) * 0.72, stage })
      }
      const body = await joinParts(dir, parts, job, encoder, onProgress, signal)
      onProgress?.({ ratio: 0.82, stage: mix.notes.length ? `mixing ${mix.notes.join(', ')}` : 'writing program' })

      const args = ['-y', '-i', body]
      for (const input of mix.inputs) args.push(...input.args)
      if (mix.filterComplex) {
        args.push('-filter_complex', mix.filterComplex, '-map', mix.mapVideo, '-map', mix.mapAudio)
        if (mix.encodeVideo) args.push(...videoEncodeArgs(encoder))
        else args.push('-c:v', 'copy')
        if (mix.encodeAudio) args.push(...audioEncodeArgs())
        else args.push('-c:a', 'copy')
      } else {
        if (mix.simpleAudio) args.push('-af', mix.simpleAudio)
        args.push('-c:v', 'copy')
        if (mix.encodeAudio) args.push(...audioEncodeArgs())
        else args.push('-c:a', 'copy')
      }
      args.push('-t', duration.toFixed(3), job.output)
      wroteOutput = true
      await runFfmpeg(
        args,
        (seconds) => {
          onProgress?.({
            ratio: 0.82 + Math.min(0.18, (seconds / Math.max(0.01, duration)) * 0.18),
            stage: mix.notes.length ? `mixing ${mix.notes.join(', ')}` : 'writing program'
          })
        },
        signal
      )
      completed = true
      onProgress?.({ ratio: 1, stage: 'done' })
    })
  } catch (err) {
    if (wroteOutput && !completed && job.output) {
      await rm(job.output, { force: true }).catch(() => undefined)
    }
    throw err
  }
}

export async function exportCut(
  job: {
    input: string
    output: string
    segments: { start: number; end: number }[]
    fps: number
    width: number
    height: number
  },
  onProgress?: (info: ExportProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  await exportProgram(
    {
      ...job,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      segments: job.segments.map((s) => ({
        ...s,
        speed: 1,
        scale: 1,
        x: 0,
        y: 0,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        overlapNext: 0
      })),
      layers: []
    },
    onProgress,
    signal
  )
}

export async function thumbnails(file: string, count = 20, signal?: AbortSignal): Promise<string[]> {
  throwIfAborted(signal, 'import')
  const cache = thumbsCachePath(file)
  const hit = await readJsonCache<{ v: number; count: number; thumbs: string[] }>(cache)
  if (hit?.v === 1 && hit.count === count && Array.isArray(hit.thumbs)) {
    return hit.thumbs
  }
  const info = await probe(file, signal)
  if (!info.hasVideo || info.duration < 0.2) {
    void writeJsonCache(cache, { v: 1, count, thumbs: [] }).catch(() => undefined)
    return []
  }
  try {
    return await withTempDir('speechedit-thumbs-', async (dir) => {
      throwIfAborted(signal, 'import')
      const fps = Math.max(0.05, count / Math.max(1, info.duration))
      await runStrict(
        'ffmpeg',
        [
          '-y',
          '-noautorotate',
          '-i',
          file,
          '-vf',
          [...transposeFilters(info.rotation), `fps=${fps.toFixed(3)}`, 'scale=160:90:force_original_aspect_ratio=increase', 'crop=160:90'].join(','),
          '-frames:v',
          String(count),
          '-q:v',
          '6',
          join(dir, 't%03d.jpg')
        ],
        signal,
        'import'
      )
      const names = (await readdir(dir)).filter((n) => n.endsWith('.jpg')).sort()
      const out: string[] = []
      for (const name of names) {
        const buf = await readFile(join(dir, name))
        out.push(`data:image/jpeg;base64,${buf.toString('base64')}`)
      }
      if (out.length) await writeJsonCache(cache, { v: 1, count, thumbs: out }).catch(() => undefined)
      return out
    })
  } catch (err) {
    if (isJobCancelled(err)) throw err
    return []
  }
}

export async function completeChat(
  opts: ModelEndpointOpts,
  messages: { role: string; content: string }[]
): Promise<string> {
  if (!opts.baseUrl || !opts.model) throw new Error('Intelligence endpoint is not configured.')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`
  const res = await fetch(`${opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: opts.model,
      messages,
      temperature: 0.2,
      response_format: { type: 'json_object' }
    })
  })
  if (!res.ok) throw new Error(`Model ${res.status}: ${(await res.text()).slice(0, 240)}`)
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('Model returned an empty reply.')
  return text
}
