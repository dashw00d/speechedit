import { useEditor } from '../store'

export function applyCaptionStyleToAllFromContext(): { toast: string; applied: boolean } {
  const editor = useEditor.getState()
  const clip = editor.project.tracks
    .flatMap((track) => track.clips)
    .find((row) => row.id === editor.selectedClipId)
  if (!clip?.text) return { toast: 'Select a title or caption first.', applied: false }
  const others = editor.project.tracks.flatMap((track) => track.clips).filter((row) => row.text && row.id !== clip.id)
  if (!others.length) return { toast: 'This is the only title. Style it here.', applied: false }
  editor.dispatch({ type: 'setCaptionStyleAll', style: clip.style ?? {} })
  return { toast: 'This look is on every title and caption.', applied: true }
}
