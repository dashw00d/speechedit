import type { Command, Project } from '../types'
import { commandForScene, suggestionForScene, takeFamily } from './sceneAnalysis'
import { isFillerToken } from './transcript'
import { coveringAppliedSuggestion, wordRange } from './transcriptEdit'

export type PaceId = 'natural' | 'balanced' | 'tight'

export const PACE_PRESETS: { id: PaceId; label: string; margin: number }[] = [
  { id: 'natural', label: 'Natural', margin: 0.22 },
  { id: 'balanced', label: 'Balanced', margin: 0.12 },
  { id: 'tight', label: 'Tight', margin: 0.04 }
]

export interface ContextChoice {
  id: string
  label: string
  consequence: string
  command: Command
}

export type InspectorFocus = 'job' | 'words' | 'suggestion' | 'caption' | 'clip' | 'project'

export interface SuggestTask {
  headline: string
  applyLabel: string | null
  reviewLabel: string
  reviewCount: number
  safeCount: number
  findRetakes: boolean
  showWatch: boolean
}

export function formatSpan(seconds: number): string {
  if (seconds < 0.05) return 'a moment'
  if (seconds < 10) return `${seconds.toFixed(1)} seconds`
  return `${Math.round(seconds)} seconds`
}

export function paceFromMargin(margin: number): PaceId {
  if (margin <= 0.07) return 'tight'
  if (margin >= 0.18) return 'natural'
  return 'balanced'
}

export function transcriptChoices(project: Project, selectedWordIds: string[]): {
  summary: string
  choices: ContextChoice[]
} {
  const selected = new Set(selectedWordIds)
  const words = project.transcript.words.filter((w) => selected.has(w.id))
  if (!words.length) return { summary: '', choices: [] }

  const span = wordRange(project.transcript.words, selectedWordIds)
  if (!span) return { summary: '', choices: [] }
  const dur = Math.max(0, span.end - span.start)
  const live = words.filter((w) => !w.deleted)
  const dead = words.filter((w) => w.deleted)
  const covering = coveringAppliedSuggestion(project, span.start, span.end)
  const scene = (project.scenes ?? []).find((s) => span.start >= s.start - 0.05 && span.end <= s.end + 0.05)
  const family = scene ? takeFamily(project.scenes, scene.id) : []
  const choices: ContextChoice[] = []

  if (dead.length && !live.length) {
    choices.push(
      covering
        ? {
            id: 'put-back',
            label: 'Put back',
            consequence: `Restores ${formatSpan(dur)} · ${covering.label.toLowerCase()}.`,
            command: { type: 'revertSuggestion', suggestionId: covering.id }
          }
        : {
            id: 'put-back',
            label: 'Put back',
            consequence: `Restores ${formatSpan(dur)} and opens the gap.`,
            command: { type: 'restoreRange', start: span.start, end: span.end }
          }
    )
    return { summary: `${words.length} cut words · ${formatSpan(dur)}`, choices }
  }

  if (scene && (scene.kind === 'retake' || family.length > 1)) {
    const sug = suggestionForScene(project, scene)
    if (sug?.applied) {
      choices.push({
        id: 'keep-all',
        label: 'Keep all takes',
        consequence: 'Puts the dropped attempt back.',
        command: commandForScene(project, scene, 'revert')
      })
    } else if (scene.kind === 'retake') {
      choices.push({
        id: 'use-take',
        label: 'Use another take',
        consequence: `Drops this attempt. The later take stays.`,
        command: commandForScene(project, scene, 'apply')
      })
    }
    if (!sug?.applied && family.length > 1) {
      choices.push({
        id: 'keep-take',
        label: 'Keep this take',
        consequence: 'Cuts the other attempts of this line.',
        command: { type: 'keepTake', sceneId: scene.id }
      })
    }
  }

  const allFillers = live.length > 0 && live.every((w) => isFillerToken(w.text))
  if (allFillers) {
    choices.push({
      id: 'remove',
      label: 'Remove filler',
      consequence: `Removes ${formatSpan(dur)} and closes the gap.`,
      command: { type: 'toggleWords', wordIds: selectedWordIds }
    })
  } else {
    choices.push({
      id: 'remove',
      label: 'Remove',
      consequence: `Removes ${formatSpan(dur)} and closes the gap. Captions stay in sync.`,
      command: { type: 'toggleWords', wordIds: selectedWordIds }
    })
    if (dur > 1.2) {
      choices.push({
        id: 'tighten',
        label: 'Make shorter',
        consequence: 'Cuts the air between these words. Guarded demo stays.',
        command: { type: 'tightenRange', start: span.start, end: span.end }
      })
    }
  }

  if (!project.tags.some((t) => t.kind === 'keep' && t.start <= span.start && t.end >= span.end)) {
    choices.push({
      id: 'keep',
      label: 'Keep',
      consequence: 'Auto Edit will leave this section unchanged.',
      command: { type: 'addTag', start: span.start, end: span.end, kind: 'keep' }
    })
  }

  return {
    summary: `${words.length} words · ${formatSpan(dur)}`,
    choices: choices.slice(0, 4)
  }
}

export function suggestTask(project: Project): SuggestTask {
  const pending = project.suggestions.filter((s) => !s.applied)
  const applied = project.suggestions.filter((s) => s.applied)
  const safe = pending.filter((s) => s.safe && !s.blockedBy && (s.action === 'cut' || s.action === 'normalize'))
  const review = pending.filter((s) => !safe.includes(s))
  const findRetakes = (project.scenes ?? []).every((s) => s.kind !== 'retake') && applied.length === 0

  if (!project.transcript.words.length) {
    return {
      headline: 'Open media to transcribe and find pauses.',
      applyLabel: null,
      reviewLabel: 'Review',
      reviewCount: 0,
      safeCount: 0,
      findRetakes: false,
      showWatch: false
    }
  }
  if (!applied.length && safe.length) {
    return {
      headline: `Transcript ready. ${safe.length} safe to clean${review.length ? ` · ${review.length} need review` : ''}.`,
      applyLabel: `Clean ${safe.length} pauses`,
      reviewLabel: review.length ? `Review ${review.length}` : 'Review',
      reviewCount: review.length,
      safeCount: safe.length,
      findRetakes,
      showWatch: false
    }
  }
  if (applied.length && review.length) {
    return {
      headline: `First edit done. ${review.length} decision${review.length === 1 ? '' : 's'} need review.`,
      applyLabel: safe.length ? `Apply ${safe.length} safe` : null,
      reviewLabel: `Review ${review.length}`,
      reviewCount: review.length,
      safeCount: safe.length,
      findRetakes: false,
      showWatch: true
    }
  }
  if (applied.length && !pending.length) {
    return {
      headline: 'Edit applied. Watch the result or export.',
      applyLabel: null,
      reviewLabel: 'Review',
      reviewCount: 0,
      safeCount: 0,
      findRetakes: false,
      showWatch: true
    }
  }
  return {
    headline: pending.length
      ? `${safe.length} safe · ${review.length} need review`
      : 'Nothing waiting. Export when it sounds right.',
    applyLabel: safe.length ? `Apply ${safe.length} safe` : null,
    reviewLabel: review.length ? `Review ${review.length}` : 'Review',
    reviewCount: review.length,
    safeCount: safe.length,
    findRetakes,
    showWatch: applied.length > 0
  }
}

export function inspectorFocus(opts: {
  exporting: boolean
  analyzing: string | null
  selectedWordIds: string[]
  selectedClipId: string | null
  selectedSuggestionId: string | null
  clipKind?: 'caption' | 'overlay' | 'picture' | 'audio' | null
}): InspectorFocus {
  if (opts.exporting || opts.analyzing) return 'job'
  if (opts.selectedSuggestionId) return 'suggestion'
  if (opts.selectedWordIds.length) return 'words'
  if (opts.selectedClipId) {
    if (opts.clipKind === 'caption') return 'caption'
    return 'clip'
  }
  return 'project'
}

export function inspectorTabs(focus: InspectorFocus): Array<{ id: InspectorFocus | 'agent'; label: string }> {
  if (focus === 'clip') {
    return [
      { id: 'clip', label: 'Picture' },
      { id: 'agent', label: 'Agent' }
    ]
  }
  if (focus === 'caption') {
    return [
      { id: 'caption', label: 'Caption' },
      { id: 'agent', label: 'Agent' }
    ]
  }
  if (focus === 'words' || focus === 'suggestion') {
    return [
      { id: focus, label: focus === 'words' ? 'Words' : 'Suggestion' },
      { id: 'agent', label: 'Agent' }
    ]
  }
  return [
    { id: focus === 'job' ? 'job' : 'project', label: focus === 'job' ? 'Job' : 'Project' },
    { id: 'agent', label: 'Agent' }
  ]
}

export interface PaletteSpec {
  name: string
  group: 'job' | 'selection' | 'edit' | 'export' | 'file'
  run: () => void
}

export function rankPalette(
  items: PaletteSpec[],
  query: string,
  ctx: { exporting: boolean; analyzing: string | null; hasWordSelection: boolean; hasClip: boolean }
): PaletteSpec[] {
  const q = query.trim().toLowerCase()
  const filtered = items.filter((item) => {
    if (q) return item.name.toLowerCase().includes(q)
    if (item.group === 'job') {
      if (/export/i.test(item.name)) return ctx.exporting
      if (/import/i.test(item.name)) return Boolean(ctx.analyzing)
      return ctx.exporting || Boolean(ctx.analyzing)
    }
    return true
  })
  const boost = (item: PaletteSpec) => {
    let score = 40
    if (item.group === 'job' && ctx.exporting && /export/i.test(item.name)) score = 0
    else if (item.group === 'job' && ctx.analyzing && /import/i.test(item.name)) score = 0
    else if (item.group === 'selection' && ctx.hasWordSelection) score = 10
    else if (item.group === 'selection' && ctx.hasClip) score = 12
    else if (item.group === 'edit') score = 20
    else if (item.group === 'export') score = 30
    else if (item.group === 'file') score = 35
    if (q && item.name.toLowerCase().startsWith(q)) score -= 5
    return score
  }
  return [...filtered].sort((a, b) => boost(a) - boost(b) || a.name.localeCompare(b.name))
}
