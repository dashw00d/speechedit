import { programLength } from './commands'
import { programToSourceOf, sourceToProgramOf } from './resolver'
import { wordRange } from './transcriptEdit'
import { useEditor, usePlayback } from '../store'
import type { Project } from '../types'

export const MARK_CLIP_TOAST = 'Clip marked. Export marked range, or Clear marks for the next one.'

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
    usePlayback.getState().playLoop(sourceToProgramOf(project, words.start), sourceToProgramOf(project, words.end))
    return { toast: MARK_CLIP_TOAST, marked: true }
  }
  if (editor.selectedGap) {
    const markIn = sourceToProgramOf(project, editor.selectedGap.start)
    const markOut = sourceToProgramOf(project, editor.selectedGap.end)
    editor.dispatch({
      type: 'setMarks',
      markIn,
      markOut
    })
    usePlayback.getState().playLoop(markIn, markOut)
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
    usePlayback.getState().playLoop(sourceToProgramOf(project, scene.start), sourceToProgramOf(project, scene.end))
    return { toast: MARK_CLIP_TOAST, marked: true }
  }
  if (project.markIn != null || project.markOut != null) return { ...clearMarksFromContext(), marked: false }
  return { toast: 'Select words or find a phrase, then Mark clip.', marked: false }
}

export function markedSourceSpan(project: Project): { start: number; end: number } | null {
  if (project.markIn == null || project.markOut == null) return null
  return {
    start: programToSourceOf(project, Math.min(project.markIn, project.markOut)),
    end: programToSourceOf(project, Math.max(project.markIn, project.markOut))
  }
}

/** Shorten pauses inside In–Out. Protected demo stays. Marks stay so you can export or cut next. */
export function tightenMarksFromContext(): { toast: string; tightened: boolean } {
  const editor = useEditor.getState()
  const span = markedSourceSpan(editor.project)
  if (!span) return { toast: 'Mark In and Out, then Tighten marked.', tightened: false }
  const before = programLength(editor.project)
  editor.dispatch({ type: 'tightenRange', start: span.start, end: span.end })
  const saved = before - programLength(useEditor.getState().project)
  if (saved < 0.05) {
    const words = editor.project.transcript.words.filter((word) => !word.deleted && word.end > span.start && word.start < span.end)
    return {
      toast: words.length < 2
        ? 'This range is one pause. Cut marked removes it.'
        : 'No pauses to tighten in this range.',
      tightened: false
    }
  }
  const savedLabel = saved < 10 ? `${saved.toFixed(1)} seconds` : `${Math.round(saved)} seconds`
  const next = useEditor.getState().project
  if (next.markIn != null && next.markOut != null) {
    usePlayback
      .getState()
      .playLoop(Math.min(next.markIn, next.markOut), Math.max(next.markIn, next.markOut))
  }
  return {
    toast: `Tightened the marked pauses. Saved ${savedLabel}. Hear it — Cut marked or Export marked range is next.`,
    tightened: true
  }
}

export const CUT_MARKED_TOAST = 'Removed the marked range and closed the gap. Hear the join. Mark the next stretch, or you are done.'
export const LIFT_MARKED_TOAST = 'Lifted the marked range. The hole stays. Mark the next stretch, or Undo to put it back.'

/** Remove the In–Out span. Ripple closes the gap; Lift leaves a hole. */
export function cutMarksFromContext(): { toast: string; cut: boolean } {
  const editor = useEditor.getState()
  if (editor.project.markIn == null || editor.project.markOut == null) {
    return { toast: 'Mark In and Out, then Cut marked.', cut: false }
  }
  const join = Math.min(editor.project.markIn, editor.project.markOut)
  const ripple = editor.ripple
  editor.dispatch({ type: ripple ? 'rippleDeleteMarks' : 'liftMarks' })
  editor.clearSelection()
  const end = programLength(useEditor.getState().project)
  const from = Math.max(0, join - 0.6)
  const to = Math.min(end, join + 1.4)
  if (to - from > 0.2) usePlayback.getState().playLoop(from, to)
  else usePlayback.getState().seekProgram(join)
  return {
    toast: ripple ? CUT_MARKED_TOAST : LIFT_MARKED_TOAST,
    cut: true
  }
}

export function describeClearMarks(query = '', opts: { nextHit?: boolean } = {}): string {
  const phrase = query.trim()
  if (phrase && opts.nextHit) return `Next “${phrase}” — Hear it, or Mark clip.`
  if (phrase) return `That was the last “${phrase}”. Find another line, or you are done.`
  return 'Marks cleared. Find the next clip, then Mark clip.'
}

/** Clear In–Out so the next hunt starts clean. Advances Find when a phrase is still open. */
export function clearMarksFromContext(): { toast: string; cleared: boolean } {
  const editor = useEditor.getState()
  if (editor.project.markIn == null && editor.project.markOut == null) {
    return { toast: 'No marks to clear.', cleared: false }
  }
  editor.dispatch({ type: 'setMarks', markIn: null, markOut: null })
  const hunt = { toast: describeClearMarks() }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('speechedit:find', { detail: { advance: true, hunt } }))
  }
  return { toast: hunt.toast, cleared: true }
}
