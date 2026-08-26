import { leftoverHearQueue, leftoverKind, type LeftoverKind } from './analysis'
import { suggestTask } from './contextActions'
import { sourceToProgramOf } from './resolver'
import { useEditor, usePlayback } from '../store'
import type { Command, EditSuggestion, Project } from '../types'

export type LeftoverDecision = 'cut' | 'keep' | 'demo' | 'speed' | 'quiet'

const KINDS: Record<LeftoverDecision, ReadonlySet<LeftoverKind>> = {
  cut: new Set(['activity', 'still', 'breath']),
  keep: new Set(['activity', 'still', 'static', 'loud', 'breath']),
  demo: new Set(['activity', 'still']),
  speed: new Set(['activity', 'still', 'static', 'low-motion']),
  quiet: new Set(['loud'])
}

const TOAST: Record<LeftoverDecision, { done: string; next: string; empty: string }> = {
  cut: {
    empty: 'No leftover fidget to cut.',
    done: 'Cut the leftover. Undo to put it back.',
    next: 'Cut the leftover. The next leftover is looping — Speed, Cut, or Keep.'
  },
  keep: {
    empty: 'No leftover to protect.',
    done: 'Protected. Auto Edit will skip this.',
    next: 'Protected. Auto Edit will skip this. The next leftover is looping.'
  },
  demo: {
    empty: 'No leftover walkthrough to keep.',
    done: 'Silent demo. Auto Edit will skip pauses here.',
    next: 'Silent demo. Auto Edit will skip pauses here. The next leftover is looping.'
  },
  speed: {
    empty: 'No leftover wait to speed.',
    done: 'Sped the wait 4×. Undo to play it at 1×.',
    next: 'Sped the wait 4×. The next leftover is looping — Speed, Cut, or Keep.'
  },
  quiet: {
    empty: 'No leftover spike to quiet.',
    done: 'Quieted the spike. Undo to restore the level.',
    next: 'Quieted the spike. The next leftover is looping — Speed, Cut, or Keep.'
  }
}

export function leftoverAllows(suggestion: EditSuggestion, decision: LeftoverDecision): boolean {
  return KINDS[decision].has(leftoverKind(suggestion))
}

export function leftoverIsBreath(suggestion: EditSuggestion | null | undefined): boolean {
  return Boolean(suggestion && leftoverKind(suggestion) === 'breath')
}

export function leftoverHearLabel(count: number): string {
  if (count > 1) return `${count} breaths`
  return 'Hear breath'
}

function leftoverNextToast(decision: LeftoverDecision, next: EditSuggestion): string {
  if (leftoverKind(next) === 'breath') {
    return `${TOAST[decision].done} The next breath is looping — Cut if it hisses, Keep if it should stay.`
  }
  return TOAST[decision].next
}

export function leftoverDecideTarget(
  project: Project,
  selectedSuggestionId: string | null,
  decision: LeftoverDecision
): EditSuggestion | null {
  const queue = leftoverHearQueue(project).filter((row) => leftoverAllows(row, decision))
  if (!queue.length) return null
  return queue.find((row) => row.id === selectedSuggestionId) ?? queue[0] ?? null
}

function leftoverNext(project: Project): EditSuggestion | undefined {
  return leftoverHearQueue(project)[0]
}

export function leftoverHearTarget(
  project: Project,
  selectedSuggestionId: string | null
): EditSuggestion | null {
  const queue = leftoverHearQueue(project)
  if (!queue.length) return null
  return queue.find((row) => row.id === selectedSuggestionId) ?? queue[0] ?? null
}

/** The leftover you are already on — Hear or a leftover chip. Not the next one in line. */
export function leftoverActiveTarget(
  project: Project,
  selectedSuggestionId: string | null
): EditSuggestion | null {
  if (!selectedSuggestionId) return null
  return leftoverHearQueue(project).find((row) => row.id === selectedSuggestionId) ?? null
}

/** After the last leftover, name the next job so Clean / Review is obvious. */
export function leftoverDoneNext(project: Project): string {
  const task = suggestTask(project)
  if (task.applyLabel) return `${task.applyLabel} is next.`
  if (task.collapseRetakes) return 'Collapse retakes is next.'
  if (task.findRetakes) return 'Find retakes is next.'
  if (task.showBreaths) return `${leftoverHearLabel(task.breathCount)} is next.`
  if (task.reviewCount > 0) return `${task.reviewLabel} is next.`
  if (task.showWatch) return 'Watch the edited reel is next.'
  return 'Nothing leftover.'
}

/** After the last take pick, name Clean / fillers / Watch — not Review the take you just dropped. */
export function takeDoneNext(project: Project): string {
  const task = suggestTask(project)
  if (task.applyLabel) return `${task.applyLabel} is next.`
  if (task.collapseRetakes) return 'Collapse retakes is next.'
  if (task.fillerCount > 0) return `Cut ${task.fillerCount} fillers is next.`
  if (task.showBreaths) return `${leftoverHearLabel(task.breathCount)} is next.`
  if (task.reviewCount > 0) return `${task.reviewLabel} is next.`
  if (task.showWatch) return 'Watch the edited reel is next.'
  return 'That take is decided.'
}

export function leftoverHearFromContext(): { toast: string; heard: boolean } {
  const editor = useEditor.getState()
  const target = leftoverHearTarget(editor.project, editor.selectedSuggestionId)
  if (!target) return { toast: 'No leftover to hear.', heard: false }
  editor.selectSuggestion(target.id)
  usePlayback
    .getState()
    .playLoop(sourceToProgramOf(editor.project, target.start), sourceToProgramOf(editor.project, target.end))
  const kind = leftoverKind(target)
  if (kind === 'breath') {
    return { toast: 'Hearing this breath. Cut if it hisses, Keep if it should stay — on the bar.', heard: true }
  }
  const next =
    kind === 'activity'
      ? 'Silent demo, Speed, Cut, or Keep are on the bar.'
      : kind === 'loud'
        ? 'Quiet or Keep are on the bar.'
        : 'Speed, Cut, or Keep are on the bar.'
  return { toast: `Hearing this leftover. ${next}`, heard: true }
}

function commandFor(suggestion: EditSuggestion, decision: LeftoverDecision): Command {
  if (decision === 'quiet') return { type: 'applySuggestion', suggestionId: suggestion.id }
  if (decision === 'keep' && (leftoverKind(suggestion) === 'static' || leftoverKind(suggestion) === 'loud')) {
    return { type: 'dismissSuggestion', suggestionId: suggestion.id }
  }
  if (decision === 'cut' || decision === 'keep' || decision === 'demo' || decision === 'speed') {
    return { type: 'resolveSuggestion', suggestionId: suggestion.id, resolution: decision }
  }
  return { type: 'applySuggestion', suggestionId: suggestion.id }
}

export function leftoverDecideFromContext(decision: LeftoverDecision): { toast: string; ok: boolean } {
  const editor = useEditor.getState()
  const target = leftoverDecideTarget(editor.project, editor.selectedSuggestionId, decision)
  const copy = TOAST[decision]
  if (!target) return { toast: copy.empty, ok: false }
  editor.dispatch(commandFor(target, decision))
  const nextProject = useEditor.getState().project
  const next = leftoverNext(nextProject)
  if (next) {
    useEditor.getState().selectSuggestion(next.id)
    usePlayback
      .getState()
      .playLoop(sourceToProgramOf(nextProject, next.start), sourceToProgramOf(nextProject, next.end))
    return { toast: leftoverNextToast(decision, next), ok: true }
  }
  editor.selectSuggestion(null)
  usePlayback.getState().pause()
  return { toast: `${copy.done} ${leftoverDoneNext(nextProject)}`, ok: true }
}

export function leftoverIsSpeedable(suggestion: EditSuggestion): boolean {
  return leftoverAllows(suggestion, 'speed')
}

export function leftoverIsDemoable(suggestion: EditSuggestion): boolean {
  return leftoverAllows(suggestion, 'demo')
}

export function leftoverSpeedTarget(project: Project, selectedSuggestionId: string | null) {
  return leftoverDecideTarget(project, selectedSuggestionId, 'speed')
}

export function leftoverDemoTarget(project: Project, selectedSuggestionId: string | null) {
  return leftoverDecideTarget(project, selectedSuggestionId, 'demo')
}

export function leftoverCutTarget(project: Project, selectedSuggestionId: string | null) {
  return leftoverDecideTarget(project, selectedSuggestionId, 'cut')
}

export function leftoverKeepTarget(project: Project, selectedSuggestionId: string | null) {
  return leftoverDecideTarget(project, selectedSuggestionId, 'keep')
}

export function leftoverQuietTarget(project: Project, selectedSuggestionId: string | null) {
  return leftoverDecideTarget(project, selectedSuggestionId, 'quiet')
}

export function leftoverSpeedFromContext() {
  const result = leftoverDecideFromContext('speed')
  return { toast: result.toast, sped: result.ok }
}

export function leftoverDemoFromContext() {
  const result = leftoverDecideFromContext('demo')
  return { toast: result.toast, kept: result.ok }
}

export function leftoverCutFromContext() {
  const result = leftoverDecideFromContext('cut')
  return { toast: result.toast, cut: result.ok }
}

export function leftoverKeepFromContext() {
  const result = leftoverDecideFromContext('keep')
  return { toast: result.toast, kept: result.ok }
}

export function leftoverQuietFromContext() {
  const result = leftoverDecideFromContext('quiet')
  return { toast: result.toast, quiet: result.ok }
}
