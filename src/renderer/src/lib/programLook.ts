/** Sample a ProgramExportJob at a program time. Monitor and useEngine apply this. */

import {
  dissolveIn,
  jobDuration,
  programmedSegments,
  timedFade,
  type GraphBed,
  type GraphJob,
  type GraphLayer,
  type ProgrammedSegment
} from './exportGraph'

export interface VoiceLook {
  gain: number
  ducked: boolean
  duckAmount: number
  incomingGain: number
  outgoingGain: number
}

export interface BedLook {
  bed: GraphBed
  local: number
  active: boolean
  gain: number
  sourceTime: number
}

export interface LayerLook {
  layer: GraphLayer
  fade: number
  opacity: number
  local: number
  sourceTime: number
}

export interface ProgramLook {
  segments: ProgrammedSegment[]
  stack: ProgrammedSegment[]
  incoming?: ProgrammedSegment
  outgoing?: ProgrammedSegment
  incomingIndex: number
  outgoingIndex: number
  sourceTime: number
  incomingSource: number
  outgoingSource?: number
  incomingInput?: string
  outgoingInput?: string
  incomingOpacity: number
  outgoingOpacity: number
  incomingSpeed: number
  outgoingSpeed: number
  dissolveProgress: number
  voice: VoiceLook
  beds: BedLook[]
  layers: LayerLook[]
}

export function duckAt(job: GraphJob, t: number): number {
  const duck = job.duck ?? 0
  if (duck <= 0) return 1
  const hit = (job.duckWindows ?? []).some((w) => t >= w.start && t < w.end)
  return hit ? Math.max(0, 1 - duck) : 1
}

export function masterFadeAt(job: GraphJob, t: number): number {
  return timedFade(t, jobDuration(job), job.fadeIn, job.fadeOut)
}

export function segmentFadeAt(job: GraphJob, index: number, t: number): number {
  const segs = programmedSegments(job)
  const seg = segs[index]
  if (!seg) return 1
  const fadeIn = dissolveIn(job, index) > 0.04 ? 0 : seg.fadeIn
  const fadeOut = (seg.overlapNext ?? 0) > 0.04 ? 0 : seg.fadeOut
  return timedFade(t - seg.programStart, seg.programDuration, fadeIn, fadeOut)
}

export function xfadeProgress(job: GraphJob, outgoingIndex: number, t: number): number {
  const segs = programmedSegments(job)
  const outgoing = segs[outgoingIndex]
  const incoming = segs[outgoingIndex + 1]
  const overlap = outgoing?.overlapNext ?? 0
  if (!outgoing || !incoming || overlap <= 0.04) return 1
  return Math.min(1, Math.max(0, (t - incoming.programStart) / overlap))
}

export function sourceTimeAt(seg: ProgrammedSegment, t: number): number {
  if (seg.kind === 'slug') return seg.start
  const local = Math.min(seg.programDuration, Math.max(0, t - seg.programStart))
  return seg.start + local * seg.speed
}

function voiceOf(job: GraphJob, index: number | undefined, t: number, duck: number, master: number): number {
  if (index == null || index < 0) return job.volume * duck * master
  const seg = job.segments[index]
  if (!seg) return job.volume * duck * master
  return job.volume * seg.volume * duck * master * segmentFadeAt(job, index, t)
}

export function voiceLook(job: GraphJob, t: number): VoiceLook {
  const segs = programmedSegments(job)
  const stack = segs
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => t >= s.programStart && t < s.programStart + s.programDuration)
  const incoming = stack[stack.length - 1]
  const outgoing = stack.length > 1 ? stack[0] : undefined
  const duck = duckAt(job, t)
  const master = masterFadeAt(job, t)
  const inFull = voiceOf(job, incoming?.i, t, duck, master)
  const outFull = outgoing ? voiceOf(job, outgoing.i, t, duck, master) : 0
  const progress = outgoing ? xfadeProgress(job, outgoing.i, t) : 1
  const incomingGain = outgoing ? inFull * progress : inFull
  const outgoingGain = outgoing ? outFull * (1 - progress) : 0
  return {
    gain: incomingGain + outgoingGain,
    ducked: duck < 0.999,
    duckAmount: job.duck ?? 0,
    incomingGain,
    outgoingGain
  }
}

export function bedGain(job: GraphJob, bed: GraphBed, t: number): number {
  return job.volume * bed.volume * timedFade(t - bed.start, bed.duration, bed.fadeIn, bed.fadeOut)
}

export function layerFade(layer: GraphLayer, t: number): number {
  return timedFade(t - layer.start, layer.end - layer.start, layer.fadeIn ?? 0, layer.fadeOut ?? 0)
}

export function layersAt(job: GraphJob, t: number): GraphLayer[] {
  return job.layers.filter((l) => t >= l.start && t < l.end)
}

export function nextProgramAfterCut(job: GraphJob, program: number): number | null {
  const segs = programmedSegments(job)
  const hits = segs.filter((s) => program >= s.programStart && program < s.programStart + s.programDuration)
  if (hits.some((s) => s.kind === 'slug')) return null
  const seg = hits[hits.length - 1] ?? segs.find((s) => program < s.programStart) ?? segs[segs.length - 1]
  if (!seg || seg.kind === 'slug') return null
  const source = sourceTimeAt(seg, program)
  const inHole = segs.every((s) => s.kind === 'slug' || source < s.start || source >= s.end)
  if (!inHole) return null
  const next = segs.find((s) => s.kind !== 'slug' && s.start >= source)
  return next ? next.programStart : null
}

export function sampleProgram(job: GraphJob, t: number): ProgramLook {
  const segments = programmedSegments(job)
  const indexed = segments.map((s, i) => ({ s, i }))
  const stackItems = indexed.filter(
    ({ s }) => t >= s.programStart && t < s.programStart + s.programDuration
  )
  const incoming = stackItems[stackItems.length - 1]
  const outgoing = stackItems.length > 1 ? stackItems[0] : undefined
  const progress = outgoing ? xfadeProgress(job, outgoing.i, t) : 1
  const inFade = incoming ? segmentFadeAt(job, incoming.i, t) : 1
  const outFade = outgoing ? segmentFadeAt(job, outgoing.i, t) : 0
  const incomingOpacity = incoming
    ? incoming.s.kind === 'slug'
      ? 0
      : (incoming.s.opacity ?? 1) * inFade * (outgoing ? progress : 1)
    : 0
  const outgoingOpacity = outgoing ? (outgoing.s.opacity ?? 1) * outFade * (1 - progress) : 0

  return {
    segments,
    stack: stackItems.map((x) => x.s),
    incoming: incoming?.s,
    outgoing: outgoing?.s,
    incomingIndex: incoming?.i ?? -1,
    outgoingIndex: outgoing?.i ?? -1,
    sourceTime: incoming ? sourceTimeAt(incoming.s, t) : 0,
    incomingSource: incoming ? sourceTimeAt(incoming.s, t) - (incoming.s.sourceOffset ?? 0) : 0,
    outgoingSource: outgoing ? sourceTimeAt(outgoing.s, t) - (outgoing.s.sourceOffset ?? 0) : undefined,
    incomingInput: incoming?.s.input,
    outgoingInput: outgoing?.s.input,
    incomingOpacity,
    outgoingOpacity,
    incomingSpeed: incoming?.s.speed ?? 1,
    outgoingSpeed: outgoing?.s.speed ?? 1,
    dissolveProgress: outgoing ? progress : 1,
    voice: voiceLook(job, t),
    beds: (job.beds ?? []).map((bed) => {
      const local = t - bed.start
      return {
        bed,
        local,
        active: local >= -0.04 && local < bed.duration,
        gain: bedGain(job, bed, t),
        sourceTime: bed.inPoint + Math.max(0, local)
      }
    }),
    layers: layersAt(job, t).map((layer) => {
      const local = t - layer.start
      const fade = layerFade(layer, t)
      const speed = layer.speed ?? 1
      return {
        layer,
        fade,
        opacity: (layer.opacity ?? 1) * fade,
        local,
        sourceTime: (layer.inPoint ?? 0) + Math.max(0, local) * speed
      }
    })
  }
}
