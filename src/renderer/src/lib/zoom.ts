import type { Command, EditorialScene, Project } from '../types'
import { programToSourceOf, sourceToProgramOf } from './resolver'
import { wordRange } from './transcriptEdit'
import { useEditor, usePlayback } from '../store'

export const DEFAULT_ZOOM_SCALE = 1.45
export const FALLBACK_ZOOM_DURATION = 3
export const ZOOM_SCALES = [1.2, 1.45, 2] as const
export const ZOOM_LABEL = 'ZOOM'

export function isZoomClip(clip: { text?: string; assetId?: string } | undefined): boolean {
  return Boolean(clip && clip.text === ZOOM_LABEL && !clip.assetId)
}

export type ZoomBasis = 'words' | 'scene' | 'playhead'

export interface ZoomPlacement {
  start: number
  duration: number
  scale: number
  basis: ZoomBasis
}

function place(start: number, end: number, basis: ZoomBasis): ZoomPlacement {
  const raw = Math.max(0, end - start)
  return {
    start,
    duration: raw < 1.2 ? FALLBACK_ZOOM_DURATION : raw,
    scale: DEFAULT_ZOOM_SCALE,
    basis
  }
}

function sceneRange(project: Project, scene: EditorialScene): ZoomPlacement {
  return place(sourceToProgramOf(project, scene.start), sourceToProgramOf(project, scene.end), 'scene')
}

function sceneAtProgram(project: Project, programTime: number): EditorialScene | undefined {
  const source = programToSourceOf(project, programTime)
  return (project.scenes ?? []).find((scene) => source >= scene.start - 0.05 && source <= scene.end + 0.05)
}

function impliedSceneWordIds(project: Project, scene: EditorialScene): string[] {
  return project.transcript.words
    .filter((word) => word.start >= scene.start && word.end <= scene.end)
    .map((word) => word.id)
}

function wordsAreSceneSelection(selectedWordIds: string[], implied: string[]): boolean {
  if (!implied.length || selectedWordIds.length !== implied.length) return false
  const picked = new Set(selectedWordIds)
  return implied.every((id) => picked.has(id))
}

/**
 * Words the user picked, then a non-retake chapter, then a silent-demo under
 * the playhead, then 3s at the playhead. A retake heading does not steal the punch-in.
 */
export function zoomPlacement(
  project: Project,
  programTime: number,
  selectedWordIds: string[],
  selectedSceneId: string | null
): ZoomPlacement {
  const selectedScene = selectedSceneId
    ? (project.scenes ?? []).find((row) => row.id === selectedSceneId)
    : undefined
  const words = wordRange(project.transcript.words, selectedWordIds)
  const implied = selectedScene ? impliedSceneWordIds(project, selectedScene) : []
  const impliedPick = selectedScene && wordsAreSceneSelection(selectedWordIds, implied)

  if (words && !impliedPick) {
    return place(sourceToProgramOf(project, words.start), sourceToProgramOf(project, words.end), 'words')
  }
  if (selectedScene && selectedScene.kind !== 'retake') {
    return sceneRange(project, selectedScene)
  }
  const underPlayhead = sceneAtProgram(project, programTime)
  if (underPlayhead?.kind === 'demo') {
    return sceneRange(project, underPlayhead)
  }
  return {
    start: programTime,
    duration: FALLBACK_ZOOM_DURATION,
    scale: DEFAULT_ZOOM_SCALE,
    basis: 'playhead'
  }
}

export function zoomCommand(placement: ZoomPlacement): Command {
  return { type: 'addZoom', start: placement.start, duration: placement.duration, scale: placement.scale }
}

export function describeZoom(placement: ZoomPlacement): string {
  const scale = '1.2×, 1.45×, or 2× on the picture.'
  if (placement.basis === 'words') {
    return `Zoom on these words — ${placement.duration.toFixed(1)} seconds. ${scale}`
  }
  if (placement.basis === 'scene') {
    return `Zoom on this chapter — ${placement.duration.toFixed(1)} seconds. ${scale}`
  }
  return `Zoom on the picture — 3 seconds from here. ${scale}`
}

export function applyZoomFromContext(): { toast: string; placement: ZoomPlacement } {
  const editor = useEditor.getState()
  const placement = zoomPlacement(
    editor.project,
    usePlayback.getState().programTime,
    editor.selectedWordIds,
    editor.selectedSceneId
  )
  editor.dispatch(zoomCommand(placement))
  usePlayback.getState().playLoop(placement.start, placement.start + placement.duration)
  return { toast: describeZoom(placement), placement }
}
