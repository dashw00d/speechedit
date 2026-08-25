import type { Project } from '../types'
import { normalizeProject } from './normalize'
import { programLengthOf, resolveSegments } from './resolver'

export interface ExportLayer {
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
  fadeIn: number
  fadeOut: number
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
  encoder: string
  normalize: boolean
  eqLow: number
  eqMid: number
  eqHigh: number
  compress: boolean
  duck: number
  duckWindows: { start: number; end: number }[]
  duration: number
  beds: {
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
    overlapNext: number
  }[]
  layers: ExportLayer[]
}

export function audioBeds(project: Project) {
  return project.tracks
    .filter((t) => t.type === 'audio' && t.id !== 'a1' && !t.hidden && !t.muted)
    .flatMap((t) => t.clips)
    .filter((c) => !c.muted && c.assetId && project.assets[c.assetId]?.path)
    .map((c) => ({
      id: c.id,
      path: project.assets[c.assetId!].path,
      start: c.start,
      duration: c.duration,
      inPoint: c.inPoint,
      volume: c.volume,
      fadeIn: c.fadeIn,
      fadeOut: c.fadeOut
    }))
}

export function overlayDuckWindows(project: Project): { start: number; end: number }[] {
  return project.tracks
    .filter((t) => t.type === 'overlay' && !t.hidden && !t.muted)
    .flatMap((t) => t.clips)
    .filter((c) => c.assetId && project.assets[c.assetId])
    .map((c) => ({ start: c.start, end: c.start + c.duration }))
}

export function duckGainAt(project: Project, programTime: number): number {
  const duck = project.audioMaster.duck ?? 0
  if (duck <= 0) return 1
  const hit = overlayDuckWindows(project).some((w) => programTime >= w.start && programTime < w.end)
  return hit ? Math.max(0, 1 - duck) : 1
}

export function buildExportJob(project: Project, output: string): ProgramExportJob | null {
  const current = normalizeProject(project)
  const asset = Object.values(current.assets).find((a) => a.path)
  if (!asset?.path) return null
  const segs = resolveSegments(current)
  return {
    input: asset.path,
    output,
    fps: current.fps,
    width: current.width,
    height: current.height,
    volume: current.audioMaster.muted ? 0 : current.audioMaster.volume,
    fadeIn: current.audioMaster.fadeIn,
    fadeOut: current.audioMaster.fadeOut,
    encoder: current.encoder ?? 'auto',
    normalize: current.audioMaster.normalize,
    eqLow: current.audioMaster.eqLow,
    eqMid: current.audioMaster.eqMid,
    eqHigh: current.audioMaster.eqHigh,
    compress: current.audioMaster.compress,
    duck: current.audioMaster.duck,
    duckWindows: overlayDuckWindows(current),
    duration: programLengthOf(current),
    beds: audioBeds(current).map(({ id: _id, ...bed }) => bed),
    segments: segs.map((s) => ({
      start: s.inPoint,
      end: s.outPoint,
      speed: s.speed,
      scale: s.transform.scale,
      x: s.transform.x,
      y: s.transform.y,
      volume: s.volume,
      fadeIn: s.fadeIn,
      fadeOut: s.fadeOut,
      overlapNext: s.overlapNext
    })),
    layers: current.tracks
      .filter((t) => t.type === 'caption' || t.type === 'overlay')
      .flatMap((t) =>
        t.clips.map((c) => {
          const asset = c.assetId ? current.assets[c.assetId] : undefined
          const kind =
            c.effect === 'blur'
              ? ('blur' as const)
              : asset?.kind === 'image' || asset?.kind === 'video'
                ? ('image' as const)
                : (t.type as 'caption' | 'overlay')
          return {
            kind,
            start: c.start,
            end: c.start + c.duration,
            text: c.text ?? '',
            fontSize: c.style?.fontSize ?? 42,
            x: c.transform.x,
            y: c.transform.y,
            scale: c.transform.scale,
            opacity: c.transform.opacity,
            path: asset?.path,
            fadeIn: c.fadeIn,
            fadeOut: c.fadeOut
          }
        })
      )
  }
}

export function exportDuration(project: Project): number {
  return programLengthOf(normalizeProject(project))
}
