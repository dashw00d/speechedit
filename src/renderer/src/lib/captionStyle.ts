import { useEditor, usePlayback } from '../store'
import type { Clip, Project } from '../types'
import { isZoomClip } from './zoom'
import { isRedactionClip } from './redaction'

export function textClipsOf(project: Project): Clip[] {
  return project.tracks
    .flatMap((track) => track.clips)
    .filter((clip) => Boolean(clip.text) && !clip.assetId && !isZoomClip(clip) && !isRedactionClip(clip))
}

/** Fill, stroke, and size — not position or align. A title must not smash a lower third. */
export function captionLookOf(clip: Clip): { fill?: string; stroke?: string; fontSize?: number } {
  return {
    fill: clip.style?.fill,
    stroke: clip.style?.stroke,
    fontSize: clip.style?.fontSize
  }
}

/** Selected title/caption, the card on the playhead, or the first handmade name. */
export function styleSourceClip(project: Project, selectedClipId: string | null, programTime?: number): Clip | null {
  const texts = textClipsOf(project)
  if (!texts.length) return null
  const selected = selectedClipId ? texts.find((clip) => clip.id === selectedClipId) : undefined
  if (selected) return selected
  if (programTime != null) {
    const onScreen = texts.find((clip) => programTime >= clip.start && programTime < clip.start + clip.duration)
    if (onScreen) return onScreen
  }
  const handmade = texts.find((clip) => !clip.auto)
  return handmade ?? texts[0] ?? null
}

export function nextTextClip(project: Project, afterId: string): Clip | null {
  const texts = [...textClipsOf(project)].sort((a, b) => a.start - b.start)
  if (texts.length < 2) return null
  const index = texts.findIndex((clip) => clip.id === afterId)
  if (index < 0) return texts[0] ?? null
  return texts[(index + 1) % texts.length] ?? null
}

export function canApplyCaptionStyleAll(
  project: Project,
  selectedClipId: string | null,
  programTime?: number
): boolean {
  const source = styleSourceClip(project, selectedClipId, programTime)
  if (!source) return false
  return textClipsOf(project).some((clip) => clip.id !== source.id)
}

export function describeStyleAll(count: number, nextTitle?: string): string {
  const cards = count === 1 ? '1 title' : `${count} titles`
  const named = nextTitle?.split(/\n/)[0]?.trim()
  const label = named && named !== 'Name' && named !== 'Title' ? named : ''
  if (label) return `This look is on ${cards}. ${label} is next — Export when they match.`
  return `This look is on ${cards}. Hear the next card, or Export.`
}

export function applyCaptionStyleToAllFromContext(): { toast: string; applied: boolean } {
  const editor = useEditor.getState()
  const programTime = usePlayback.getState().programTime
  const clip = styleSourceClip(editor.project, editor.selectedClipId, programTime)
  if (!clip?.text) return { toast: 'Select a title or caption first.', applied: false }
  const others = textClipsOf(editor.project).filter((row) => row.id !== clip.id)
  if (!others.length) return { toast: 'This is the only title. Style it here.', applied: false }
  editor.dispatch({ type: 'setCaptionStyleAll', style: captionLookOf(clip) })
  const nextProject = useEditor.getState().project
  const next = nextTextClip(nextProject, clip.id)
  const count = textClipsOf(nextProject).length
  if (next && next.id !== clip.id) {
    usePlayback.getState().playLoop(next.start, next.start + next.duration)
  }
  editor.clearSelection()
  return { toast: describeStyleAll(count, next?.text), applied: true }
}
