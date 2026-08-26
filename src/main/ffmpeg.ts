import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { analysisCachePath, peaksCachePath, readJsonCache, thumbsCachePath, writeJsonCache } from './mediaCache'
import {
  assertProgramGraph,
  buildProgramGraph,
  encoderFallback,
  programReadArgs,
  explainExportError,
  explainGraphBuildError,
  PROGRAM_GRAPH_SCRIPT,
  summarizeJob,
  validateExportJob,
  type GraphJob
} from '../renderer/src/lib/exportGraph'
import {
  ANALYSIS_CACHE_VERSION,
  LOOK_LANE_LIMIT,
  WorkLane,
  audioLookArgs,
  loudnessDetectArgs,
  parseLoudnessLog,
  parseSilenceLog,
  sceneDetectArgs,
  silenceDetectArgs,
  thumbPassArgs,
  thumbSeekArgs,
  thumbSeekTimes,
  wantsSeekThumbs,
  WAVEFORM_SAMPLES,
  waveformLookArgs,
} from '../shared/importLooks'
import { JobCancelled, isJobCancelled, throwIfAborted, type MediaJobKind } from '../shared/mediaJob'
import { parseStreamRotation, transposeFilters, type QuarterTurn } from '../shared/mediaOrient'
import {
  estimateGopFromFlags,
  isVariableFrameRate,
  proxyCacheMatchesSource,
  proxyGopSeekable,
  proxyVideoArgs
} from '../shared/proxy'
import { killChild, runChild, withTempDir } from './childJob'
import { mediaToolMissingMessage, mediaToolPath, type MediaTool } from './mediaTools'
import { completeCliModel, inspectCliModel, isCliModelKind } from './modelCli'
import type { ModelEndpointOpts } from './transcribe'

export type { ModelEndpointOpts, TranscribeProgress } from './transcribe'
export { listAsrPath, transcribe, transcribeMedia } from './transcribe'

export interface EncoderOption {
  id: string
  label: string
  hardware: boolean
}

export type ProgramExportJob = GraphJob

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

const FFMPEG_MISSING = mediaToolMissingMessage('ffmpeg')

/** Waveform, thumbs, silence, scenes, and loudness share this. Proxy and Whisper do not. */
export const importLookLane = new WorkLane(LOOK_LANE_LIMIT)

function toolMissing(cmd: string): string {
  if (cmd === 'ffmpeg' || cmd === 'ffprobe') return mediaToolMissingMessage(cmd, mediaToolPath(cmd))
  return `${cmd} did not start. Install it and keep it on PATH.`
}

function resolvedTool(cmd: string): string {
  return cmd === 'ffmpeg' || cmd === 'ffprobe' ? mediaToolPath(cmd as MediaTool) : cmd
}

function run(cmd: string, args: string[], signal?: AbortSignal, kind?: MediaJobKind): Promise<string> {
  return runChild(resolvedTool(cmd), args, {
    signal,
    kind,
    allowFailure: cmd === 'ffmpeg',
    missing: toolMissing(cmd)
  })
}

function runStrict(cmd: string, args: string[], signal?: AbortSignal, kind?: MediaJobKind): Promise<string> {
  return runChild(resolvedTool(cmd), args, { signal, kind, missing: toolMissing(cmd) })
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
  const command = mediaToolPath('ffmpeg')
  return runChild(command, args, {
    signal,
    kind,
    missing: mediaToolMissingMessage('ffmpeg', command),
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

export function proxyPartialPath(output: string): string {
  return `${output}.${process.pid}.partial.mp4`
}

/** Keyframe interval from the first ~2.5s of packets. Hour-scale files stay a cheap demux. */
export async function probeProxyGop(file: string, signal?: AbortSignal): Promise<number> {
  throwIfAborted(signal, 'import')
  if (!file || !existsSync(file)) return 0
  const raw = await run(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-read_intervals',
      '%+2.5',
      '-show_entries',
      'packet=flags',
      '-of',
      'csv=p=0',
      file
    ],
    signal,
    'import'
  )
  const flags = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return estimateGopFromFlags(flags)
}

export async function makeProxy(file: string, output: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal, 'import')
  if (!file) throw new Error('Pick a media file to import.')
  if (!existsSync(file)) {
    throw new Error(`Can't open that recording:\n${file}\nPick a real media file.`)
  }
  await mkdir(dirname(output), { recursive: true })
  const info = await probe(file, signal)
  if (existsSync(output)) {
    const cached = await probe(output, signal).catch(() => null)
    const gop = cached?.hasVideo ? await probeProxyGop(output, signal).catch(() => 0) : 0
    if (
      cached?.hasVideo &&
      proxyCacheMatchesSource(info.duration, cached.duration) &&
      proxyGopSeekable(gop)
    ) {
      return output
    }
    await rm(output, { force: true }).catch(() => undefined)
  }
  const tmp = proxyPartialPath(output)
  await rm(tmp, { force: true }).catch(() => undefined)
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
    ...proxyVideoArgs(info.fps),
    '-movflags',
    '+faststart'
  ]
  if (info.hasAudio) args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2')
  else args.push('-an')
  args.push('-f', 'mp4', tmp)
  try {
    await runStrict('ffmpeg', args, signal, 'import')
    await rm(output, { force: true }).catch(() => undefined)
    await rename(tmp, output)
    return output
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
}

function windowPeaks(floats: Float32Array, windows: number): number[] {
  const count = Math.max(1, windows)
  if (!floats.length) return Array.from({ length: count }, () => 0)
  const size = Math.max(1, Math.floor(floats.length / count))
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    let peak = 0
    const start = i * size
    const end = i === count - 1 ? floats.length : Math.min(floats.length, start + size)
    for (let j = start; j < end; j++) peak = Math.max(peak, Math.abs(floats[j] ?? 0))
    out.push(Math.min(1, peak))
  }
  return out
}

function ffmpegPcm(args: string[], signal?: AbortSignal): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const command = mediaToolPath('ffmpeg')
    const child = spawn(command, args)
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
        else reject(new Error(mediaToolMissingMessage('ffmpeg', command) + ` (${err.message})`))
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
        resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)))
      })
    })
  })
}

async function decodeWaveform(file: string, samples: number, signal?: AbortSignal): Promise<number[]> {
  const floats = await importLookLane.run(() => ffmpegPcm(waveformLookArgs(file), signal), signal, 'import')
  return windowPeaks(floats, samples)
}

export async function waveform(
  file: string,
  samples = WAVEFORM_SAMPLES,
  signal?: AbortSignal
): Promise<number[]> {
  throwIfAborted(signal, 'import')
  const cache = peaksCachePath(file)
  const hit = await readJsonCache<{ v: number; samples: number; peaks: number[] }>(cache)
  if (hit?.v === 1 && hit.samples === samples && Array.isArray(hit.peaks) && hit.peaks.length) {
    return hit.peaks
  }
  const peaks = await decodeWaveform(file, samples, signal)
  await writeJsonCache(cache, { v: 1, samples, peaks }).catch(() => undefined)
  return peaks
}

async function lookDuration(file: string, signal?: AbortSignal): Promise<number> {
  try {
    return (await probe(file, signal)).duration
  } catch (err) {
    if (isJobCancelled(err)) throw err
    return 0
  }
}

export async function detectSilence(
  file: string,
  threshold = '-30dB',
  min = 0.35,
  signal?: AbortSignal
): Promise<SilenceGap[]> {
  const duration = await lookDuration(file, signal)
  const text = await importLookLane.run(
    () => run('ffmpeg', silenceDetectArgs(file, threshold, min, duration), signal, 'import'),
    signal,
    'import'
  )
  return parseSilenceLog(text)
}

export async function detectScenes(
  file: string,
  signal?: AbortSignal
): Promise<{ times: number[]; staticRegions: SilenceGap[] }> {
  const info = await probe(file, signal)
  if (!info.hasVideo) return { times: [], staticRegions: [] }
  const text = await importLookLane.run(
    () => run('ffmpeg', sceneDetectArgs(file, info), signal, 'import'),
    signal,
    'import'
  )
  const times: number[] = []
  for (const line of text.split('\n')) {
    const hit = line.match(/pts_time:([\d.]+)/)
    if (hit) times.push(Number(hit[1]))
  }
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
  const duration = await lookDuration(file, signal)
  const text = await importLookLane.run(
    () => run('ffmpeg', loudnessDetectArgs(file, duration), signal, 'import'),
    signal,
    'import'
  )
  return parseLoudnessLog(text)
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
  if (hit?.v === ANALYSIS_CACHE_VERSION && Array.isArray(hit.silence) && hit.scenes && Array.isArray(hit.loudness)) {
    onProgress?.({ stage: 'done', ratio: 1 })
    return { silence: hit.silence, scenes: hit.scenes, loudness: hit.loudness }
  }
  onProgress?.({ stage: 'analyze', ratio: 0.2 })
  const duration = await lookDuration(file, signal)
  const scenesP = detectScenes(file, signal).catch((err) => {
    if (isJobCancelled(err)) throw err
    return { times: [], staticRegions: [] }
  })
  let silence: SilenceGap[]
  let loudness: CachedAnalysis['loudness']
  try {
    const audioText = await importLookLane.run(
      () => run('ffmpeg', audioLookArgs(file, { duration }), signal, 'import'),
      signal,
      'import'
    )
    silence = parseSilenceLog(audioText)
    loudness = parseLoudnessLog(audioText)
  } catch (err) {
    if (isJobCancelled(err)) throw err
    silence = await detectSilence(file, '-30dB', 0.35, signal)
    loudness = await detectLoudness(file, signal).catch((loudErr) => {
      if (isJobCancelled(loudErr)) throw loudErr
      return []
    })
  }
  const scenes = await scenesP
  onProgress?.({ stage: 'done', ratio: 1 })
  await writeJsonCache(cache, { v: ANALYSIS_CACHE_VERSION, silence, scenes, loudness }).catch(() => undefined)
  return { silence, scenes, loudness }
}

function asGraphJob(job: ProgramExportJob): GraphJob {
  return job
}

export async function exportProgram(
  job: ProgramExportJob,
  onProgress?: (info: ExportProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal, 'export')
  if (!job.segments.length) throw new Error('Nothing to export — the timeline is empty.')
  const sourcePaths = [
    job.input,
    ...(job.inputs ?? []).map((row) => row.path)
  ].filter((path, i, all) => path && all.indexOf(path) === i)
  for (const path of sourcePaths) {
    if (!existsSync(path)) {
      throw new Error(`Recording is missing:\n${path}\nRelink the take and export again.`)
    }
  }
  if (!sourcePaths.length) {
    throw new Error('Recording is missing. Re-import the media and export again.')
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
  const fontFile = findExportFont()
  throwIfAborted(signal, 'export')
  let encoder = await resolveEncoder(job.encoder)
  throwIfAborted(signal, 'export')
  let program
  try {
    program = buildProgramGraph(graphJob, { fontFile })
    assertProgramGraph(program)
  } catch (err) {
    throw new Error(explainGraphBuildError(err))
  }
  const duration = program.duration
  const stage = program.notes.length
    ? `encoding program (${job.segments.length} keep${job.segments.length === 1 ? '' : 's'} · ${program.notes.join(', ')})`
    : `encoding program (${job.segments.length} keep${job.segments.length === 1 ? '' : 's'})`
  onProgress?.({ ratio: 0, stage: summarizeJob(graphJob, program) })
  let wroteOutput = false
  let completed = false

  const runEncoded = async (
    argsFor: (enc: string) => string[],
    onTime?: (seconds: number) => void
  ) => {
    try {
      await runFfmpeg(argsFor(encoder), onTime, signal)
    } catch (err) {
      const next = encoderFallback(encoder, err instanceof Error ? err.message : String(err))
      if (!next) throw err
      encoder = next
      onProgress?.({
        ratio: 0.72,
        stage: 'Hardware encoder failed. Finishing with x264 (CPU).'
      })
      await runFfmpeg(argsFor(encoder), onTime, signal)
    }
  }

  const runProgram = async (graphArgs: string[]) => {
    wroteOutput = true
    onProgress?.({ ratio: 0.04, stage })
    await runEncoded(
      (enc) => [
        '-y',
        ...programReadArgs(graphJob, program.extraInputs),
        ...graphArgs,
        ...(job.audioOnly
          ? ['-map', program.mapAudio, '-vn']
          : ['-map', program.mapVideo, '-map', program.mapAudio, ...videoEncodeArgs(enc)]),
        '-t',
        duration.toFixed(3),
        ...audioEncodeArgs(),
        job.output
      ],
      (seconds) => {
        onProgress?.({
          ratio: 0.04 + Math.min(0.96, (seconds / Math.max(0.01, duration)) * 0.96),
          stage
        })
      }
    )
  }

  try {
    if (program.filterComplex.length > PROGRAM_GRAPH_SCRIPT) {
      await withTempDir('speechedit-', async (dir) => {
        throwIfAborted(signal, 'export')
        const script = join(dir, 'program.ff')
        await writeFile(script, program.filterComplex, 'utf8')
        await runProgram(['-filter_complex_script', script])
      })
    } else {
      throwIfAborted(signal, 'export')
      await runProgram(['-filter_complex', program.filterComplex])
    }
    completed = true
    onProgress?.({ ratio: 1, stage: 'done' })
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

async function readThumbDataUrls(dir: string): Promise<string[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.jpg')).sort()
  const out: string[] = []
  for (const name of names) {
    const buf = await readFile(join(dir, name))
    out.push(`data:image/jpeg;base64,${buf.toString('base64')}`)
  }
  return out
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
      const out = await importLookLane.run(
        async () => {
          if (wantsSeekThumbs(info.duration, count)) {
            let i = 0
            for (const time of thumbSeekTimes(info.duration, count)) {
              throwIfAborted(signal, 'import')
              try {
                await runStrict(
                  'ffmpeg',
                  thumbSeekArgs(file, join(dir, `t${String(i).padStart(3, '0')}.jpg`), time, info.rotation),
                  signal,
                  'import'
                )
                i += 1
              } catch (err) {
                if (isJobCancelled(err)) throw err
              }
            }
          } else {
            const fps = Math.max(0.05, count / Math.max(1, info.duration))
            await runStrict('ffmpeg', thumbPassArgs(file, join(dir, 't%03d.jpg'), fps, count, info.rotation), signal, 'import')
          }
          return readThumbDataUrls(dir)
        },
        signal,
        'import'
      )
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
  if (isCliModelKind(opts.kind)) return completeCliModel(opts, messages)
  if (!opts.baseUrl || !opts.model) throw new Error('Intelligence endpoint is not configured.')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`
  const url = `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    temperature: 0.2,
    response_format: { type: 'json_object' }
  }
  let res = await modelFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }, 180_000)
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText)
    const formatRejected =
      (res.status === 400 || res.status === 422) && /response[_ -]?format|json_object/i.test(detail)
    if (!formatRejected) throw new Error(`Model ${res.status}: ${detail.slice(0, 240)}`)
    delete body.response_format
    res = await modelFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }, 180_000)
    if (!res.ok) throw new Error(`Model ${res.status}: ${(await res.text()).slice(0, 240)}`)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('Model returned an empty reply.')
  return text
}

export interface ChatModelInfo {
  id: string
  capabilities: string[]
  parameterSize?: string
  contextLength?: number
  remote?: boolean
  detail?: string
}

export interface ChatEndpointStatus {
  provider: 'ollama' | 'openai-compatible' | 'codex-cli' | 'grok-cli'
  models: ChatModelInfo[]
}

async function modelFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`Model timed out after ${Math.round(timeoutMs / 1000)} seconds.`)
    }
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach the model endpoint: ${detail}`)
  }
}

function modelHeaders(opts: ModelEndpointOpts): Record<string, string> {
  return opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}
}

function isOllamaUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return url.port === '11434' || /\bollama\b/i.test(url.hostname)
  } catch {
    return false
  }
}

/** Inspect the configured endpoint without loading a model into memory. */
export async function listChatModels(opts: ModelEndpointOpts): Promise<ChatEndpointStatus> {
  if (isCliModelKind(opts.kind)) {
    const cli = await inspectCliModel(opts)
    return {
      provider: opts.kind,
      models: [
        {
          id: cli.id,
          capabilities: ['completion', 'thinking', 'tools'],
          remote: true,
          detail: `${cli.label} · ${cli.version}`
        }
      ]
    }
  }
  if (!opts.baseUrl) throw new Error('Intelligence endpoint is not configured.')
  const baseUrl = opts.baseUrl.replace(/\/$/, '')
  const headers = modelHeaders(opts)
  const res = await modelFetch(`${baseUrl}/models`, { headers }, 12_000)
  if (!res.ok) throw new Error(`Model list ${res.status}: ${(await res.text()).slice(0, 240)}`)
  const payload = (await res.json()) as { data?: Array<{ id?: string }> }
  const generic = (payload.data ?? []).flatMap((model) =>
    typeof model.id === 'string' && model.id ? [{ id: model.id, capabilities: [] }] : []
  )
  if (!isOllamaUrl(baseUrl)) return { provider: 'openai-compatible', models: generic }

  try {
    const origin = new URL(baseUrl).origin
    const tagsRes = await modelFetch(`${origin}/api/tags`, { headers }, 12_000)
    if (!tagsRes.ok) return { provider: 'ollama', models: generic }
    const tags = (await tagsRes.json()) as {
      models?: Array<{
        name?: string
        remote_model?: string
        details?: { parameter_size?: string; context_length?: number }
        capabilities?: string[]
      }>
    }
    const models = (tags.models ?? []).flatMap((model) => {
      if (!model.name) return []
      return [
        {
          id: model.name,
          capabilities: Array.isArray(model.capabilities) ? model.capabilities : [],
          parameterSize: model.details?.parameter_size,
          contextLength: model.details?.context_length,
          remote: Boolean(model.remote_model)
        }
      ]
    })
    return { provider: 'ollama', models: models.length ? models : generic }
  } catch {
    return { provider: 'ollama', models: generic }
  }
}

/** Make a real structured completion so a listed-but-unusable model cannot appear healthy. */
export async function testChatEndpoint(
  opts: ModelEndpointOpts
): Promise<{ model: string; latencyMs: number; reply: string }> {
  const started = Date.now()
  const reply = await completeChat(opts, [
    { role: 'system', content: 'Return only a JSON object.' },
    { role: 'user', content: 'Return {"status":"SPEECHEDIT_MODEL_OK"}.' }
  ])
  try {
    const start = reply.indexOf('{')
    const end = reply.lastIndexOf('}')
    const parsed = JSON.parse(reply.slice(start, end + 1)) as { status?: unknown }
    if (parsed.status !== 'SPEECHEDIT_MODEL_OK') throw new Error('wrong status')
  } catch {
    throw new Error('Model replied, but failed the structured JSON test.')
  }
  const model =
    opts.model || (opts.kind === 'codex-cli' ? 'Codex CLI' : opts.kind === 'grok-cli' ? 'Grok CLI' : '')
  return { model, latencyMs: Date.now() - started, reply }
}
