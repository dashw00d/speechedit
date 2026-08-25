import { transposeFilters } from '../../../shared/mediaOrient'

/** FFmpeg 4.4-safe filter graph. Command-bus jobs from exportJob.ts are the render truth. */

export interface GraphSegment {
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
  opacity?: number
  rotation?: number
}

export interface GraphLayer {
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
}

export interface GraphBed {
  path: string
  start: number
  duration: number
  inPoint: number
  volume: number
  fadeIn: number
  fadeOut: number
  id?: string
}

export interface ProgrammedSegment extends GraphSegment {
  programStart: number
  programDuration: number
}

export interface GraphJob {
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
  beds?: GraphBed[]
  segments: GraphSegment[]
  layers: GraphLayer[]
}

export interface InputSpec {
  args: string[]
  role: 'image' | 'bed'
  path: string
}

export interface SegmentFilters {
  vf: string
  af: string
  duration: number
}

export interface JoinGraph {
  filterComplex: string
  mapVideo: string
  mapAudio: string
}

export interface MixGraph {
  inputs: InputSpec[]
  filterComplex: string
  mapVideo: string
  mapAudio: string
  encodeVideo: boolean
  encodeAudio: boolean
  simpleAudio: string
  notes: string[]
}

export function even(n: number): number {
  return Math.max(2, n - (n % 2))
}

export function programmedSegments(job: GraphJob): ProgrammedSegment[] {
  let cursor = 0
  return job.segments.map((seg) => {
    const programDuration = (seg.end - seg.start) / Math.max(0.1, seg.speed)
    const programStart = seg.programStart ?? cursor
    cursor = programStart + programDuration - (seg.overlapNext ?? 0)
    return { ...seg, programStart, programDuration }
  })
}

export function jobDuration(job: GraphJob): number {
  if (job.duration && job.duration > 0) return job.duration
  const segs = programmedSegments(job)
  const last = segs[segs.length - 1]
  return Math.max(0.01, last ? last.programStart + last.programDuration : 0)
}

/** Fades shorter than 0.02s are ignored by FFmpeg filters; preview uses the same gate. */
export function timedFade(local: number, duration: number, fadeIn: number, fadeOut: number): number {
  let g = 1
  if (fadeIn > 0.02 && local < fadeIn) g = Math.min(g, local / fadeIn)
  if (fadeOut > 0.02 && local > duration - fadeOut) g = Math.min(g, (duration - local) / fadeOut)
  return Math.max(0, Math.min(1, g))
}

export function ffmpegColor(color: string | undefined, fallback: string): string {
  const raw = (color ?? '').trim()
  const m = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return fallback
  let hex = m[1]
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  return `0x${hex.toUpperCase()}`
}

export function validateExportJob(
  job: GraphJob,
  opts?: { fontFile?: string | undefined }
): string | null {
  if (!job.segments.length) return 'Nothing to export — the timeline is empty.'
  if (!job.input) return 'Open media to export a program.'
  for (const [i, seg] of job.segments.entries()) {
    if (!Number.isFinite(seg.speed) || seg.speed < 0.25 || seg.speed > 8) {
      return `Clip ${i + 1} is ${seg.speed}×. Stay between 0.25× and 8×, then export again.`
    }
    if (!Number.isFinite(seg.start) || !Number.isFinite(seg.end) || seg.end <= seg.start) {
      return `Clip ${i + 1} has no length. Trim or restore it, then export again.`
    }
    const dur = (seg.end - seg.start) / Math.max(0.1, seg.speed)
    if ((seg.overlapNext ?? 0) > dur * 0.49) {
      return `The dissolve after clip ${i + 1} is longer than the clip. Shorten the dissolve and export again.`
    }
  }
  for (const bed of job.beds ?? []) {
    if (!bed.path) return 'A music bed is missing its file. Relink the bed and export again.'
  }
  for (const layer of job.layers) {
    if (layer.kind === 'image' && !layer.path) {
      return 'A B-roll or overlay still is missing its file. Relink it and export again.'
    }
  }
  if (opts && 'fontFile' in opts && textLayers(job).length && !opts.fontFile) {
    return 'Captions need a font FFmpeg can see. Install fonts-dejavu (Linux) or keep Arial installed, then export again.'
  }
  return null
}

export function explainGraphBuildError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/font/i.test(msg)) {
    return 'Captions need a font FFmpeg can see. Install fonts-dejavu (Linux) or keep Arial installed, then export again.'
  }
  if (/ENOENT|no such file|does not exist/i.test(msg)) {
    return 'A media file is missing. Re-link the recording, B-roll still, or music bed and export again.'
  }
  if (/xfade|acrossfade|concat|Media type mismatch/i.test(msg)) {
    return 'FFmpeg rejected the dissolve join. Shorten the dissolve so it is shorter than both clips, then export again.'
  }
  if (/speed|duration|NaN|invalid/i.test(msg)) {
    return `The timeline has a clip FFmpeg cannot render (${msg}). Check speed, fades, and clip length, then export again.`
  }
  return `Could not build the export graph. ${msg}\nCheck every bed, overlay, and caption still has a file, then export again.`
}

export function assertMixGraph(mix: MixGraph): void {
  if (!mix.filterComplex) return
  if (mix.mapVideo.startsWith('[') && !mix.filterComplex.includes(mix.mapVideo)) {
    throw new Error('Video map label is missing from the filter graph.')
  }
  if (mix.mapAudio.startsWith('[') && !mix.filterComplex.includes(mix.mapAudio)) {
    throw new Error('Audio map label is missing from the filter graph.')
  }
}

export function escapeDrawtext(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, '’').replace(/:/g, '\\:').replace(/%/g, '\\%')
}

export function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:')
}

export function atempoChain(speed: number): string {
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

export function activeBeds(job: GraphJob): GraphBed[] {
  return (job.beds ?? []).filter((b) => b.path && b.volume > 0.001)
}

export function imageLayers(job: GraphJob): GraphLayer[] {
  return job.layers.filter((l) => l.kind === 'image' && l.path)
}

export function blurLayers(job: GraphJob): GraphLayer[] {
  return job.layers.filter((l) => l.kind === 'blur')
}

export function textLayers(job: GraphJob): GraphLayer[] {
  return job.layers.filter((l) => l.kind !== 'image' && l.kind !== 'blur' && l.text)
}

/**
 * Voice chain order matters: loudnorm after EQ/compress, duck after loudnorm
 * so ducked windows are not pulled back up to -16 LUFS.
 */
export function voiceAudioFilters(job: GraphJob): string[] {
  const duration = jobDuration(job)
  const af: string[] = []
  if (job.eqLow) af.push(`equalizer=f=120:width_type=q:w=0.8:g=${job.eqLow.toFixed(1)}`)
  if (job.eqMid) af.push(`equalizer=f=1000:width_type=q:w=0.8:g=${job.eqMid.toFixed(1)}`)
  if (job.eqHigh) af.push(`equalizer=f=8000:width_type=q:w=0.7:g=${job.eqHigh.toFixed(1)}`)
  if (job.compress) af.push('acompressor=threshold=-18dB:ratio=3:attack=15:release=180:makeup=2')
  if (job.normalize) af.push('loudnorm=I=-16:TP=-1.5:LRA=11')
  if (job.duck && job.duckWindows?.length) {
    const enable = job.duckWindows
      .map((w) => `between(t,${w.start.toFixed(3)},${w.end.toFixed(3)})`)
      .join('+')
    af.push(`volume=${(1 - job.duck).toFixed(2)}:enable='${enable}'`)
  }
  if (job.fadeIn > 0.02) af.push(`afade=t=in:st=0:d=${job.fadeIn.toFixed(2)}`)
  if (job.fadeOut > 0.02) {
    af.push(`afade=t=out:st=${Math.max(0, duration - job.fadeOut).toFixed(2)}:d=${job.fadeOut.toFixed(2)}`)
  }
  return af
}

export function dissolveIn(job: GraphJob, index: number): number {
  return index > 0 ? (job.segments[index - 1]?.overlapNext ?? 0) : 0
}

export function buildSegmentFilters(job: GraphJob, seg: GraphSegment, index?: number): SegmentFilters {
  const scale = Math.max(0.2, seg.scale)
  const zoomW = even(Math.round(job.width * scale))
  const zoomH = even(Math.round(job.height * scale))
  const x = Math.round(job.width / 2 - zoomW / 2 + seg.x)
  const y = Math.round(job.height / 2 - zoomH / 2 + seg.y)
  const i = index ?? job.segments.indexOf(seg)
  const overlapOut = seg.overlapNext ?? 0
  const overlapIn = i >= 0 ? dissolveIn(job, i) : 0
  const duration = (seg.end - seg.start) / Math.max(0.1, seg.speed)
  const vfade: string[] = []
  const afade: string[] = []
  if (overlapIn <= 0.04 && seg.fadeIn > 0.02) {
    vfade.push(`fade=t=in:st=0:d=${seg.fadeIn.toFixed(2)}`)
    afade.push(`afade=t=in:st=0:d=${seg.fadeIn.toFixed(2)}`)
  }
  if (overlapOut <= 0.04 && seg.fadeOut > 0.02) {
    const st = Math.max(0, duration - seg.fadeOut).toFixed(2)
    vfade.push(`fade=t=out:st=${st}:d=${seg.fadeOut.toFixed(2)}`)
    afade.push(`afade=t=out:st=${st}:d=${seg.fadeOut.toFixed(2)}`)
  }
  const vf = [
    ...transposeFilters(job.inputRotation),
    `scale=${zoomW}:${zoomH}:force_original_aspect_ratio=increase`,
    `crop=${even(job.width)}:${even(job.height)}:${x}:${y}`,
    seg.speed !== 1 ? `setpts=PTS/${seg.speed.toFixed(3)}` : '',
    ...vfade,
    `fps=${job.fps}`,
    'format=yuv420p'
  ]
    .filter(Boolean)
    .join(',')
  const af = [
    `volume=${(job.volume * seg.volume).toFixed(3)}`,
    'aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=48000',
    seg.speed !== 1 ? atempoChain(seg.speed) : '',
    ...afade
  ]
    .filter(Boolean)
    .join(',')
  return { vf, af: af || 'anull', duration }
}

export function buildJoinGraph(job: GraphJob, partCount: number): JoinGraph | null {
  if (partCount < 2) return null
  const hasDissolve = job.segments.some((s) => (s.overlapNext ?? 0) > 0.04)
  if (!hasDissolve) return null

  const starts = programmedSegments(job).map((s) => s.programStart)
  const filters: string[] = []
  let v = '[0:v]'
  let a = '[0:a]'
  for (let i = 1; i < partCount; i++) {
    const overlap = job.segments[i - 1]?.overlapNext ?? 0
    const nextV = i === partCount - 1 ? '[vout]' : `[vj${i}]`
    const nextA = i === partCount - 1 ? '[aout]' : `[aj${i}]`
    if (overlap > 0.04) {
      filters.push(
        `${v}[${i}:v]xfade=transition=fade:duration=${overlap.toFixed(3)}:offset=${starts[i].toFixed(3)}${nextV}`
      )
      filters.push(`${a}[${i}:a]acrossfade=d=${overlap.toFixed(3)}${nextA}`)
    } else {
      // Keep v/a on separate chains. Interleaved concat=n=2:v=1:a=1 breaks after xfade
      // because the next pads would be treated as v,v,a,a.
      filters.push(`${v}[${i}:v]concat=n=2:v=1:a=0${nextV}`)
      filters.push(`${a}[${i}:a]concat=n=2:v=0:a=1${nextA}`)
    }
    v = nextV
    a = nextA
  }
  return { filterComplex: filters.join(';'), mapVideo: v, mapAudio: a }
}

function overlayPrep(layer: GraphLayer, inputIndex: number, job: GraphJob, tag: string): string[] {
  const w = even(Math.round(job.width * Math.max(0.15, layer.scale)))
  const opacity = Math.max(0, Math.min(1, layer.opacity ?? 1))
  const start = layer.start
  const end = layer.end
  const fadeIn = layer.fadeIn ?? 0
  const fadeOut = layer.fadeOut ?? 0
  const speed = Math.max(0.1, layer.speed ?? 1)
  const pts =
    speed !== 1
      ? `setpts=(PTS-STARTPTS)/${speed.toFixed(3)}+${start.toFixed(3)}/TB`
      : `setpts=PTS-STARTPTS+${start.toFixed(3)}/TB`
  const parts = [`scale=${w}:-2`, 'format=rgba', pts]
  if (fadeIn > 0.02) parts.push(`fade=t=in:st=${start.toFixed(3)}:d=${fadeIn.toFixed(2)}:alpha=1`)
  if (fadeOut > 0.02) {
    parts.push(
      `fade=t=out:st=${Math.max(start, end - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(2)}:alpha=1`
    )
  }
  if (opacity < 0.999) parts.push(`colorchannelmixer=aa=${opacity.toFixed(3)}`)
  return [`[${inputIndex}:v]${parts.join(',')}[${tag}s]`]
}

export function drawtextX(layer: GraphLayer, job: GraphJob): string {
  const x = Math.round(layer.x)
  if (layer.kind !== 'caption') return `(w-text_w)/2+${x}`
  if (layer.align === 'left') return `${Math.round(job.width * 0.08 + layer.x)}`
  if (layer.align === 'right') return `w-text_w-${Math.round(job.width * 0.08)}+${x}`
  return `(w-text_w)/2+${x}`
}

export function drawtextY(layer: GraphLayer, job: GraphJob): string {
  const y = Math.round(layer.y)
  if (layer.kind !== 'caption') return `${Math.round(80 + layer.y)}`
  if (layer.position === 'upper') return `${Math.round(job.height * 0.1 + layer.y)}`
  if (layer.position === 'center') return `${Math.round(job.height * 0.42 + layer.y)}`
  return `h-th-${Math.round(job.height * 0.12)}+${y}`
}

function drawtextFilter(layer: GraphLayer, job: GraphJob, fontFile?: string): string {
  const opacity = Math.max(0, Math.min(1, layer.opacity ?? 1))
  const start = layer.start
  const end = layer.end
  const fadeIn = layer.fadeIn ?? 0
  const fadeOut = layer.fadeOut ?? 0
  const alpha =
    fadeIn > 0.02 || fadeOut > 0.02
      ? `${opacity.toFixed(3)}*if(lt(t,${(start + fadeIn).toFixed(3)}),max(0\\,(t-${start.toFixed(3)})/${Math.max(0.02, fadeIn).toFixed(2)}),if(gt(t,${(end - fadeOut).toFixed(3)}),max(0\\,(${end.toFixed(3)}-t)/${Math.max(0.02, fadeOut).toFixed(2)}),1))`
      : opacity.toFixed(3)
  const font = fontFile ? `:fontfile=${escapeFilterPath(fontFile)}` : ''
  const fill = ffmpegColor(layer.fill, 'white')
  const stroke = ffmpegColor(layer.stroke, 'black')
  const text = escapeDrawtext(layer.text.replace(/\*\*([^*]+)\*\*/g, '$1'))
  return `drawtext=text='${text}':fontsize=${Math.round(layer.fontSize * layer.scale)}:fontcolor=${fill}:borderw=3:bordercolor=${stroke}:x=${drawtextX(layer, job)}:y=${drawtextY(layer, job)}:alpha='${alpha}':enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'${font}`
}

function bedFilter(bed: GraphBed, inputIndex: number, tag: string, masterVolume: number): string {
  const delay = Math.max(0, Math.round(bed.start * 1000))
  const parts = [
    `atrim=start=${bed.inPoint.toFixed(3)}:duration=${Math.max(0.05, bed.duration).toFixed(3)}`,
    'asetpts=PTS-STARTPTS',
    'aresample=48000',
    'aformat=sample_fmts=fltp:channel_layouts=stereo',
    `volume=${(masterVolume * bed.volume).toFixed(3)}`
  ]
  if (bed.fadeIn > 0.02) parts.push(`afade=t=in:st=0:d=${bed.fadeIn.toFixed(2)}`)
  if (bed.fadeOut > 0.02) {
    parts.push(`afade=t=out:st=${Math.max(0, bed.duration - bed.fadeOut).toFixed(2)}:d=${bed.fadeOut.toFixed(2)}`)
  }
  if (delay > 0) parts.push(`adelay=delays=${delay}|${delay}`)
  return `[${inputIndex}:a]${parts.join(',')}[${tag}]`
}

export function buildMixGraph(job: GraphJob, opts?: { fontFile?: string }): MixGraph {
  const images = imageLayers(job)
  const blurs = blurLayers(job)
  const texts = textLayers(job)
  const beds = activeBeds(job)
  const duration = jobDuration(job)
  const voice = voiceAudioFilters(job)
  const notes: string[] = []
  if (texts.length) notes.push(`${texts.length} caption${texts.length === 1 ? '' : 's'}`)
  if (images.length) notes.push(`${images.length} still/b-roll`)
  if (blurs.length) notes.push(`${blurs.length} redaction`)
  if (beds.length) notes.push(`${beds.length} music bed${beds.length === 1 ? '' : 's'}`)
  if (job.eqLow || job.eqMid || job.eqHigh) notes.push('EQ')
  if (job.compress) notes.push('compressor')
  if (job.duck && job.duckWindows?.length) notes.push(`${job.duckWindows.length} duck window${job.duckWindows.length === 1 ? '' : 's'}`)
  if (job.normalize) notes.push('loudnorm')
  if (job.fadeIn > 0.02 || job.fadeOut > 0.02) notes.push('master fade')

  const inputs: InputSpec[] = []
  for (const layer of images) {
    if (layer.loop) {
      inputs.push({
        role: 'image',
        path: layer.path!,
        args: ['-loop', '1', '-framerate', String(job.fps), '-t', duration.toFixed(3), '-i', layer.path!]
      })
    } else {
      const span = Math.max(0.05, layer.end - layer.start)
      const srcDur = span * Math.max(0.1, layer.speed ?? 1)
      inputs.push({
        role: 'image',
        path: layer.path!,
        args: ['-ss', (layer.inPoint ?? 0).toFixed(3), '-t', srcDur.toFixed(3), '-i', layer.path!]
      })
    }
  }
  for (const bed of beds) {
    inputs.push({ role: 'bed', path: bed.path, args: ['-i', bed.path] })
  }

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
    const tag = `ov${i}`
    const x = Math.round((job.width - even(Math.round(job.width * Math.max(0.15, layer.scale)))) / 2 + layer.x)
    const y = Math.round(80 + layer.y)
    filters.push(...overlayPrep(layer, i + 1, job, tag))
    filters.push(
      `${last}[${tag}s]overlay=${x}:${y}:format=auto:enable='between(t,${layer.start.toFixed(3)},${layer.end.toFixed(3)})'[${tag}]`
    )
    last = `[${tag}]`
  })
  if (texts.length) {
    filters.push(`${last}${texts.map((layer) => drawtextFilter(layer, job, opts?.fontFile)).join(',')}[vtxt]`)
    last = '[vtxt]'
  }

  const videoGraph = filters.length > 0
  if (videoGraph) {
    filters.push(`${last}format=yuv420p[vout]`)
  }

  if (beds.length) {
    filters.push(voice.length ? `[0:a]${voice.join(',')}[a0]` : '[0:a]anull[a0]')
    const bedOffset = 1 + images.length
    beds.forEach((bed, i) => {
      filters.push(bedFilter(bed, bedOffset + i, `bed${i}`, job.volume))
    })
    const mix = ['[a0]', ...beds.map((_, i) => `[bed${i}]`)].join('')
    filters.push(`${mix}amix=inputs=${1 + beds.length}:duration=first:dropout_transition=0:normalize=0[aout]`)
  }

  if (beds.length) {
    return {
      inputs,
      filterComplex: filters.join(';'),
      mapVideo: videoGraph ? '[vout]' : '0:v',
      mapAudio: '[aout]',
      encodeVideo: videoGraph,
      encodeAudio: true,
      simpleAudio: '',
      notes
    }
  }

  return {
    inputs,
    filterComplex: videoGraph ? filters.join(';') : '',
    mapVideo: videoGraph ? '[vout]' : '0:v',
    mapAudio: '0:a?',
    encodeVideo: videoGraph,
    encodeAudio: voice.length > 0,
    simpleAudio: voice.join(','),
    notes
  }
}

export function summarizeJob(job: GraphJob, mix?: MixGraph): string {
  const notes = mix?.notes ?? buildMixGraph(job).notes
  const n = job.segments.length
  const clips = `${n} clip${n === 1 ? '' : 's'}`
  return notes.length ? `${clips} · ${notes.join(', ')}` : clips
}

export function explainExportError(stderr: string): string {
  const tail = stderr
    .trim()
    .split('\n')
    .filter((line) => line.trim())
    .slice(-6)
    .join('\n')
  const rules: [RegExp, string][] = [
    [
      /No such file|does not exist|Error opening input|Invalid argument.*path/i,
      'A media file is missing. Re-link the recording, B-roll still, or music bed and export again.'
    ],
    [
      /cannot find a valid font|Fontconfig error|drawtext.*font|No usable font/i,
      'Captions need a font FFmpeg can see. Install fonts-dejavu (Linux) or keep Arial installed, then export again.'
    ],
    [
      /Unknown encoder|Encoder .* not found|Function not implemented|No NVENC|Cannot load libcuda/i,
      'That hardware encoder is not available here. Switch the export encoder to x264 (CPU) in the inspector.'
    ],
    [
      /width not divisible by 2|height not divisible by 2/i,
      'H.264 needs an even frame size. Re-export — SpeechEdit now forces even scale and crop.'
    ],
    [
      /Media type mismatch|acrossfade.*concat|Cannot create the link/i,
      'The dissolve join mixed with a hard cut. Re-export — SpeechEdit now keeps video and audio on separate chains.'
    ],
    [
      /Output with label|matches no streams|does not exist.*unconnected|Invalid argument/i,
      'FFmpeg 4.4 rejected the filter graph (usually a missing stream or -map label). Check every bed and overlay still has a file.'
    ],
    [/Permission denied/i, 'Cannot write the export file. Pick a folder you can write to.'],
    [/No space left/i, 'The disk is full. Free some space and export again.']
  ]
  for (const [re, msg] of rules) {
    if (re.test(stderr)) return tail ? `${msg}\n\n${tail}` : msg
  }
  if (!tail) return 'Export failed. FFmpeg printed no details — is ffmpeg 4.4+ on PATH?'
  return `Export failed. Last FFmpeg lines:\n\n${tail}`
}
