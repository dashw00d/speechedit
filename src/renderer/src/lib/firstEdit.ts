import type { EditSuggestion, Interval, Project } from '../types'
import { overlap } from './edl'
import { useEditor } from '../store'
import { hasUncollapsedRetakes, uncollapsedRetakeCount } from './sceneAnalysis'

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

export type FirstEditPhase = 'looks' | 'words' | 'all'

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
  const unit = result.unit ?? (phase === 'words' ? 'filler' : 'pause')
  return describeFirstEdit(result.applied, result.review, result.retakes, unit)
}

export function looksSafeSpans(project: Project): Interval[] {
  return safeEditCandidates(project).map((suggestion) => ({ start: suggestion.start, end: suggestion.end }))
}

function offeredAtLooks(suggestion: EditSuggestion, skip: Interval[]): boolean {
  return skip.some((span) => overlap(suggestion, span) > (suggestion.end - suggestion.start) * 0.6)
}

/**
 * Apply pending safe edits for this import phase.
 * `looks` — silence / normalize once analysis lands (do not wait for Whisper).
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
  if (phase === 'words') {
    const pending = safeEditCandidates(editor.project).filter((suggestion) => !offeredAtLooks(suggestion, skip))
    if (pending.length) {
      editor.dispatch({ type: 'applySuggestions', suggestionIds: pending.map((suggestion) => suggestion.id) })
    }
    const beforeRetakes = uncollapsedRetakeCount(useEditor.getState().project)
    if (beforeRetakes) useEditor.getState().dispatch({ type: 'collapseRetakes' })
    const dropped = beforeRetakes - uncollapsedRetakeCount(useEditor.getState().project)
    if (!pending.length && !dropped) return null
    return {
      ...firstEditSummary(useEditor.getState().project),
      applied: pending.length,
      retakes: dropped,
      unit: pending.some((suggestion) => suggestion.type !== 'filler') ? 'pause' : 'filler'
    }
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
