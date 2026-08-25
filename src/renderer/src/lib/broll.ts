import type { Asset, Project, Transform } from '../types'
import { DEFAULT_TRANSFORM } from '../types'
import { host } from '../host'
import { explainImportError, mediaBusyToast } from './mediaJobs'
import { pickBroll } from './pickFile'
import { zoomPlacement, type ZoomBasis } from './zoom'
import { useEditor, usePlayback } from '../store'

export const FALLBACK_BROLL_DURATION = 6

/** Lower-right inset so a face cam does not cover the walkthrough. */
export const BROLL_PIP_TRANSFORM: Transform = {
  ...DEFAULT_TRANSFORM,
  x: 420,
  y: 280,
  scale: 0.32
}

export type BrollPlacement = {
  start: number
  duration: number
  basis: ZoomBasis
}

export function brollPlacement(
  project: Project,
  programTime: number,
  selectedWordIds: string[],
  selectedSceneId: string | null
): BrollPlacement {
  const zoom = zoomPlacement(project, programTime, selectedWordIds, selectedSceneId)
  if (zoom.basis === 'playhead') {
    return { start: zoom.start, duration: FALLBACK_BROLL_DURATION, basis: 'playhead' }
  }
  return { start: zoom.start, duration: zoom.duration, basis: zoom.basis }
}

export function describeBroll(placement: BrollPlacement, name: string): string {
  const file = name.replace(/\.[^.]+$/, '')
  if (placement.basis === 'words') {
    return `${file} in the corner on these words. Drag it. Raise clip volume if it should duck the voice.`
  }
  if (placement.basis === 'scene') {
    return `${file} in the corner on this chapter. Drag it. Raise clip volume if it should duck the voice.`
  }
  return `${file} in the corner — 6 seconds from here. Drag it. Raise clip volume if it should duck the voice.`
}

export function applyBrollAsset(asset: Asset): { toast: string; placement: BrollPlacement } {
  const editor = useEditor.getState()
  const placement = brollPlacement(
    editor.project,
    usePlayback.getState().programTime,
    editor.selectedWordIds,
    editor.selectedSceneId
  )
  const duration =
    asset.kind === 'image'
      ? placement.duration
      : Math.min(Math.max(placement.duration, 1), asset.duration || placement.duration)
  editor.dispatch({
    type: 'addBroll',
    start: placement.start,
    duration,
    asset,
    transform: BROLL_PIP_TRANSFORM,
    volume: 0
  })
  return { toast: describeBroll(placement, asset.name), placement }
}

export async function addBrollFromContext(): Promise<{ toast: string; added: boolean }> {
  const editor = useEditor.getState()
  const busy = mediaBusyToast(editor.exporting, editor.analyzing)
  if (busy) return { toast: busy, added: false }
  try {
    await host.beginJob('import')
    editor.setAnalyzing('probe')
    const asset = await pickBroll()
    if (!asset) return { toast: 'No picture picked.', added: false }
    return { ...applyBrollAsset(asset), added: true }
  } catch (err) {
    return { toast: explainImportError(err), added: false }
  } finally {
    await host.endJob('import').catch(() => undefined)
    useEditor.getState().setAnalyzing(null)
  }
}
