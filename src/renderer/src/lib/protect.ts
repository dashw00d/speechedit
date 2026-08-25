import type { Project } from '../types'
import { leftoverForSpan, reviewGap } from './analysis'
import { overlap } from './edl'
import { programToSourceOf, sourceToProgramOf } from './resolver'
import { wordRange } from './transcriptEdit'
import { useEditor, usePlayback } from '../store'

export function rangeWasCut(project: Project, start: number, end: number): boolean {
  return project.cuts.some((cut) => overlap(cut, { start, end }) > 0.02)
}

export function describeProtect(
  project: Project,
  start: number,
  end: number,
  kind: 'keep' | 'demo' = 'keep'
): string {
  const putBack = rangeWasCut(project, start, end)
  if (kind === 'demo') {
    return putBack
      ? 'Silent demo and the pause is back. Auto Edit will skip it.'
      : 'Silent demo. Auto Edit will skip pauses here.'
  }
  return putBack
    ? 'Protected and put back. Auto Edit will skip this.'
    : 'Protected. Auto Edit will skip this.'
}

const THINK_ALOUD = 0.8

/** Longest silence Clean already took. The think-aloud they still need. */
export function longestCutPause(project: Project): { start: number; end: number } | null {
  const applied = project.suggestions
    .filter((row) => row.applied && row.type === 'silence' && !row.blockedBy)
    .sort((a, b) => b.end - b.start - (a.end - a.start))
  const best = applied[0]
  if (best && best.end - best.start >= THINK_ALOUD) return { start: best.start, end: best.end }
  const cut = [...(project.cuts ?? [])].sort((a, b) => b.end - b.start - (a.end - a.start))[0]
  if (cut && cut.end - cut.start >= THINK_ALOUD) return { start: cut.start, end: cut.end }
  return null
}

export function protectSpanFromContext(): { start: number; end: number } | null {
  const editor = useEditor.getState()
  const project = editor.project
  const words = wordRange(project.transcript.words, editor.selectedWordIds)
  if (words) return { start: words.start, end: words.end }
  if (editor.selectedGap) return editor.selectedGap
  const scene = editor.selectedSceneId
    ? (project.scenes ?? []).find((row) => row.id === editor.selectedSceneId)
    : undefined
  if (scene) return { start: scene.start, end: scene.end }
  if (editor.selectedSuggestionId) {
    const suggestion = project.suggestions.find((row) => row.id === editor.selectedSuggestionId)
    if (suggestion) return { start: suggestion.start, end: suggestion.end }
  }
  if (project.markIn != null && project.markOut != null) {
    return {
      start: programToSourceOf(project, Math.min(project.markIn, project.markOut)),
      end: programToSourceOf(project, Math.max(project.markIn, project.markOut))
    }
  }
  const source = programToSourceOf(project, usePlayback.getState().programTime)
  const leftover = leftoverForSpan(project, source - 0.05, source + 0.05)
  if (leftover) return { start: leftover.start, end: leftover.end }
  const review = reviewGap(project, source - 0.2, source + 0.2)
  if (review.kind === 'cut') return { start: review.start, end: review.end }
  return longestCutPause(project)
}

/** A cut pause they parked on — not the longest leftover in the reel. */
export function protectParkedCut(project: Project): { start: number; end: number } | null {
  const editor = useEditor.getState()
  const words = wordRange(project.transcript.words, editor.selectedWordIds)
  if (words && rangeWasCut(project, words.start, words.end)) return { start: words.start, end: words.end }
  if (editor.selectedGap && rangeWasCut(project, editor.selectedGap.start, editor.selectedGap.end)) {
    return editor.selectedGap
  }
  if (editor.selectedSuggestionId) {
    const suggestion = project.suggestions.find((row) => row.id === editor.selectedSuggestionId)
    if (suggestion && rangeWasCut(project, suggestion.start, suggestion.end)) {
      return { start: suggestion.start, end: suggestion.end }
    }
  }
  const source = programToSourceOf(project, usePlayback.getState().programTime)
  const leftover = leftoverForSpan(project, source - 0.05, source + 0.05)
  if (leftover && rangeWasCut(project, leftover.start, leftover.end)) {
    return { start: leftover.start, end: leftover.end }
  }
  const review = reviewGap(project, source - 0.2, source + 0.2)
  if (review.kind === 'cut') return { start: review.start, end: review.end }
  return null
}

export function protectCutTarget(project: Project): { start: number; end: number } | null {
  return protectParkedCut(project) ?? longestCutPause(project)
}

export function protectRange(
  start: number,
  end: number,
  kind: 'keep' | 'demo' = 'keep',
  label?: string
): { toast: string } {
  const editor = useEditor.getState()
  const toast = describeProtect(editor.project, start, end, kind)
  editor.dispatch({
    type: 'addTag',
    start,
    end,
    kind,
    label: label ?? (kind === 'demo' ? 'Silent product demo' : undefined)
  })
  return { toast }
}

export function protectFromContext(kind: 'keep' | 'demo' = 'keep'): { toast: string; started: boolean } {
  const span = protectSpanFromContext()
  if (!span) return { toast: 'Select words, a pause, or a chapter, then Protect.', started: false }
  const result = protectRange(span.start, span.end, kind)
  const next = useEditor.getState().project
  usePlayback.getState().playLoop(sourceToProgramOf(next, span.start), sourceToProgramOf(next, span.end))
  return { ...result, started: true }
}
