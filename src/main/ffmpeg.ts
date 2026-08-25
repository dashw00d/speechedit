import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
}

export interface SilenceGap {
  start: number
  end: number
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 || cmd === 'ffmpeg') resolve(cmd === 'ffprobe' ? stdout : stderr + stdout)
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-400)}`))
    })
  })
}

function runStrict(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(cmd === 'ffprobe' ? stdout : stderr + stdout)
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`))
    })
  })
}

function parseFfmpegTime(line: string): number | null {
  const m = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

function runFfmpeg(args: string[], onTime?: (seconds: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const onChunk = (d: Buffer) => {
      const text = d.toString()
      stderr += text
      if (!onTime) return
      for (const line of text.split(/\r|\n/)) {
        const t = parseFfmpegTime(line)
        if (t != null) onTime(t)
      }
    }
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', onChunk)
    child.on('error', (err) =>
      reject(new Error(`FFmpeg did not start (${err.message}). Install ffmpeg 4.4+ and keep it on PATH.`))
    )
    child.on('close', (code) => {
      if (code === 0) resolve(stderr + stdout)
      else reject(new Error(explainExportError(stderr)))
    })
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

export async function probe(file: string): Promise<ProbeResult> {
  const raw = await run('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    file
  ])
  const json = JSON.parse(raw) as {
    format?: { duration?: string }
    streams?: Array<{
      codec_type?: string
      codec_name?: string
      width?: number
      height?: number
      avg_frame_rate?: string
      sample_rate?: string
    }>
  }
  const video = json.streams?.find((s) => s.codec_type === 'video')
  const audio = json.streams?.find((s) => s.codec_type === 'audio')
  const [num, den] = (video?.avg_frame_rate ?? '0/1').split('/').map(Number)
  return {
    duration: Number(json.format?.duration ?? 0),
    width: video?.width,
    height: video?.height,
    fps: den ? num / den : undefined,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : undefined,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    codec: video?.codec_name ?? audio?.codec_name
  }
}

export async function waveform(file: string, samples = 1800): Promise<number[]> {
  const args = ['-i', file, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1']
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args])
    const chunks: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => chunks.push(d))
    child.on('error', reject)
    child.on('close', (code) => {
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
      resolve(out)
    })
  })
}

export async function detectSilence(file: string, threshold = '-30dB', min = 0.35): Promise<SilenceGap[]> {
  const text = await run('ffmpeg', [
    '-i',
    file,
    '-af',
    `silencedetect=n=${threshold}:d=${min}`,
    '-f',
    'null',
    '-'
  ])
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

export async function detectScenes(file: string): Promise<{ times: number[]; staticRegions: SilenceGap[] }> {
  const text = await run('ffmpeg', [
    '-i',
    file,
    '-vf',
    "select='gt(scene,0.22)',showinfo",
    '-f',
    'null',
    '-'
  ])
  const times: number[] = []
  for (const line of text.split('\n')) {
    const hit = line.match(/pts_time:([\d.]+)/)
    if (hit) times.push(Number(hit[1]))
  }
  const info = await probe(file)
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
  file: string
): Promise<{ start: number; end: number; lufs: number }[]> {
  const text = await run('ffmpeg', ['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'])
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

function asGraphJob(job: ProgramExportJob): GraphJob {
  return job
}

async function joinParts(
  dir: string,
  parts: string[],
  job: ProgramExportJob,
  encoder: string,
  onProgress?: (info: ExportProgress) => void
): Promise<string> {
  const body = join(dir, 'body.mp4')
  if (parts.length === 1) {
    await runFfmpeg(['-y', '-i', parts[0], '-c', 'copy', body])
    return body
  }
  const joinGraph = buildJoinGraph(asGraphJob(job), parts.length)
  if (!joinGraph) {
    const concatList = join(dir, 'list.txt')
    await writeFile(concatList, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', body])
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
  await runFfmpeg(args, (seconds) => {
    onProgress?.({
      ratio: 0.72 + Math.min(0.1, (seconds / Math.max(0.01, total)) * 0.1),
      stage: 'joining dissolves'
    })
  })
  return body
}

export async function exportProgram(
  job: ProgramExportJob,
  onProgress?: (info: ExportProgress) => void
): Promise<void> {
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
  onProgress?.({ ratio: 0, stage: summarizeJob(graphJob, mix) })
  const encoder = await resolveEncoder(job.encoder)
  const dir = await mkdtemp(join(tmpdir(), 'speechedit-'))
  const duration = jobDuration(graphJob)
  try {
    const parts: string[] = []
    for (let i = 0; i < job.segments.length; i++) {
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
        }
      )
      onProgress?.({ ratio: ((i + 1) / (job.segments.length + 2)) * 0.72, stage })
    }
    const body = await joinParts(dir, parts, job, encoder, onProgress)
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
    await runFfmpeg(args, (seconds) => {
      onProgress?.({
        ratio: 0.82 + Math.min(0.18, (seconds / Math.max(0.01, duration)) * 0.18),
        stage: mix.notes.length ? `mixing ${mix.notes.join(', ')}` : 'writing program'
      })
    })
    onProgress?.({ ratio: 1, stage: 'done' })
  } finally {
    await rm(dir, { recursive: true, force: true })
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
  onProgress?: (info: ExportProgress) => void
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
    onProgress
  )
}

export async function thumbnails(file: string, count = 20): Promise<string[]> {
  const info = await probe(file)
  if (!info.hasVideo || info.duration < 0.2) return []
  const dir = await mkdtemp(join(tmpdir(), 'speechedit-thumbs-'))
  try {
    const fps = Math.max(0.05, count / Math.max(1, info.duration))
    await runStrict('ffmpeg', [
      '-y',
      '-i',
      file,
      '-vf',
      `fps=${fps.toFixed(3)},scale=160:90:force_original_aspect_ratio=increase,crop=160:90`,
      '-frames:v',
      String(count),
      '-q:v',
      '6',
      join(dir, 't%03d.jpg')
    ])
    const names = (await readdir(dir)).filter((n) => n.endsWith('.jpg')).sort()
    const out: string[] = []
    for (const name of names) {
      const buf = await readFile(join(dir, name))
      out.push(`data:image/jpeg;base64,${buf.toString('base64')}`)
    }
    return out
  } catch {
    return []
  } finally {
    await rm(dir, { recursive: true, force: true })
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
