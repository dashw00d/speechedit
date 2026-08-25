import { DEFAULT_CAPTION_STYLE, type Clip, type Project } from '../types'
import { captionClipsOf, transcriptReadyForCaptions, withGeneratedCaptions } from './captions'
import { applyCommand } from './commands'
import type { GraphJob, GraphLayer } from './exportGraph'
import { normalizeProject } from './normalize'
import { bedGain, duckAt, voiceLook } from './programLook'
import { programLengthOf, programToSourceOf, resolveSegments } from './resolver'
import { primaryAssetAt, primaryTakes, sourceOffsetOf } from './takes'
import { withSoloApplied } from './timelineTracks'

export type ExportVideoOpts = {
  markedOnly?: boolean
  audioOnly?: boolean
  burnCaptions?: boolean
}

export function projectForExport(project: Project, opts: ExportVideoOpts = {}): Project {
  let next = withSoloApplied(normalizeProject(project))
  if (opts.markedOnly && next.markIn != null && next.markOut != null) {
    const a = Math.min(next.markIn, next.markOut)
    const b = Math.max(next.markIn, next.markOut)
    const srcA = programToSourceOf(next, a)
    const srcB = programToSourceOf(next, b)
    const dur = next.sourceDuration
    if (srcB < dur - 0.01) next = applyCommand(next, { type: 'deleteRange', start: srcB, end: dur })
    if (srcA > 0.01) next = applyCommand(next, { type: 'deleteRange', start: 0, end: srcA })
    next = { ...next, markIn: null, markOut: null }
  }
  if (opts.burnCaptions === false) {
    next = {
      ...next,
      tracks: next.tracks.map((track) => (track.type === 'caption' ? { ...track, hidden: true } : track))
    }
  } else if (!captionClipsOf(next).length && transcriptReadyForCaptions(next)) {
    next = withGeneratedCaptions(next, { maxWords: 5, emphasize: true })
  }
  return next
}

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
    .filter((c) => !c.muted && (c.volume ?? 1) > 0.02 && c.assetId && project.assets[c.assetId])
    .map((c) => ({ start: c.start, end: c.start + c.duration }))
}

const exportJobCache = new WeakMap<Project, ProgramExportJob>()

function defaultExportLook(output: string, opts: ExportVideoOpts): boolean {
  return !output && !opts.markedOnly && !opts.audioOnly && opts.burnCaptions !== false
}

export function projectToExportJob(project: Project, output = '', opts: ExportVideoOpts = {}): ProgramExportJob {
  if (defaultExportLook(output, opts)) {
    const hit = exportJobCache.get(project)
    if (hit) return hit
  }
  const job = buildProgramExportJob(project, output, opts)
  if (defaultExportLook(output, opts)) exportJobCache.set(project, job)
  return job
}

function buildProgramExportJob(project: Project, output: string, opts: ExportVideoOpts): ProgramExportJob {
  const current = projectForExport(project, opts)
  const takes = primaryTakes(current)
  const asset = takes[0] ?? Object.values(current.assets).find((a) => a.path)
  const segs = resolveSegments(current)
  const inputs = takes
    .filter((take) => take.path)
    .map((take) => ({
      path: take.path,
      sourceOffset: sourceOffsetOf(take),
      duration: take.duration,
      rotation: take.displayRotation
    }))
  return {
    input: asset?.path ?? '',
    inputs,
    output,
    fps: current.fps,
    width: current.width,
    height: current.height,
    volume: current.audioMaster.muted ? 0 : current.audioMaster.volume,
    fadeIn: current.audioMaster.fadeIn,
    fadeOut: current.audioMaster.fadeOut,
    encoder: current.encoder ?? 'auto',
    inputRotation: asset?.displayRotation,
    normalize: current.audioMaster.normalize,
    eqLow: current.audioMaster.eqLow,
    eqMid: current.audioMaster.eqMid,
    eqHigh: current.audioMaster.eqHigh,
    compress: current.audioMaster.compress,
    duck: current.audioMaster.duck,
    duckWindows: overlayDuckWindows(current),
    duration: programLengthOf(current),
    audioOnly: Boolean(opts.audioOnly),
    beds: audioBeds(current),
    segments: segs.map((s) => {
      const take = primaryAssetAt(current, s.inPoint)
      const offset = sourceOffsetOf(take)
      return {
        start: s.inPoint,
        end: s.outPoint,
        sourceOffset: offset,
        input: take?.path ?? asset?.path,
        inputIndex: Math.max(0, takes.findIndex((row) => row.id === take?.id)),
        inputRotation: take?.displayRotation ?? asset?.displayRotation,
        speed: s.speed,
        scale: s.transform.scale,
        x: s.transform.x,
        y: s.transform.y,
        volume: s.volume,
        fadeIn: s.fadeIn,
        fadeOut: s.fadeOut,
        overlapNext: s.overlapNext,
        programStart: s.start,
        kind: s.kind,
        duration: s.duration,
        pan: s.pan,
        opacity: s.transform.opacity,
        rotation: s.transform.rotation
      }
    }),
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

export function buildExportJob(
  project: Project,
  output: string,
  opts: ExportVideoOpts = {}
): ProgramExportJob | null {
  const job = projectToExportJob(project, output, opts)
  return job.input ? job : null
}

export function exportDuration(project: Project): number {
  return programLengthOf(normalizeProject(project))
}
