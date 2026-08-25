import type { EditSuggestion, EditorialScene, Interval, Project } from '../types'
import { leftoverItems, leftoverKind, leftoverReviewQueue } from './analysis'
import { captionClipsOf, shouldAutoCaption } from './captions'
import { overlap } from './edl'
import { sourceToProgramOf } from './resolver'
import { useEditor, usePlayback } from '../store'
import {
  droppedRetakeCount,
  hasUncollapsedRetakes,
  retakeReviewQueue,
  uncollapsedRetakeCount
} from './sceneAnalysis'

function countLabel(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

/** Same filter as applySafeSuggestions — silence / filler / normalize that is safe and unblocked. */
export function safeEditCandidates(project: Project): EditSuggestion[] {
  return project.suggestions.filter(
    (suggestion) =>
      suggestion.safe &&
      !suggestion.applied &&
      !suggestion.blockedBy &&
      (suggestion.action === 'cut' || suggestion.action === 'normalize')
  )
}

export function firstEditSummary(project: Project): { applied: number; review: number; retakes: number } {
  return {
    applied: project.suggestions.filter((suggestion) => suggestion.applied && suggestion.safe).length,
    review: project.suggestions.filter(
      (suggestion) => !suggestion.applied && !suggestion.safe && suggestion.action !== 'normalize'
    ).length,
    retakes: project.suggestions.filter((suggestion) => suggestion.applied && suggestion.type === 'repeat').length
  }
}

export type FirstEditPhase = 'looks' | 'fillers' | 'words' | 'all'

export function describeFirstEdit(
  applied: number,
  review: number,
  retakes = 0,
  unit: 'pause' | 'filler' = 'pause'
): string {
  const parts = [
    applied > 0 ? `Removed ${countLabel(applied, unit)}` : '',
    retakes > 0 ? `Dropped ${countLabel(retakes, 'false take')}` : ''
  ].filter(Boolean)
  const lead = parts.join('. ') || 'First edit applied'
  if (review > 0) {
    return `${lead}. ${countLabel(review, 'decision')} need review. Undo to put them back.`
  }
  return `${lead}. Undo to put them back.`
}

export function describeFirstEditResult(
  result: { applied: number; review: number; retakes: number; unit?: 'pause' | 'filler' },
  phase: FirstEditPhase
): string {
  const unit = result.unit ?? (phase === 'words' || phase === 'fillers' ? 'filler' : 'pause')
  return describeFirstEdit(result.applied, result.review, result.retakes, unit)
}

export function looksSafeSpans(project: Project): Interval[] {
  return safeEditCandidates(project).map((suggestion) => ({ start: suggestion.start, end: suggestion.end }))
}

function offeredAtLooks(suggestion: EditSuggestion, skip: Interval[]): boolean {
  return skip.some((span) => overlap(suggestion, span) > (suggestion.end - suggestion.start) * 0.6)
}

export function pendingWordEdits(project: Project, skip: Interval[] = []): EditSuggestion[] {
  return safeEditCandidates(project).filter((suggestion) => !offeredAtLooks(suggestion, skip))
}

export function offeredWordSpans(project: Project, skip: Interval[] = []): Interval[] {
  return pendingWordEdits(project, skip).map((suggestion) => ({
    start: suggestion.start,
    end: suggestion.end
  }))
}

function wordEditResult(
  pending: EditSuggestion[],
  retakes: number
): { applied: number; review: number; retakes: number; unit?: 'pause' | 'filler' } {
  return {
    ...firstEditSummary(useEditor.getState().project),
    applied: pending.length,
    retakes,
    unit: pending.some((suggestion) => suggestion.type !== 'filler') ? 'pause' : 'filler'
  }
}

/**
 * Apply pending safe edits for this import phase.
 * `looks` — silence / normalize once analysis lands (do not wait for Whisper).
 * `fillers` — new safe word edits only (no retake collapse). Used as ASR chunks arrive.
 * `words` — new safe edits (fillers, word-edge pauses) + retakes. `skip` is looks-time
 * ranges so an undone pause is not applied again.
 * `all` — both, two undo steps (Undo puts retakes back first).
 */
export function applySafeFirstEdit(
  phase: FirstEditPhase = 'all',
  skip: Interval[] = []
): { applied: number; review: number; retakes: number; unit?: 'pause' | 'filler' } | null {
  const editor = useEditor.getState()
  if (phase === 'looks') {
    const pending = safeEditCandidates(editor.project)
    if (!pending.length) return null
    editor.dispatch({ type: 'applySafeSuggestions' })
    return { ...firstEditSummary(useEditor.getState().project), applied: pending.length, retakes: 0 }
  }
  if (phase === 'fillers' || phase === 'words') {
    const pending = pendingWordEdits(editor.project, skip)
    if (pending.length) {
      editor.dispatch({ type: 'applySuggestions', suggestionIds: pending.map((suggestion) => suggestion.id) })
    }
    if (phase === 'fillers') {
      if (!pending.length) return null
      return wordEditResult(pending, 0)
    }
    const beforeRetakes = uncollapsedRetakeCount(useEditor.getState().project)
    if (beforeRetakes) useEditor.getState().dispatch({ type: 'collapseRetakes' })
    const dropped = beforeRetakes - uncollapsedRetakeCount(useEditor.getState().project)
    if (!pending.length && !dropped) return null
    return wordEditResult(pending, dropped)
  }
  const pending = safeEditCandidates(editor.project)
  const retakesWaiting = hasUncollapsedRetakes(editor.project)
  if (!pending.length && !retakesWaiting) return null
  if (pending.length) editor.dispatch({ type: 'applySafeSuggestions' })
  const beforeRetakes = uncollapsedRetakeCount(useEditor.getState().project)
  if (beforeRetakes) useEditor.getState().dispatch({ type: 'collapseRetakes' })
  const dropped = beforeRetakes - uncollapsedRetakeCount(useEditor.getState().project)
  return { ...firstEditSummary(useEditor.getState().project), retakes: dropped }
}

/**
 * Apply new safe word edits as ASR grows. The first call is one undo step; later
 * chunks replay onto the current project so a long recording does not stack undos.
 */
export function applyStreamingFirstEdit(
  skip: Interval[],
  session: { wordsUndo: boolean }
): { applied: number; review: number; retakes: number; unit?: 'pause' | 'filler' } | null {
  const pending = pendingWordEdits(useEditor.getState().project, skip)
  if (!pending.length) return null
  if (!session.wordsUndo) {
    session.wordsUndo = true
    return applySafeFirstEdit('fillers', skip)
  }
  useEditor.getState().replay({
    type: 'applySuggestions',
    suggestionIds: pending.map((suggestion) => suggestion.id)
  })
  return wordEditResult(pending, 0)
}

export type CaptionAutoSession = {
  captionsUndo: boolean
  skipCaptions: boolean
  captionCount: number
  captionsToast?: boolean
}

export function emptyCaptionSession(): CaptionAutoSession {
  return { captionsUndo: false, skipCaptions: false, captionCount: 0, captionsToast: false }
}

/**
 * Build or refresh transcript captions. First apply is one undo; later chunks
 * patch so a long ASR does not stack history. Undo or a delete locks the track.
 */
export function applyAutoCaptions(session: CaptionAutoSession): boolean {
  const caps = captionClipsOf(useEditor.getState().project)
  if (session.skipCaptions) return false
  if (session.captionsUndo && caps.length === 0) {
    session.skipCaptions = true
    return false
  }
  if (session.captionsUndo && caps.length > 0 && caps.length < session.captionCount) {
    session.skipCaptions = true
    return false
  }
  if (!shouldAutoCaption(useEditor.getState().project)) return false
  const command = { type: 'generateCaptions' as const, maxWords: 5, emphasize: true }
  if (!session.captionsUndo) {
    session.captionsUndo = true
    useEditor.getState().dispatch(command)
  } else {
    useEditor.getState().patch(command)
  }
  session.captionCount = captionClipsOf(useEditor.getState().project).length
  return session.captionCount > 0
}

/** Keep leftover breaths, talking-over-static, and pace notes in the picture. One undo. */
export function dismissLeftoverBreaths(): number {
  const project = useEditor.getState().project
  const ids = [
    ...leftoverItems(project, 'breath'),
    ...leftoverItems(project, 'low-motion'),
    ...project.suggestions.filter(
      (suggestion) => !suggestion.applied && !suggestion.blockedBy && suggestion.type === 'pace'
    )
  ].map((suggestion) => suggestion.id)
  if (!ids.length) return 0
  useEditor.getState().dispatch({
    type: 'dismissSuggestions',
    suggestionIds: ids
  })
  return ids.length
}

/** Open review on the first leftover quiet picture change, still, static screen, or hot spike. */
export function startLeftoverReview(): 'activity' | 'still' | 'static' | 'loud' | false {
  const next = leftoverReviewQueue(useEditor.getState().project)[0]
  if (!next) return false
  const editor = useEditor.getState()
  editor.setReviewing(true)
  editor.selectSuggestion(next.id)
  const kind = leftoverKind(next)
  return kind === 'activity' || kind === 'still' || kind === 'static' || kind === 'loud' ? kind : false
}

export function describeRetakeReview(
  project: Pick<Project, 'scenes' | 'suggestions' | 'transcript'>,
  found: EditorialScene | false
): string {
  if (!found) return 'No retakes in this transcript.'
  const live = uncollapsedRetakeCount(project)
  if (live > 0) {
    return `Found ${live} retake${live === 1 ? '' : 's'}. Hear this one, then Use later take.`
  }
  const dropped = droppedRetakeCount(project)
  return `Dropped ${dropped} false take${dropped === 1 ? '' : 's'}. Hear this one — Put back if it was the good line.`
}

/** Open review on the first live retake, or the first dropped take if first-edit already collapsed them. */
export function startRetakeReview(): EditorialScene | false {
  const project = useEditor.getState().project
  const next = retakeReviewQueue(project)[0]
  if (!next) return false
  const editor = useEditor.getState()
  editor.setReviewing(true)
  editor.selectScene(next.id)
  usePlayback.getState().playLoop(sourceToProgramOf(project, next.start), sourceToProgramOf(project, next.end))
  return next
}

/** Infer scenes, then hear the first take that still needs a decision. */
export function findRetakesAndReview(): { toast: string; scene: EditorialScene | false } {
  useEditor.getState().dispatch({ type: 'inferScenes' })
  const scene = startRetakeReview()
  return { toast: describeRetakeReview(useEditor.getState().project, scene), scene }
}
