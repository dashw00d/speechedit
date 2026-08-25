import { DEFAULT_CAPTION_STYLE, type Clip, type Project } from '../types'
import type { GraphJob, GraphLayer } from './exportGraph'
import { normalizeProject } from './normalize'
import { bedGain, duckAt, voiceLook } from './programLook'
import { programLengthOf, resolveSegments } from './resolver'

export type ExportLayer = GraphLayer

export interface ProgramExportJob extends GraphJob {
  beds: NonNullable<GraphJob['beds']>
  duckWindows: NonNullable<GraphJob['duckWindows']>
  duration: number
  layers: GraphLayer[]
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
    .filter((c) => !c.muted && c.assetId && project.assets[c.assetId])
    .map((c) => ({ start: c.start, end: c.start + c.duration }))
}

export function projectToExportJob(project: Project, output = ''): ProgramExportJob {
  const current = normalizeProject(project)
  const asset = Object.values(current.assets).find((a) => a.path)
  const segs = resolveSegments(current)
  return {
    input: asset?.path ?? '',
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
    beds: audioBeds(current),
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
      overlapNext: s.overlapNext,
      programStart: s.start,
      opacity: s.transform.opacity,
      rotation: s.transform.rotation
    })),
    layers: current.tracks
      .filter((t) => (t.type === 'caption' || t.type === 'overlay') && !t.hidden && !t.muted)
      .flatMap((t) =>
        t.clips
          .filter((c) => !c.muted)
          .map((c) => {
            const media = c.assetId ? current.assets[c.assetId] : undefined
            const kind =
              c.effect === 'blur'
                ? ('blur' as const)
                : media?.kind === 'image' || media?.kind === 'video'
                  ? ('image' as const)
                  : (t.type as 'caption' | 'overlay')
            return {
              kind,
              id: c.id,
              start: c.start,
              end: c.start + c.duration,
              text: c.text ?? '',
              fontSize: c.style?.fontSize ?? DEFAULT_CAPTION_STYLE.fontSize,
              x: c.transform.x,
              y: c.transform.y,
              scale: c.transform.scale,
              opacity: c.transform.opacity,
              path: media?.path,
              fadeIn: c.fadeIn,
              fadeOut: c.fadeOut,
              inPoint: c.inPoint,
              loop: media?.kind === 'image',
              speed: c.speed || 1,
              align: c.style?.align ?? DEFAULT_CAPTION_STYLE.align,
              fill: c.style?.fill ?? DEFAULT_CAPTION_STYLE.fill,
              stroke: c.style?.stroke ?? DEFAULT_CAPTION_STYLE.stroke,
              position: c.style?.position ?? (t.type === 'caption' ? 'lower' : 'upper'),
              rotation: c.transform.rotation
            }
          })
      )
  }
}

export function duckGainAt(project: Project, programTime: number): number {
  return duckAt(projectToExportJob(project), programTime)
}

export function visibleGraphicClips(
  project: Project,
  programTime: number,
  type: 'overlay' | 'caption'
): Clip[] {
  return project.tracks
    .filter((t) => t.type === type && !t.hidden && !t.muted)
    .flatMap((t) => t.clips)
    .filter((c) => !c.muted && programTime >= c.start && programTime < c.start + c.duration)
}

export function bedGainAt(
  project: Project,
  bed: { id?: string; start: number; duration: number; volume: number; fadeIn: number; fadeOut: number },
  programTime: number
): number {
  const job = projectToExportJob(project)
  const found =
    (job.beds ?? []).find((b) => (bed.id && b.id === bed.id) || (b.start === bed.start && b.duration === bed.duration)) ??
    {
      path: '',
      start: bed.start,
      duration: bed.duration,
      inPoint: 0,
      volume: bed.volume,
      fadeIn: bed.fadeIn,
      fadeOut: bed.fadeOut,
      id: bed.id
    }
  return bedGain(job, found, programTime)
}

export function programVolume(project: Project, programTime: number) {
  return voiceLook(projectToExportJob(project), programTime)
}

export function buildExportJob(project: Project, output: string): ProgramExportJob | null {
  const job = projectToExportJob(project, output)
  return job.input ? job : null
}

export function exportDuration(project: Project): number {
  return programLengthOf(normalizeProject(project))
}
