import { useEditor } from '../store'

export const NORMALIZE_ON_TOAST = 'Voice will hit -16 LUFS on export. Undo to leave the recording as-is.'
export const NORMALIZE_OFF_TOAST = 'Export will keep the recording’s loudness.'

export function setNormalizeFromContext(on = true): { toast: string; on: boolean } {
  useEditor.getState().dispatch({ type: 'setAudioMaster', patch: { normalize: on } })
  return { toast: on ? NORMALIZE_ON_TOAST : NORMALIZE_OFF_TOAST, on }
}

export function toggleNormalizeFromContext(): { toast: string; on: boolean } {
  return setNormalizeFromContext(!useEditor.getState().project.audioMaster.normalize)
}
