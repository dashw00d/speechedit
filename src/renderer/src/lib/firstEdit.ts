import type { EditSuggestion, EditorialScene, Interval, Project } from '../types'
import { leftoverHearQueue, leftoverItems, leftoverKind, leftoverReviewQueue } from './analysis'
import { captionClipsOf, shouldAutoCaption } from './captions'
import { overlap } from './edl'
import { sourceToProgramOf } from './resolver'
import { useEditor, usePlayback } from '../store'
import {
  droppedRetakeCount,
  hasUncollapsedRetakes,
  retakeReviewQueue,
  retakeSceneDropped,
  uncollapsedRetakeCount
} from './sceneAnalysis'
import { takeDoneNext } from './leftoverDecide'
import { reviewDrawerCopy, reviewJob } from './reviewDrawer'

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

export type FirstEditResult = {
  applied: number
  review: number
  retakes: number
  unit?: 'pause' | 'filler'
}

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
 * Run automatic-edit work as one undo unit so the recovery the toast offers
 * (and the edit it names) share a single history boundary. Later streaming
 * chunks use replay/patch, which do not open a new entry, so `endHistoryGroup`
 * only records a snapshot when a real dispatch changed the project.
 */
export function groupHistory<T>(fn: () => T): T {
  const editor = useEditor.getState()
  editor.beginHistoryGroup()
  try {
    return fn()
  } finally {
    editor.endHistoryGroup()
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
): FirstEditResult | null {
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
  session: { wordsUndo: boolean; lastEdit?: FirstEditResult }
): FirstEditResult | null {
  const pending = pendingWordEdits(useEditor.getState().project, skip)
  if (!pending.length) return null
  let result: FirstEditResult | null
  if (!session.wordsUndo) {
    session.wordsUndo = true
    result = applySafeFirstEdit('fillers', skip)
  } else {
    useEditor.getState().replay({
      type: 'applySuggestions',
      suggestionIds: pending.map((suggestion) => suggestion.id)
    })
    result = wordEditResult(pending, 0)
  }
  session.lastEdit = result ?? undefined
  return result
}

export type CaptionAutoSession = {
  captionsUndo: boolean
  skipCaptions: boolean
  captionCount: number
  captionsToast?: boolean
  wordsUndo?: boolean
  lastEdit?: FirstEditResult
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

/** Dismiss talking-over-static and pace notes so Review stays on leftovers you can hear. Breaths stay. */
export function dismissLeftoverBreaths(): number {
  const project = useEditor.getState().project
  const ids = [
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
  usePlayback.getState().playLoop(sourceToProgramOf(editor.project, next.start), sourceToProgramOf(editor.project, next.end))
  const kind = leftoverKind(next)
  return kind === 'activity' || kind === 'still' || kind === 'static' || kind === 'loud' ? kind : false
}

export function describeBreathReview(count: number): string {
  if (count <= 0) return 'No leftover breaths in this reel.'
  return `${count} breath${count === 1 ? '' : 's'} stayed in the reel. Hear this one — Cut if it hisses, Keep if it should stay.`
}

/** Open review on the first leftover breath and loop it. */
export function startBreathReview(): EditSuggestion | false {
  const project = useEditor.getState().project
  const next = leftoverItems(project, 'breath')[0]
  if (!next) return false
  const editor = useEditor.getState()
  editor.setReviewing(true)
  editor.selectSuggestion(next.id)
  usePlayback.getState().playLoop(sourceToProgramOf(project, next.start), sourceToProgramOf(project, next.end))
  return next
}

export function nextLeftoverToHear(project: Project): EditSuggestion | undefined {
  return leftoverHearQueue(project)[0]
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

/** Open review on the first retake that still needs a decision. */
export function startRetakeReview(): EditorialScene | false {
  const project = useEditor.getState().project
  const next = retakeReviewQueue(project).find((row) => !retakeSceneDropped(project, row))
  if (!next) return false
  const editor = useEditor.getState()
  editor.setReviewing(true)
  editor.selectScene(next.id)
  usePlayback.getState().playLoop(sourceToProgramOf(project, next.start), sourceToProgramOf(project, next.end))
  return next
}

/** Open the review job the bar already named, hear it, and say the next pick. */
export function openReviewFromContext(): { toast: string; job: ReturnType<typeof reviewJob> } {
  const project = useEditor.getState().project
  const job = reviewJob(project)
  if (job === 'leftover') {
    const kind = startLeftoverReview()
    if (kind) {
      return { toast: `Hearing this leftover. ${reviewDrawerCopy(useEditor.getState().project).detail}`, job }
    }
  }
  if (job === 'retake') {
    const scene = startRetakeReview()
    if (!scene) return { toast: 'No retakes in this transcript.', job }
    return { toast: reviewDrawerCopy(useEditor.getState().project).detail, job }
  }
  if (job === 'breath') {
    startBreathReview()
    return { toast: describeBreathReview(leftoverItems(useEditor.getState().project, 'breath').length), job }
  }
  useEditor.getState().setReviewing(true)
  return { toast: reviewDrawerCopy(project).detail, job }
}

export { takeDoneNext }

export function describeTakeDecision(project: Project, next: EditorialScene | undefined): string {
  if (!next) return `Take decided. ${takeDoneNext(project)}`
  const n = retakeReviewQueue(project).length
  return n === 1 ? 'Hear this one, then Use later take or Put back.' : `${n} takes. Hear one, then pick.`
}

/** Infer scenes, then hear the first take that still needs a decision. */
export function findRetakesAndReview(): { toast: string; scene: EditorialScene | false } {
  useEditor.getState().dispatch({ type: 'inferScenes' })
  const scene = startRetakeReview()
  return { toast: describeRetakeReview(useEditor.getState().project, scene), scene }
}
