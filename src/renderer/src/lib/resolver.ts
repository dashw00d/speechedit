import {
  DEFAULT_TRANSFORM,
  type Clip,
  type Interval,
  type Project,
  type SegmentStyle,
  type Transform
} from '../types'
import { projectKept } from './edl'
import { takeBoundaryMarks } from './takes'
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
  kind: 'media' | 'slug'
  pan: number
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
  return splitKept(projectKept(project), [...(project.splits ?? []), ...takeBoundaryMarks(project)])
}

export function resolveMediaSegments(project: Project): ResolvedSegment[] {
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
      keyframes: style?.keyframes ?? [],
      kind: 'media',
      pan: style?.pan ?? 0
    })
    program += duration - overlapNext
  }
  return built
}

function spliceInserts(media: ResolvedSegment[], inserts: Project['inserts']): ResolvedSegment[] {
  const slugs = [...(inserts ?? [])]
    .filter((row) => row.duration > 0.03)
    .sort((a, b) => a.programStart - b.programStart || a.id.localeCompare(b.id))
  if (!slugs.length) return media.map((seg) => ({ ...seg, kind: seg.kind ?? 'media' }))

  const out: ResolvedSegment[] = []
  let idx = 0
  let used = 0
  let program = 0

  const emitMedia = (need: number) => {
    while (need > 0.001 && idx < media.length) {
      const seg = media[idx]
      const remain = seg.duration - used
      if (remain <= 0.001) {
        idx += 1
        used = 0
        continue
      }
      const take = Math.min(remain, need)
      const fullFromStart = used < 0.001 && take >= remain - 0.001
      const speed = Math.max(0.1, seg.speed)
      const inPoint = seg.inPoint + used * speed
      const outPoint = inPoint + take * speed
      const overlapNext = fullFromStart && need >= remain ? seg.overlapNext : 0
      out.push({
        ...seg,
        id: fullFromStart ? seg.id : segmentId(inPoint, outPoint),
        start: program,
        duration: take,
        inPoint,
        outPoint,
        overlapNext,
        kind: 'media'
      })
      program += take - overlapNext
      used += take
      need -= take
      if (used >= seg.duration - 0.001) {
        idx += 1
        used = 0
      }
    }
  }

  for (const slug of slugs) {
    const need = Math.max(0, slug.programStart - program)
    if (need > 0.001) emitMedia(need)
    out.push({
      id: `slug_${slug.id}`,
      start: program,
      duration: slug.duration,
      inPoint: slug.holdSourceTime ?? 0,
      outPoint: slug.holdSourceTime ?? 0,
      speed: 1,
      transform: { ...DEFAULT_TRANSFORM, ...projectPictureFallback(media) },
      volume: 0,
      fadeIn: 0,
      fadeOut: 0,
      overlapNext: 0,
      keyframes: [],
      kind: 'slug',
      pan: 0
    })
    program += slug.duration
  }
  emitMedia(Number.POSITIVE_INFINITY)
  return out
}

function projectPictureFallback(media: ResolvedSegment[]): Transform {
  return media[0]?.transform ?? { ...DEFAULT_TRANSFORM }
}

export interface ResolvedProgram {
  segments: ResolvedSegment[]
  media: ResolvedSegment[]
  length: number
}

const resolvedCache = new WeakMap<Project, ResolvedProgram>()

function chainEnd(segs: ResolvedSegment[]): number {
  if (!segs.length) return 0
  const last = segs[segs.length - 1]
  return last.start + last.duration - last.overlapNext
}

export function resolveProgram(project: Project): ResolvedProgram {
  const hit = resolvedCache.get(project)
  if (hit) return hit
  const segments = spliceInserts(resolveMediaSegments(project), project.inserts)
  const kept = segments.length ? segments[segments.length - 1].start + segments[segments.length - 1].duration : 0
  const extras = project.tracks
    .filter((t) => t.id !== 'v1' && t.id !== 'a1')
    .flatMap((t) => t.clips)
    .reduce((max, c) => Math.max(max, c.start + c.duration), 0)
  const resolved: ResolvedProgram = {
    segments,
    media: segments.filter((seg) => seg.kind !== 'slug'),
    length: Math.max(kept, extras, 0.01)
  }
  resolvedCache.set(project, resolved)
  return resolved
}

export function resolveSegments(project: Project): ResolvedSegment[] {
  return resolveProgram(project).segments
}

export function programLengthOf(project: Project): number {
  return resolveProgram(project).length
}

/** Rightmost media keep whose in-point is at or before sourceTime. */
function mediaIndexAtSource(media: ResolvedSegment[], sourceTime: number): number {
  let lo = 0
  let hi = media.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (media[mid].inPoint <= sourceTime) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

export function sourceToProgramOn(resolved: ResolvedProgram, sourceTime: number): number {
  let i = mediaIndexAtSource(resolved.media, sourceTime)
  if (i < 0) return resolved.media[0]?.start ?? 0
  if (
    i > 0 &&
    sourceTime <= resolved.media[i].inPoint + 1e-9 &&
    resolved.media[i - 1].outPoint >= sourceTime - 1e-9
  ) {
    i -= 1
  }
  const seg = resolved.media[i]
  if (sourceTime <= seg.outPoint) return seg.start + (sourceTime - seg.inPoint) / seg.speed
  return resolved.media[i + 1]?.start ?? chainEnd(resolved.segments)
}

export function sourceToProgramOf(project: Project, sourceTime: number): number {
  return sourceToProgramOn(resolveProgram(project), sourceTime)
}

/** True when source time sits in a deleted hole, not on a keep. */
export function sourceInHoleOn(resolved: ResolvedProgram, sourceTime: number): boolean {
  const media = resolved.media
  if (!media.length) return true
  let i = mediaIndexAtSource(media, sourceTime)
  if (i < 0) return true
  if (
    i > 0 &&
    sourceTime <= media[i].inPoint + 1e-9 &&
    media[i - 1].outPoint >= sourceTime - 1e-9
  ) {
    i -= 1
  }
  return sourceTime > media[i].outPoint + 1e-9
}

export function sourceInHole(project: Project, sourceTime: number): boolean {
  return sourceInHoleOn(resolveProgram(project), sourceTime)
}

function lastIndexAtProgram(segs: ResolvedSegment[], programTime: number): number {
  let lo = 0
  let hi = segs.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (segs[mid].start <= programTime) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  while (found + 1 < segs.length && segs[found + 1].start <= programTime) found += 1
  return found
}

export function programToSourceOn(segs: ResolvedSegment[], programTime: number): number {
  const i = lastIndexAtProgram(segs, programTime)
  const seg =
    i < 0
      ? segs[0]
      : programTime < segs[i].start + segs[i].duration
        ? segs[i]
        : (segs[i + 1] ?? segs[i])
  if (!seg) return 0
  if (seg.kind === 'slug') return seg.inPoint
  const local = Math.min(seg.duration, Math.max(0, programTime - seg.start))
  return seg.inPoint + local * seg.speed
}

export function programToSourceOf(project: Project, programTime: number): number {
  return programToSourceOn(resolveProgram(project).segments, programTime)
}

export function segmentsAtProgram(project: Project, programTime: number): ResolvedSegment[] {
  return resolveProgram(project).segments.filter(
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
  const resolved = resolveProgram(project)
  return project.transcript.words.flatMap((word) => [
    sourceToProgramOn(resolved, word.start),
    sourceToProgramOn(resolved, word.end)
  ])
}

export function snapCandidates(project: Project, extras: number[] = []): number[] {
  const resolved = resolveProgram(project)
  return [
    0,
    resolved.length,
    project.markIn ?? -1,
    project.markOut ?? -1,
    ...extras,
    ...resolved.segments.flatMap((s) => [s.start, s.start + s.duration]),
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
  return resolveProgram(project).segments.map((seg) => ({
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
    keyframes: seg.keyframes,
    pan: seg.pan,
    kind: seg.kind
  }))
}
