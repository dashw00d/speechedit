import type { Clip, ClipLook, Project, RangeTag, Track } from '../types'
import { clamp } from './edl'

function isPrimaryLane(track: Track): boolean {
  return track.id === 'v1' || track.id === 'a1'
}

export function clipLookOf(clip: Clip): ClipLook {
  return {
    transform: { ...clip.transform, crop: { ...clip.transform.crop } },
    volume: clip.volume,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
    muted: clip.muted,
    speed: clip.speed,
    pan: clip.pan ?? 0
  }
}

export function applyLookToClip(clip: Clip, look: ClipLook): Clip {
  return {
    ...clip,
    transform: { ...look.transform, crop: { ...look.transform.crop } },
    volume: look.volume,
    fadeIn: look.fadeIn,
    fadeOut: look.fadeOut,
    muted: look.muted,
    speed: look.speed,
    pan: look.pan ?? clip.pan
  }
}

export function sourceLength(clip: Clip): number {
  return Math.max(0.05, clip.outPoint - clip.inPoint)
}

export function slippedClip(clip: Clip, delta: number, assetDuration?: number): Clip | null {
  const len = sourceLength(clip)
  const maxIn = Math.max(0, (assetDuration ?? clip.outPoint + 120) - len)
  const inPoint = clamp(clip.inPoint + delta, 0, maxIn)
  if (Math.abs(inPoint - clip.inPoint) < 1e-4) return null
  return { ...clip, inPoint, outPoint: inPoint + len }
}

export function neighborsOnTrack(track: Track, clipId: string): { prev?: Clip; next?: Clip } {
  const ordered = [...track.clips].sort((a, b) => a.start - b.start)
  const index = ordered.findIndex((c) => c.id === clipId)
  if (index < 0) return {}
  return { prev: ordered[index - 1], next: ordered[index + 1] }
}

export function rolledPair(
  clip: Clip,
  neighbor: Clip | undefined,
  edge: 'in' | 'out',
  time: number
): { clip: Clip; neighbor?: Clip } | null {
  if (edge === 'out') {
    const max = neighbor ? neighbor.start + neighbor.duration - 0.05 : clip.start + clip.duration + 120
    const nextEnd = clamp(time, clip.start + 0.05, max)
    const duration = nextEnd - clip.start
    const nextClip = { ...clip, duration, outPoint: clip.inPoint + duration }
    if (!neighbor) return { clip: nextClip }
    const shift = nextEnd - neighbor.start
    const nextNeighbor = {
      ...neighbor,
      start: nextEnd,
      duration: neighbor.duration - shift,
      inPoint: neighbor.inPoint + shift
    }
    if (nextNeighbor.duration < 0.05) return null
    return { clip: nextClip, neighbor: nextNeighbor }
  }
  const min = neighbor ? neighbor.start + 0.05 : 0
  const nextStart = clamp(time, min, clip.start + clip.duration - 0.05)
  const delta = nextStart - clip.start
  const nextClip = {
    ...clip,
    start: nextStart,
    duration: clip.duration - delta,
    inPoint: clip.inPoint + delta
  }
  if (nextClip.duration < 0.05) return null
  if (!neighbor) return { clip: nextClip }
  const nextNeighbor = {
    ...neighbor,
    duration: nextStart - neighbor.start,
    outPoint: neighbor.inPoint + (nextStart - neighbor.start)
  }
  if (nextNeighbor.duration < 0.05) return null
  return { clip: nextClip, neighbor: nextNeighbor }
}

export function slidTrio(
  clip: Clip,
  prev: Clip | undefined,
  next: Clip | undefined,
  start: number
): { clip: Clip; prev?: Clip; next?: Clip } | null {
  const min = prev ? prev.start + 0.05 : 0
  const max = next ? next.start + next.duration - clip.duration - 0.05 : start + 600
  const nextStart = clamp(start, min, max > min ? max : min)
  const delta = nextStart - clip.start
  if (Math.abs(delta) < 1e-4) return null
  const moved = { ...clip, start: nextStart }
  let left = prev
  let right = next
  if (left) {
    left = { ...left, duration: left.duration + delta, outPoint: left.inPoint + left.duration + delta }
    if (left.duration < 0.05) return null
  }
  if (right) {
    right = {
      ...right,
      start: right.start + delta,
      duration: right.duration - delta,
      inPoint: right.inPoint + delta
    }
    if (right.duration < 0.05) return null
  }
  return { clip: moved, prev: left, next: right }
}

export function extendedClip(clip: Clip, time: number, assetDuration?: number): Clip | null {
  const end = clip.start + clip.duration
  if (time > end + 1e-3) {
    const extra = time - end
    const room = Math.max(0, (assetDuration ?? clip.outPoint + extra) - clip.outPoint)
    const grow = Math.min(extra, room)
    if (grow < 1e-3) return null
    return { ...clip, duration: clip.duration + grow, outPoint: clip.outPoint + grow }
  }
  if (time < clip.start - 1e-3) {
    const want = clip.start - time
    const room = clip.inPoint
    const grow = Math.min(want, room)
    if (grow < 1e-3) return null
    return {
      ...clip,
      start: clip.start - grow,
      duration: clip.duration + grow,
      inPoint: clip.inPoint - grow
    }
  }
  return null
}

export function isTapeNote(kind: string | undefined): boolean {
  return kind === 'note' || kind === 'hook' || kind === 'cta'
}

export function noteDraft(label: string | undefined): string {
  if (!label || /^(Note|Hook|CTA)$/i.test(label.trim())) return ''
  return label
}

export function notesSorted(project: Project): RangeTag[] {
  return (project.tags ?? []).filter((tag) => isTapeNote(tag.kind)).sort((a, b) => a.start - b.start)
}

export function coveringNote(project: Project, start: number, end: number): RangeTag | undefined {
  const mid = (start + end) / 2
  return notesSorted(project).find((note) => mid >= note.start - 0.05 && mid <= note.end + 0.05)
}

export function hopNote(project: Project, sourceTime: number, dir: 1 | -1): RangeTag | undefined {
  const notes = notesSorted(project)
  if (!notes.length) return undefined
  const on = notes.find((note) => sourceTime >= note.start - 0.05 && sourceTime <= note.end + 0.05)
  const from = on?.start ?? sourceTime
  if (dir === 1) return notes.find((note) => note.start > from + 0.05) ?? notes[0]
  return [...notes].reverse().find((note) => note.start < from - 0.05) ?? notes[notes.length - 1]
}

export function movableIds(project: Project, ids: string[]): string[] {
  return ids.filter((id) => {
    const track = project.tracks.find((row) => row.clips.some((clip) => clip.id === id))
    return Boolean(track && !isPrimaryLane(track) && !track.locked)
  })
}
