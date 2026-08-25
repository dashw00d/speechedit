import type { Command } from '../types'
import { useEditor, usePlayback } from '../store'
import { zoomPlacement, type ZoomBasis } from './zoom'

export const FALLBACK_REDACT_DURATION = 4

export type RedactionPlacement = {
  start: number
  duration: number
  basis: ZoomBasis
}

export function redactionPlacement(
  project: Parameters<typeof zoomPlacement>[0],
  programTime: number,
  selectedWordIds: string[],
  selectedSceneId: string | null
): RedactionPlacement {
  const zoom = zoomPlacement(project, programTime, selectedWordIds, selectedSceneId)
  if (zoom.basis === 'playhead') {
    return { start: zoom.start, duration: FALLBACK_REDACT_DURATION, basis: 'playhead' }
  }
  return { start: zoom.start, duration: zoom.duration, basis: zoom.basis }
}

export function redactionCommand(placement: RedactionPlacement): Command {
  return { type: 'addRedaction', start: placement.start, duration: placement.duration }
}

export function describeRedaction(placement: RedactionPlacement): string {
  if (placement.basis === 'words') {
    return `Blur on these words — ${placement.duration.toFixed(1)} seconds. Drag the box over what should stay hidden.`
  }
  if (placement.basis === 'scene') {
    return `Blur on this chapter — ${placement.duration.toFixed(1)} seconds. Drag the box over what should stay hidden.`
  }
  return 'Blur on the picture — 4 seconds from here. Drag the box over what should stay hidden.'
}

export function applyRedactionFromContext(): { toast: string; placement: RedactionPlacement } {
  const editor = useEditor.getState()
  const placement = redactionPlacement(
    editor.project,
    usePlayback.getState().programTime,
    editor.selectedWordIds,
    editor.selectedSceneId
  )
  editor.dispatch(redactionCommand(placement))
  return { toast: describeRedaction(placement), placement }
}
