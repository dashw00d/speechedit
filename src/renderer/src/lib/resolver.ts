import {
  DEFAULT_TRANSFORM,
  type Clip,
  type Interval,
  type Project,
  type SegmentStyle,
  type Transform
} from '../types'
import { projectKept } from './edl'
import { sampleTransform } from './keyframes'
import { clamp } from './edl'

export interface ResolvedSegment {
  id: string
  start: number
  duration: number
  inPoint: number
  outPoint: number
  speed: number
  transform: Transform
  volume: number
  fadeIn: number
  fadeOut: number
  overlapNext: number
  keyframes: SegmentStyle['keyframes']
}

export function segmentId(start: number, end: number): string {
  return `seg_${start.toFixed(3)}_${end.toFixed(3)}`
}

function splitKept(kept: Interval[], splits: number[]): Interval[] {
  const marks = [...splits].sort((a, b) => a - b)
  const out: Interval[] = []
  for (const span of kept) {
    let cursor = span.start
    for (const mark of marks) {
      if (mark <= cursor + 0.04 || mark >= span.end - 0.04) continue
      out.push({ start: cursor, end: mark })
      cursor = mark
    }
    if (span.end - cursor > 0.04) out.push({ start: cursor, end: span.end })
  }
  return out
}

function styleFor(project: Project, span: Interval): SegmentStyle | undefined {
  let best: { style: SegmentStyle; overlap: number } | undefined
  for (const style of project.styles ?? []) {
    const overlap = Math.min(span.end, style.end) - Math.max(span.start, style.start)
    if (overlap > 0.05 && (!best || overlap > best.overlap)) best = { style, overlap }
  }
  return best?.style
}

export function sourcePieces(project: Project): Interval[] {
  return splitKept(projectKept(project), project.splits ?? [])
}

export function resolveSegments(project: Project): ResolvedSegment[] {
  const pieces = sourcePieces(project)
  const built: ResolvedSegment[] = []
  let program = 0
  for (let i = 0; i < pieces.length; i++) {
    const span = pieces[i]
    const style = styleFor(project, span)
    const nextStyle = pieces[i + 1] ? styleFor(project, pieces[i + 1]) : undefined
    const speed = style?.speed ?? 1
    const duration = (span.end - span.start) / Math.max(0.1, speed)
    const fadeOut = style?.fadeOut ?? 0
    const nextIn = nextStyle?.fadeIn ?? 0
    const overlapNext = fadeOut > 0.04 && nextIn > 0.04 ? Math.min(fadeOut, nextIn, duration * 0.4) : 0
    built.push({
      id: segmentId(span.start, span.end),
      start: program,
      duration,
      inPoint: span.start,
      outPoint: span.end,
      speed,
      transform: { ...DEFAULT_TRANSFORM, ...project.picture, ...style?.transform },
      volume: style?.volume ?? 1,
      fadeIn: style?.fadeIn ?? 0,
      fadeOut,
      overlapNext,
      keyframes: style?.keyframes ?? []
    })
    program += duration - overlapNext
  }
  return built
}

export function programLengthOf(project: Project): number {
  const segs = resolveSegments(project)
  const kept = segs.length ? segs[segs.length - 1].start + segs[segs.length - 1].duration : 0
  const extras = project.tracks
    .filter((t) => t.id !== 'v1' && t.id !== 'a1')
    .flatMap((t) => t.clips)
    .reduce((max, c) => Math.max(max, c.start + c.duration), 0)
  return Math.max(kept, extras, 0.01)
}

export function sourceToProgramOf(project: Project, sourceTime: number): number {
  let program = 0
  for (const seg of resolveSegments(project)) {
    if (sourceTime < seg.inPoint) return program
    if (sourceTime <= seg.outPoint) return program + (sourceTime - seg.inPoint) / seg.speed
    program += seg.duration - seg.overlapNext
  }
  return program
}

export function programToSourceOf(project: Project, programTime: number): number {
  const segs = resolveSegments(project)
  const hits = segs.filter((s) => programTime >= s.start && programTime < s.start + s.duration)
  const seg = hits[hits.length - 1] ?? segs.find((s) => programTime < s.start) ?? segs[segs.length - 1]
  if (!seg) return 0
  const local = Math.min(seg.duration, Math.max(0, programTime - seg.start))
  return seg.inPoint + local * seg.speed
}

export function segmentsAtProgram(project: Project, programTime: number): ResolvedSegment[] {
  return resolveSegments(project).filter(
    (s) => programTime >= s.start && programTime < s.start + s.duration
  )
}

export function segmentAtProgram(project: Project, programTime: number): ResolvedSegment | undefined {
  const hits = segmentsAtProgram(project, programTime)
  return hits[hits.length - 1]
}

export function pictureAt(project: Project, programTime: number): Transform {
  const seg = segmentAtProgram(project, programTime)
  if (!seg) return { ...DEFAULT_TRANSFORM, ...project.picture }
  const local = (programTime - seg.start) / Math.max(1e-6, seg.duration)
  return sampleTransform(seg.transform, seg.keyframes, local)
}

export function wordSnapTimes(project: Project): number[] {
  const segs = resolveSegments(project)
  return project.transcript.words.flatMap((word) => [
    sourceToProgramCached(segs, word.start),
    sourceToProgramCached(segs, word.end)
  ])
}

function sourceToProgramCached(
  segs: ResolvedSegment[],
  sourceTime: number
): number {
  let program = 0
  for (const seg of segs) {
    if (sourceTime < seg.inPoint) return program
    if (sourceTime <= seg.outPoint) return program + (sourceTime - seg.inPoint) / seg.speed
    program += seg.duration - seg.overlapNext
  }
  return program
}

export function snapCandidates(project: Project, extras: number[] = []): number[] {
  const segs = resolveSegments(project)
  return [
    0,
    programLengthOf(project),
    project.markIn ?? -1,
    project.markOut ?? -1,
    ...extras,
    ...segs.flatMap((s) => [s.start, s.start + s.duration]),
    ...project.tracks.flatMap((t) => t.clips.flatMap((c) => [c.start, c.start + c.duration])),
    ...wordSnapTimes(project)
  ].filter((n) => n >= 0)
}

export function snapTime(project: Project, time: number, extras: number[] = [], threshold = 0.12): number {
  let best = time
  let dist = threshold
  for (const point of snapCandidates(project, extras)) {
    const d = Math.abs(point - time)
    if (d < dist) {
      dist = d
      best = point
    }
  }
  return clamp(best, 0, programLengthOf(project) + 60)
}

export function snapSourceTime(
  project: Project,
  sourceTime: number,
  extras: number[] = [],
  threshold = 0.12
): number {
  const program = sourceToProgramOf(project, sourceTime)
  return programToSourceOf(project, snapTime(project, program, extras, threshold))
}

export function asVideoClips(project: Project): Clip[] {
  const video = project.tracks.find((t) => t.type === 'video')
  const assetId = Object.values(project.assets)[0]?.id
  return resolveSegments(project).map((seg) => ({
    id: seg.id,
    trackId: video?.id ?? 'v1',
    assetId,
    start: seg.start,
    duration: seg.duration,
    inPoint: seg.inPoint,
    outPoint: seg.outPoint,
    transform: seg.transform,
    volume: seg.volume,
    muted: false,
    speed: seg.speed,
    fadeIn: seg.fadeIn,
    fadeOut: seg.fadeOut,
    keyframes: seg.keyframes
  }))
}
