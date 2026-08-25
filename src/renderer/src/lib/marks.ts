import { sourceToProgramOf } from './resolver'
import { wordRange } from './transcriptEdit'
import { useEditor } from '../store'

export const MARK_CLIP_TOAST = 'Clip marked. Cut it, export it, or Clear marks for the next one.'

/** In–Out around the current words, pause, or chapter. Same as M. */
export function markClipFromContext(): { toast: string; marked: boolean } {
  const editor = useEditor.getState()
  const project = editor.project
  const words = wordRange(project.transcript.words, editor.selectedWordIds)
  if (words) {
    editor.dispatch({
      type: 'setMarks',
      markIn: sourceToProgramOf(project, words.start),
      markOut: sourceToProgramOf(project, words.end)
    })
    return { toast: MARK_CLIP_TOAST, marked: true }
  }
  if (editor.selectedGap) {
    editor.dispatch({
      type: 'setMarks',
      markIn: sourceToProgramOf(project, editor.selectedGap.start),
      markOut: sourceToProgramOf(project, editor.selectedGap.end)
    })
    return { toast: MARK_CLIP_TOAST, marked: true }
  }
  const scene = editor.selectedSceneId
    ? (project.scenes ?? []).find((row) => row.id === editor.selectedSceneId)
    : undefined
  if (scene) {
    editor.dispatch({
      type: 'setMarks',
      markIn: sourceToProgramOf(project, scene.start),
      markOut: sourceToProgramOf(project, scene.end)
    })
    return { toast: MARK_CLIP_TOAST, marked: true }
  }
  if (project.markIn != null || project.markOut != null) return { ...clearMarksFromContext(), marked: false }
  return { toast: 'Select words or find a phrase, then Mark clip.', marked: false }
}

/** Remove the In–Out span. Ripple closes the gap; Lift leaves a hole. */
export function cutMarksFromContext(): { toast: string; cut: boolean } {
  const editor = useEditor.getState()
  if (editor.project.markIn == null || editor.project.markOut == null) {
    return { toast: 'Mark In and Out, then Cut marked.', cut: false }
  }
  const ripple = editor.ripple
  editor.dispatch({ type: ripple ? 'rippleDeleteMarks' : 'liftMarks' })
  return {
    toast: ripple
      ? 'Removed the marked range and closed the gap. Undo to put it back.'
      : 'Lifted the marked range. The hole stays. Undo to put it back.',
    cut: true
  }
}

/** Clear In–Out so the next hunt starts clean. Focuses find. */
export function clearMarksFromContext(): { toast: string; cleared: boolean } {
  const editor = useEditor.getState()
  if (editor.project.markIn == null && editor.project.markOut == null) {
    return { toast: 'No marks to clear.', cleared: false }
  }
  editor.dispatch({ type: 'setMarks', markIn: null, markOut: null })
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('speechedit:find'))
  return { toast: 'Marks cleared. Find the next clip, then Mark clip.', cleared: true }
}
