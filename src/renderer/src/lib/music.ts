import type { Asset, Project } from '../types'
import { host } from '../host'
import { programLength } from './commands'
import { explainImportError, mediaBusyToast } from './mediaJobs'
import { pickAudio } from './pickFile'
import { zoomPlacement, type ZoomBasis } from './zoom'
import { useEditor, usePlayback } from '../store'

export const MUSIC_FADE = 0.4

export type MusicPlacement = {
  start: number
  duration: number
  basis: ZoomBasis
}

export function hasMusicBed(project: Project): boolean {
  return project.tracks.some(
    (track) =>
      track.type === 'audio' &&
      track.id !== 'a1' &&
      track.clips.some((clip) => clip.assetId)
  )
}

export function musicPlacement(
  project: Project,
  programTime: number,
  selectedWordIds: string[],
  selectedSceneId: string | null
): MusicPlacement {
  const zoom = zoomPlacement(project, programTime, selectedWordIds, selectedSceneId)
  if (zoom.basis !== 'playhead') {
    return { start: zoom.start, duration: zoom.duration, basis: zoom.basis }
  }
  const remaining = Math.max(1, programLength(project) - programTime)
  return { start: programTime, duration: remaining, basis: 'playhead' }
}

export function describeMusic(placement: MusicPlacement, name: string): string {
  const file = name.replace(/\.[^.]+$/, '')
  if (placement.basis === 'words') {
    return `${file} under these words. Clip volume is in Picture.`
  }
  if (placement.basis === 'scene') {
    return `${file} under this chapter. Clip volume is in Picture.`
  }
  return `${file} under the voice from here. Clip volume is in Picture.`
}

export function applyMusicAsset(asset: Asset): { toast: string; placement: MusicPlacement } {
  const editor = useEditor.getState()
  const placement = musicPlacement(
    editor.project,
    usePlayback.getState().programTime,
    editor.selectedWordIds,
    editor.selectedSceneId
  )
  const duration = Math.min(Math.max(placement.duration, 1), asset.duration || placement.duration)
  editor.dispatch({
    type: 'addAudio',
    start: placement.start,
    duration,
    asset,
    fadeIn: MUSIC_FADE,
    fadeOut: MUSIC_FADE
  })
  return { toast: describeMusic(placement, asset.name), placement }
}

export async function addMusicFromContext(): Promise<{ toast: string; added: boolean }> {
  const editor = useEditor.getState()
  const busy = mediaBusyToast(editor.exporting, editor.analyzing)
  if (busy) return { toast: busy, added: false }
  try {
    await host.beginJob('import')
    editor.setAnalyzing('probe')
    const asset = await pickAudio()
    if (!asset) return { toast: 'No music picked.', added: false }
    return { ...applyMusicAsset(asset), added: true }
  } catch (err) {
    return { toast: explainImportError(err), added: false }
  } finally {
    await host.endJob('import').catch(() => undefined)
    useEditor.getState().setAnalyzing(null)
  }
}
