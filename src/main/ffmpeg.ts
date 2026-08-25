import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  }[]
}

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

function escapeDrawtext(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "’").replace(/:/g, '\\:').replace(/%/g, '\\%')
}

function atempoChain(speed: number): string {
  const filters: string[] = []
  let remain = speed
  while (remain > 2.0001) {
    filters.push('atempo=2.0')
    remain /= 2
  }
  while (remain < 0.499) {
    filters.push('atempo=0.5')
    remain /= 0.5
  }
  filters.push(`atempo=${remain.toFixed(3)}`)
  return filters.join(',')
}

function even(n: number): number {
  return Math.max(2, n - (n % 2))
}

function jobDuration(job: ProgramExportJob): number {
  if (job.duration && job.duration > 0) return job.duration
  let t = 0
  for (const seg of job.segments) {
    const duration = (seg.end - seg.start) / Math.max(0.1, seg.speed)
    t += duration - (seg.overlapNext ?? 0)
  }
  return Math.max(0.01, t)
}

async function joinParts(
  dir: string,
  parts: string[],
  job: ProgramExportJob,
  encoder: string
): Promise<string> {
  const body = join(dir, 'body.mp4')
  if (parts.length === 1) {
    await runStrict('ffmpeg', ['-y', '-i', parts[0], '-c', 'copy', body])
    return body
  }
  const hasDissolve = job.segments.some((s) => (s.overlapNext ?? 0) > 0.04)
  if (!hasDissolve) {
    const concatList = join(dir, 'list.txt')
    await writeFile(concatList, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
    await runStrict('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', body])
    return body
  }

  const starts: number[] = []
  let cursor = 0
  for (const seg of job.segments) {
    starts.push(cursor)
    const duration = (seg.end - seg.start) / Math.max(0.1, seg.speed)
    cursor += duration - (seg.overlapNext ?? 0)
  }
  const args = ['-y']
  for (const part of parts) args.push('-i', part)
  const filters: string[] = []
  let v = '[0:v]'
  let a = '[0:a]'
  for (let i = 1; i < parts.length; i++) {
    const overlap = job.segments[i - 1]?.overlapNext ?? 0
    const nextV = i === parts.length - 1 ? '[vout]' : `[v${i}]`
    const nextA = i === parts.length - 1 ? '[aout]' : `[a${i}]`
    if (overlap > 0.04) {
      filters.push(
        `${v}[${i}:v]xfade=transition=fade:duration=${overlap.toFixed(3)}:offset=${starts[i].toFixed(3)}${nextV}`
      )
      filters.push(`${a}[${i}:a]acrossfade=d=${overlap.toFixed(3)}${nextA}`)
    } else {
      filters.push(`${v}[${i}:v]${a}[${i}:a]concat=n=2:v=1:a=1${nextV}${nextA}`)
    }
    v = nextV
    a = nextA
  }
  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    v,
    '-map',
    a,
    ...videoEncodeArgs(encoder),
    ...audioEncodeArgs(),
    body
  )
  await runStrict('ffmpeg', args)
  return body
}

export async function exportProgram(
  job: ProgramExportJob,
  onProgress?: (ratio: number) => void
): Promise<void> {
  if (!job.segments.length) throw new Error('Nothing to export — the timeline is empty.')
  const encoder = await resolveEncoder(job.encoder)
  const dir = await mkdtemp(join(tmpdir(), 'speechedit-'))
  try {
    const parts: string[] = []
    for (let i = 0; i < job.segments.length; i++) {
      const seg = job.segments[i]
      const part = join(dir, `p${i}.mp4`)
      parts.push(part)
      const scale = Math.max(0.2, seg.scale)
      const zoomW = even(Math.round(job.width * scale))
      const zoomH = even(Math.round(job.height * scale))
      const x = Math.round(job.width / 2 - zoomW / 2 + seg.x)
      const y = Math.round(job.height / 2 - zoomH / 2 + seg.y)
      const overlap = seg.overlapNext ?? 0
      const vfade: string[] = []
      if (overlap <= 0.04 && seg.fadeIn > 0.02) vfade.push(`fade=t=in:st=0:d=${seg.fadeIn.toFixed(2)}`)
      if (overlap <= 0.04 && seg.fadeOut > 0.02) {
        const dur = (seg.end - seg.start) / Math.max(0.1, seg.speed)
        vfade.push(`fade=t=out:st=${Math.max(0, dur - seg.fadeOut).toFixed(2)}:d=${seg.fadeOut.toFixed(2)}`)
      }
      const vf = [
        `scale=${zoomW}:${zoomH}:force_original_aspect_ratio=increase`,
        `crop=${job.width}:${job.height}:${x}:${y}`,
        ...vfade,
        `fps=${job.fps}`
      ].join(',')
      const af = [
        `volume=${(job.volume * seg.volume).toFixed(3)}`,
        `aformat=sample_fmts=fltp:channel_layouts=stereo`,
        seg.speed !== 1 ? atempoChain(seg.speed) : ''
      ]
        .filter(Boolean)
        .join(',')
      await runStrict('ffmpeg', [
        '-y',
        '-ss',
        seg.start.toFixed(3),
        '-to',
        seg.end.toFixed(3),
        '-i',
        job.input,
        '-vf',
        vf,
        '-af',
        af || 'anull',
        ...videoEncodeArgs(encoder),
        ...audioEncodeArgs(),
        part
      ])
      onProgress?.((i + 0.5) / (job.segments.length + 2))
    }
    const body = await joinParts(dir, parts, job, encoder)
    onProgress?.(0.8)

    const images = job.layers.filter((l) => l.kind === 'image' && l.path)
    const blurs = job.layers.filter((l) => l.kind === 'blur')
    const texts = job.layers.filter((l) => l.kind !== 'image' && l.kind !== 'blur' && l.text)
    const duration = jobDuration(job)
    const af: string[] = []
    if (job.eqLow) af.push(`equalizer=f=120:t=q:w=0.8:g=${job.eqLow.toFixed(1)}`)
    if (job.eqMid) af.push(`equalizer=f=1000:t=q:w=0.8:g=${job.eqMid.toFixed(1)}`)
    if (job.eqHigh) af.push(`equalizer=f=8000:t=q:w=0.7:g=${job.eqHigh.toFixed(1)}`)
    if (job.compress) af.push('acompressor=threshold=-18dB:ratio=3:attack=15:release=180:makeup=2')
    if (job.duck && job.duckWindows?.length) {
      const enable = job.duckWindows
        .map((w) => `between(t,${w.start.toFixed(3)},${w.end.toFixed(3)})`)
        .join('+')
      af.push(`volume=${(1 - job.duck).toFixed(2)}:enable='${enable}'`)
    }
    if (job.normalize) af.push('loudnorm=I=-16:TP=-1.5:LRA=11')
    if (job.fadeIn > 0.02) af.push(`afade=t=in:st=0:d=${job.fadeIn.toFixed(2)}`)
    if (job.fadeOut > 0.02) {
      af.push(`afade=t=out:st=${Math.max(0, duration - job.fadeOut).toFixed(2)}:d=${job.fadeOut.toFixed(2)}`)
    }

    const beds = (job.beds ?? []).filter((b) => b.path && b.volume > 0.001)
    const args = ['-y', '-i', body]
    for (const layer of images) args.push('-i', layer.path!)
    for (const bed of beds) args.push('-i', bed.path)
    const filters: string[] = []
    let last = '[0:v]'
    blurs.forEach((layer, i) => {
      const bw = even(Math.round(job.width * Math.max(0.12, layer.scale)))
      const bh = even(Math.round(bw * 0.62))
      const bx = Math.max(0, Math.min(job.width - bw, Math.round((job.width - bw) / 2 + layer.x)))
      const by = Math.max(0, Math.min(job.height - bh, Math.round((job.height - bh) / 2 + layer.y)))
      const src = `blur${i}s`
      const tag = `blur${i}`
      filters.push(`${last}split[${src}keep][${src}src]`)
      filters.push(`[${src}src]crop=${bw}:${bh}:${bx}:${by},boxblur=24:4[${src}]`)
      filters.push(
        `[${src}keep][${src}]overlay=${bx}:${by}:enable='between(t,${layer.start.toFixed(3)},${layer.end.toFixed(3)})'[${tag}]`
      )
      last = `[${tag}]`
    })
    images.forEach((layer, i) => {
      const w = even(Math.round(job.width * Math.max(0.15, layer.scale)))
      const x = Math.round((job.width - w) / 2 + layer.x)
      const y = Math.round(80 + layer.y)
      const tag = `ov${i}`
      filters.push(`[${i + 1}:v]scale=${w}:-1[${tag}s]`)
      filters.push(
        `${last}[${tag}s]overlay=${x}:${y}:enable='between(t,${layer.start.toFixed(3)},${layer.end.toFixed(3)})'[${tag}]`
      )
      last = `[${tag}]`
    })
    if (texts.length) {
      const draw = texts
        .map((layer) => {
          const y =
            layer.kind === 'caption'
              ? `h-th-80+${Math.round(layer.y)}`
              : `${Math.round(80 + layer.y)}`
          return `drawtext=text='${escapeDrawtext(layer.text)}':fontsize=${Math.round(layer.fontSize * layer.scale)}:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2+${Math.round(layer.x)}:y=${y}:enable='between(t,${layer.start.toFixed(3)},${layer.end.toFixed(3)})'`
        })
        .join(',')
      filters.push(`${last}${draw}[vout]`)
      last = '[vout]'
    }

    const videoGraph = filters.length > 0
    if (beds.length || (af.length && videoGraph)) {
      const voice = beds.length ? 'a0' : 'aout'
      filters.push(af.length ? `[0:a]${af.join(',')}[${voice}]` : `[0:a]anull[${voice}]`)
      if (beds.length) {
        const bedOffset = 1 + images.length
        beds.forEach((bed, i) => {
          const delay = Math.max(0, Math.round(bed.start * 1000))
          const parts = [
            `atrim=start=${bed.inPoint.toFixed(3)}:duration=${Math.max(0.05, bed.duration).toFixed(3)}`,
            'asetpts=PTS-STARTPTS',
            `volume=${bed.volume.toFixed(3)}`
          ]
          if (bed.fadeIn > 0.02) parts.push(`afade=t=in:st=0:d=${bed.fadeIn.toFixed(2)}`)
          if (bed.fadeOut > 0.02) {
            parts.push(
              `afade=t=out:st=${Math.max(0, bed.duration - bed.fadeOut).toFixed(2)}:d=${bed.fadeOut.toFixed(2)}`
            )
          }
          parts.push(`adelay=${delay}|${delay}:all=1`)
          filters.push(`[${bedOffset + i}:a]${parts.join(',')}[bed${i}]`)
        })
        const mix = ['[a0]', ...beds.map((_, i) => `[bed${i}]`)].join('')
        filters.push(
          `${mix}amix=inputs=${1 + beds.length}:duration=first:dropout_transition=0:normalize=0[aout]`
        )
      }
    }

    const audioGraph = filters.some((f) => f.includes('[aout]'))
    if (filters.length) {
      args.push('-filter_complex', filters.join(';'), '-map', videoGraph ? last : '0:v', '-map', audioGraph ? '[aout]' : '0:a?')
      if (videoGraph) args.push(...videoEncodeArgs(encoder))
      else args.push('-c:v', 'copy')
      if (audioGraph || af.length) args.push(...audioEncodeArgs())
      else args.push('-c:a', 'copy')
    } else {
      if (af.length) args.push('-af', af.join(','))
      args.push('-c:v', 'copy')
      if (af.length) args.push(...audioEncodeArgs())
      else args.push('-c:a', 'copy')
    }
    args.push(job.output)
    await runStrict('ffmpeg', args)
    onProgress?.(1)
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
  onProgress?: (ratio: number) => void
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

function cueSpeaker(raw: {
  speaker?: string
  speaker_id?: string
  speaker_label?: string
}): string | undefined {
  const value = raw.speaker ?? raw.speaker_id ?? raw.speaker_label
  return value ? String(value) : undefined
}

export async function transcribe(file: string): Promise<
  { text: string; start: number; end: number; speaker?: string }[] | null
> {
  const binaries = ['whisper', 'whisper-ctranslate2', 'faster-whisper']
  for (const bin of binaries) {
    try {
      const out = await run(bin, [file, '--output_format', 'json', '--output_dir', tmpdir()])
      const match = out.match(/\{[\s\S]*"segments"[\s\S]*\}/)
      if (!match) continue
      const json = JSON.parse(match[0]) as {
        words?: { word?: string; text?: string; start: number; end: number; speaker?: string }[]
        segments?: {
          start: number
          end: number
          text: string
          speaker?: string
          words?: { word: string; start: number; end: number; speaker?: string }[]
        }[]
      }
      if (json.words?.length) {
        return json.words
          .map((w) => ({
            text: String(w.word ?? w.text ?? '').trim(),
            start: w.start,
            end: w.end,
            speaker: cueSpeaker(w)
          }))
          .filter((w) => w.text)
      }
      const words = json.segments?.flatMap((s) =>
        s.words?.length
          ? s.words.map((w) => ({
              text: w.word.trim(),
              start: w.start,
              end: w.end,
              speaker: cueSpeaker(w) ?? cueSpeaker(s)
            }))
          : [{ text: s.text.trim(), start: s.start, end: s.end, speaker: cueSpeaker(s) }]
      )
      if (words?.length) return words.filter((w) => w.text)
    } catch {
      continue
    }
  }
  return null
}

export interface ModelEndpointOpts {
  kind?: string
  baseUrl?: string
  model?: string
  apiKey?: string
}

export async function transcribeMedia(
  file: string,
  opts?: ModelEndpointOpts
): Promise<{ text: string; start: number; end: number; speaker?: string }[] | null> {
  if (opts?.kind === 'openai-compatible' && opts.baseUrl && opts.model) {
    const dir = await mkdtemp(join(tmpdir(), 'speechedit-asr-'))
    const wav = join(dir, 'a.wav')
    try {
      await runStrict('ffmpeg', ['-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', wav])
      const buf = await readFile(wav)
      const blob = new Blob([buf], { type: 'audio/wav' })
      const body = new FormData()
      body.append('file', blob, 'audio.wav')
      body.append('model', opts.model)
      body.append('response_format', 'verbose_json')
      body.append('timestamp_granularities[]', 'word')
      const headers: Record<string, string> = {}
      if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`
      const res = await fetch(`${opts.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers,
        body
      })
      if (!res.ok) throw new Error(`Transcribe ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const data = (await res.json()) as {
        words?: { word?: string; text?: string; start: number; end: number; speaker?: string }[]
        segments?: {
          text: string
          start: number
          end: number
          speaker?: string
          words?: { word: string; start: number; end: number; speaker?: string }[]
        }[]
      }
      if (data.words?.length) {
        return data.words
          .map((w) => ({
            text: String(w.word ?? w.text ?? '').trim(),
            start: w.start,
            end: w.end,
            speaker: cueSpeaker(w)
          }))
          .filter((w) => w.text)
      }
      return (
        data.segments?.flatMap((seg) =>
          seg.words?.length
            ? seg.words.map((w) => ({
                text: w.word.trim(),
                start: w.start,
                end: w.end,
                speaker: cueSpeaker(w) ?? cueSpeaker(seg)
              }))
            : [{ text: seg.text.trim(), start: seg.start, end: seg.end, speaker: cueSpeaker(seg) }]
        ) ?? []
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  return transcribe(file)
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
