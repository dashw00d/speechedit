import type { Project } from '../types'
import { leftoverForSpan, reviewGap } from './analysis'
import { overlap } from './edl'
import { programToSourceOf } from './resolver'
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
  return null
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
  return { ...protectRange(span.start, span.end, kind), started: true }
}
