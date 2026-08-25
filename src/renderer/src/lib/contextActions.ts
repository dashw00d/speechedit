import type { Command, EditSuggestion, Project } from '../types'
import { blockedByLabel } from './analysis'
import { safeEditCandidates } from './firstEdit'
import { commandForScene, hasUncollapsedRetakes, suggestionForScene, takeFamily } from './sceneAnalysis'
import { isFillerToken } from './transcript'
import { coveringAppliedSuggestion, tagAt, wordRange } from './transcriptEdit'
import { formatClock } from './time'

export { hasUncollapsedRetakes }

export type PaceId = 'natural' | 'balanced' | 'tight'

export const PACE_PRESETS: { id: PaceId; label: string; margin: number; hint: string }[] = [
  { id: 'natural', label: 'Natural', margin: 0.22, hint: 'Leave more air between words' },
  { id: 'balanced', label: 'Balanced', margin: 0.12, hint: 'Typical cleanup — short pauses stay' },
  { id: 'tight', label: 'Tight', margin: 0.04, hint: 'Cut most silence' }
]

export interface ContextChoice {
  id: string
  label: string
  consequence: string
  command: Command
}

export type InspectorFocus = 'job' | 'words' | 'scene' | 'suggestion' | 'gap' | 'caption' | 'clip' | 'project'

export interface SuggestTask {
  headline: string
  applyLabel: string | null
  reviewLabel: string
  reviewCount: number
  safeCount: number
  findRetakes: boolean
  collapseRetakes: boolean
  showWatch: boolean
  showPace: boolean
  showPreviewToggle: boolean
  fillerCount: number
}

export function formatSpan(seconds: number): string {
  if (seconds < 0.05) return 'a moment'
  if (seconds < 10) return `${seconds.toFixed(1)} seconds`
  return `${Math.round(seconds)} seconds`
}

export function countLabel(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
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
    return { summary: `${countLabel(words.length, 'cut word')} · ${formatSpan(dur)}`, choices }
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
        label: 'Use final take',
        consequence: 'Drops this attempt. The later take stays.',
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
    const fillerIds = new Set(
      project.transcript.words
        .filter((w) => {
          if (w.deleted) return false
          if (isFillerToken(w.text)) return true
          return project.suggestions.some(
            (s) => s.type === 'filler' && !s.applied && w.start >= s.start - 0.02 && w.end <= s.end + 0.02
          )
        })
        .map((w) => w.id)
    )
    const otherFillers = [...fillerIds].filter((id) => !selected.has(id))
    if (otherFillers.length) {
      choices.push({
        id: 'all-fillers',
        label: 'All fillers',
        consequence: `Removes ${countLabel(fillerIds.size, 'filler')} and closes the gaps.`,
        command: { type: 'toggleWords', wordIds: [...fillerIds] }
      })
    }
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
        consequence: 'Cuts the air between these words. Protected demo stays.',
        command: { type: 'tightenRange', start: span.start, end: span.end }
      })
    }
  }

  if (!project.tags.some((t) => t.kind === 'keep' && t.start <= span.start && t.end >= span.end)) {
    choices.push({
      id: 'keep',
      label: 'Protect',
      consequence: 'Auto Edit will leave this section unchanged.',
      command: { type: 'addTag', start: span.start, end: span.end, kind: 'keep' }
    })
  }

  return {
    summary: `${countLabel(words.length, 'word')} · ${formatSpan(dur)}`,
    choices: choices.slice(0, 4)
  }
}

export function suggestTask(project: Project): SuggestTask {
  const pending = project.suggestions.filter((s) => !s.applied)
  const applied = project.suggestions.filter((s) => s.applied)
  const safe = safeEditCandidates(project)
  const review = pending.filter((s) => !safe.includes(s))
  const findRetakes = (project.scenes ?? []).every((s) => s.kind !== 'retake') && applied.length === 0
  const collapseRetakes = hasUncollapsedRetakes(project)
  const fillerCount = pending.filter(
    (s) => s.type === 'filler' && !s.blockedBy && (s.action === 'cut' || s.action === 'speed')
  ).length

  if (!project.transcript.words.length) {
    if (applied.length) {
      return {
        headline: review.length
          ? `First edit done. ${review.length} decision${review.length === 1 ? '' : 's'} need review. Transcribing…`
          : 'First edit done. Transcribing…',
        applyLabel: safe.length ? `Apply ${safe.length} safe` : null,
        reviewLabel: review.length ? `Review ${review.length}` : 'Review',
        reviewCount: review.length,
        safeCount: safe.length,
        findRetakes: false,
        collapseRetakes,
        showWatch: true,
        showPace: false,
        showPreviewToggle: false,
        fillerCount: 0
      }
    }
    if (safe.length) {
      return {
        headline: `Pauses found. ${safe.length} safe to clean · transcribing…`,
        applyLabel: `Clean ${safe.length} pauses`,
        reviewLabel: review.length ? `Review ${review.length}` : 'Review',
        reviewCount: review.length,
        safeCount: safe.length,
        findRetakes: false,
        collapseRetakes,
        showWatch: false,
        showPace: true,
        showPreviewToggle: true,
        fillerCount: 0
      }
    }
    return {
      headline: 'Open media to transcribe and find pauses.',
      applyLabel: null,
      reviewLabel: 'Review',
      reviewCount: 0,
      safeCount: 0,
      findRetakes: false,
      collapseRetakes: false,
      showWatch: false,
      showPace: false,
      showPreviewToggle: false,
      fillerCount: 0
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
      collapseRetakes,
      showWatch: false,
      showPace: true,
      showPreviewToggle: true,
      fillerCount
    }
  }
  if (applied.length && review.length) {
    return {
      headline: `First edit done. ${review.length} decision${review.length === 1 ? '' : 's'} need${review.length === 1 ? 's' : ''} review.`,
      applyLabel: safe.length ? `Apply ${safe.length} safe` : null,
      reviewLabel: `Review ${review.length}`,
      reviewCount: review.length,
      safeCount: safe.length,
      findRetakes: false,
      collapseRetakes,
      showWatch: true,
      showPace: false,
      showPreviewToggle: false,
      fillerCount
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
      collapseRetakes: false,
      showWatch: true,
      showPace: false,
      showPreviewToggle: false,
      fillerCount: 0
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
    collapseRetakes,
    showWatch: applied.length > 0,
    showPace: safe.length > 0 && applied.length === 0,
    showPreviewToggle: safe.length > 0 && applied.length === 0,
    fillerCount
  }
}

export function inspectorFocus(opts: {
  exporting: boolean
  analyzing: string | null
  selectedWordIds: string[]
  selectedSceneId: string | null
  selectedClipId: string | null
  selectedSuggestionId: string | null
  selectedGap: { start: number; end: number } | null
  clipKind?: 'caption' | 'overlay' | 'picture' | 'audio' | null
}): InspectorFocus {
  if (opts.exporting || opts.analyzing) return 'job'
  if (opts.selectedSuggestionId) return 'suggestion'
  if (opts.selectedGap) return 'gap'
  if (opts.selectedSceneId) return 'scene'
  if (opts.selectedWordIds.length) return 'words'
  if (opts.selectedClipId) {
    if (opts.clipKind === 'caption') return 'caption'
    return 'clip'
  }
  return 'project'
}

export interface InspectorAction {
  id: string
  label: string
  consequence: string
  command?: Command
  primary?: boolean
  navigate?: 'compare-takes'
}

export interface InspectorNext {
  label: string
  suggestionId?: string
  gap?: { start: number; end: number }
}

export interface WordsInspectorDetail {
  title: string
  headline: string
  excerpt: string
  clock: string
  speakerId?: string
  scene?: { title: string; kind: string; summary?: string }
  tag?: { kind: 'keep' | 'demo'; label: string }
  actions: InspectorAction[]
  relatedSuggestions: Array<{ id: string; label: string; safe: boolean; applied: boolean }>
  nextHint?: string
}

export interface SuggestionInspectorDetail {
  title: string
  headline: string
  clock: string
  explanation: string
  blockedLabel?: string
  actions: InspectorAction[]
  similarCount: number
  similarSafeCount: number
  excerpt?: string
  nextHint?: string
  next?: InspectorNext
}

export interface SceneInspectorDetail {
  title: string
  headline: string
  clock: string
  explanation: string
  excerpt?: string
  takeCount: number
  actions: InspectorAction[]
  nextHint?: string
}

export interface ProjectInspectorDetail {
  title: string
  headline: string
  pendingByType: Array<{ type: string; count: number; safe: number }>
  appliedCount: number
  nextHint?: string
  isEmpty: boolean
  agentHint?: string
  showMcpHint: boolean
}

export interface GapInspectorDetail {
  title: string
  headline: string
  clock: string
  explanation: string
  tag?: { kind: 'keep' | 'demo'; label: string }
  actions: InspectorAction[]
  similarSafeCount: number
  nextHint?: string
  next?: InspectorNext
}

export function orderedPendingSuggestions(project: Project): EditSuggestion[] {
  return project.suggestions.filter((s) => !s.applied).sort((a, b) => a.start - b.start || a.end - b.end)
}

export function nextPendingSuggestionAfter(project: Project, currentId: string): EditSuggestion | undefined {
  const ordered = orderedPendingSuggestions(project)
  const idx = ordered.findIndex((s) => s.id === currentId)
  if (idx < 0) return ordered[0]
  return ordered[idx + 1]
}

export function nextPauseAfter(
  project: Project,
  afterEnd: number
): { start: number; end: number; suggestionId?: string } | undefined {
  const silences = project.suggestions
    .filter((s) => !s.applied && s.type === 'silence' && s.start >= afterEnd - 0.02)
    .sort((a, b) => a.start - b.start)
  const nextSug = silences.find((s) => s.start > afterEnd - 0.02)
  if (nextSug) return { start: nextSug.start, end: nextSug.end, suggestionId: nextSug.id }

  const words = project.transcript.words.filter((w) => !w.deleted)
  for (let i = 0; i < words.length - 1; i++) {
    const prev = words[i]
    const next = words[i + 1]
    const gapStart = prev.end
    const gapEnd = next.start
    if (gapEnd - gapStart < 0.45 || gapStart <= afterEnd + 0.02) continue
    return { start: gapStart, end: gapEnd }
  }
  return undefined
}

function suggestionSafetyExplanation(project: Project, suggestion: EditSuggestion): string {
  if (suggestion.blockedBy) {
    const tag = project.tags.find((t) => t.id === suggestion.blockedBy)
    if (tag?.kind === 'demo') return 'Protected by silent demo — Auto Edit will not cut through here.'
    if (tag?.kind === 'keep') return 'This section is protected — Auto Edit will skip it.'
    const label = blockedByLabel(project.tags, suggestion.blockedBy)
    return label ? `Blocked by ${label}. Auto Edit will not cut through protected sections.` : 'Blocked by a protected section.'
  }
  if (!suggestion.safe) {
    if (suggestion.type === 'static') return 'The picture barely moves here — review before tightening.'
    if (suggestion.type === 'low-motion') return 'Screen still changing here — not marked safe for auto-cut.'
    if (suggestion.type === 'repeat') return 'Possible retake — pick which attempt to keep.'
    if (suggestion.action === 'review') return 'Flagged for manual review before applying.'
    if (suggestion.type === 'silence') return 'Long or unusual pause — worth a quick listen.'
    return 'Needs a quick review before applying.'
  }
  const typeCopy: Record<string, string> = {
    silence: 'Dead air between words. Removing it closes the gap and keeps captions in sync.',
    filler: 'A filler word. Safe to remove unless you want a conversational tone.',
    repeat: 'This line may be a retake of something said earlier.',
    static: 'The picture barely moves here — good candidate to tighten.',
    'low-motion': 'Minimal motion on screen during this stretch.',
    loud: 'Audio is louder than the rest of the reel.',
    pace: 'Pacing could be tightened without losing meaning.',
    model: 'The editor model flagged this for review.'
  }
  return typeCopy[suggestion.type] ?? 'Review this edit before applying.'
}

export function gapInspectorDetail(project: Project, start: number, end: number): GapInspectorDetail | null {
  if (end <= start) return null
  const dur = end - start
  if (coveringAppliedSuggestion(project, start, end)) return null

  const tag = tagAt(project.tags, (start + end) / 2)
  const isCut = project.cuts.some((c) => c.start <= start + 0.05 && c.end >= end - 0.05)
  const similarSafe = project.suggestions.filter(
    (s) => !s.applied && s.type === 'silence' && s.safe && !s.blockedBy
  ).length
  const actions: InspectorAction[] = []

  if (isCut) {
    actions.push({
      id: 'put-back',
      label: 'Put back',
      consequence: `Restores ${formatSpan(dur)} of air.`,
      command: { type: 'revertAt', start, end },
      primary: true
    })
  } else if (!tag || tag.kind !== 'keep') {
    actions.push({
      id: 'remove',
      label: 'Remove pause',
      consequence: `Removes ${formatSpan(dur)} and closes the gap.`,
      command: { type: 'deleteRange', start, end, source: 'transcript' },
      primary: true
    })
    actions.push({
      id: 'lift-pause',
      label: 'Lift pause',
      consequence: `Removes ${formatSpan(dur)} of air but leaves a hold so later clips stay put.`,
      command: { type: 'deleteRange', start, end, source: 'transcript', lift: true }
    })
    if (dur > 1.2) {
      actions.push({
        id: 'shorten',
        label: 'Shorten',
        consequence: 'Tightens to a natural breath instead of removing entirely.',
        command: { type: 'tightenRange', start, end }
      })
    }
  }

  if (!isCut) {
    if (!tag || tag.kind !== 'demo') {
      actions.push({
        id: 'demo',
        label: 'Mark demo',
        consequence: 'Silent walkthrough — Auto Edit keeps this pause.',
        command: { type: 'addTag', start, end, kind: 'demo', label: 'Silent product demo' }
      })
    }

    if (!project.tags.some((t) => t.kind === 'keep' && t.start <= start && t.end >= end)) {
      actions.push({
        id: 'keep',
        label: 'Protect',
        consequence: 'Auto Edit will leave this pause unchanged.',
        command: { type: 'addTag', start, end, kind: 'keep' }
      })
    }
  }

  let explanation = isCut ? 'This pause was removed from the reel.' : 'Dead air between words.'
  if (tag?.kind === 'demo') explanation = 'Marked as a silent product demo. Auto Edit skips it.'
  else if (tag?.kind === 'keep') explanation = 'Protected. Auto Edit will not cut here.'
  else if (dur > 3) explanation = 'Long pause — often safe to remove when nothing happens on screen.'

  return {
    title: isCut ? 'Cut pause' : 'Pause',
    headline: isCut ? `${dur.toFixed(1)} second pause removed` : `${dur.toFixed(1)} second pause`,
    clock: `${formatClock(start)}–${formatClock(end)}`,
    explanation,
    tag:
      tag && (tag.kind === 'keep' || tag.kind === 'demo')
        ? { kind: tag.kind, label: tag.label || (tag.kind === 'demo' ? 'Silent demo' : 'Protected') }
        : undefined,
    actions: actions.slice(0, 4),
    similarSafeCount: similarSafe,
    nextHint: similarSafe > 1 ? `${similarSafe} other safe pauses are waiting in the bar below.` : undefined,
    next: (() => {
      const target = nextPauseAfter(project, end)
      return target ? { label: 'Next pause →', gap: { start: target.start, end: target.end }, suggestionId: target.suggestionId } : undefined
    })()
  }
}

export function pendingSuggestionForGap(project: Project, start: number, end: number): EditSuggestion | undefined {
  return project.suggestions.find(
    (s) =>
      !s.applied &&
      s.type === 'silence' &&
      s.start <= start + 0.08 &&
      s.end >= end - 0.08 &&
      Math.min(s.end, end) - Math.max(s.start, start) > 0.02
  )
}

export function wordsInspectorDetail(project: Project, selectedWordIds: string[]): WordsInspectorDetail | null {
  const { summary, choices } = transcriptChoices(project, selectedWordIds)
  if (!summary) return null

  const span = wordRange(project.transcript.words, selectedWordIds)
  if (!span) return null

  const words = project.transcript.words.filter((w) => selectedWordIds.includes(w.id))
  const live = words.filter((w) => !w.deleted)
  const dead = words.filter((w) => w.deleted)
  const scene = (project.scenes ?? []).find((s) => span.start >= s.start - 0.05 && span.end <= s.end + 0.05)
  const tag = tagAt(project.tags, (span.start + span.end) / 2)
  const speakerId = live[0]?.speaker ?? dead[0]?.speaker
  const excerpt = words.map((w) => (w.deleted ? `[${w.text}]` : w.text)).join(' ')
  const allFillers = live.length > 0 && live.every((w) => isFillerToken(w.text))

  let title = live.length === 1 ? 'Word' : 'Selection'
  let headline = summary
  if (dead.length && !live.length) {
    title = dead.length === 1 ? 'Cut word' : 'Cut words'
    headline = coveringAppliedSuggestion(project, span.start, span.end)
      ? `Auto-edit removed this · ${summary}`
      : `Removed from the reel · ${summary}`
  } else if (allFillers) {
    title = live.length === 1 ? 'Filler' : 'Fillers'
    headline = `Likely filler · ${summary}`
  } else if (scene?.kind === 'retake') {
    title = 'Retake'
    headline = `${scene.title} · ${summary}`
  } else if (scene) {
    title = scene.kind === 'demo' ? 'Demo section' : 'Scene'
    headline = `${scene.title} · ${summary}`
  }

  const relatedSuggestions = project.suggestions
    .filter((s) => overlapSuggestion(s, span) && s.action !== 'normalize')
    .slice(0, 4)
    .map((s) => ({ id: s.id, label: s.label, safe: Boolean(s.safe && !s.blockedBy), applied: s.applied }))

  const pendingReview = project.suggestions.filter((s) => !s.applied && !s.safe && overlapSuggestion(s, span)).length
  let nextHint: string | undefined
  if (dead.length && !live.length) nextHint = 'Double-click the word in the transcript to put it back quickly.'
  else if (pendingReview) nextHint = `${pendingReview} nearby edit${pendingReview === 1 ? '' : 's'} still need review.`
  else if (allFillers && live.length === 1)
    nextHint = 'All fillers removes every um, uh, and you know in one pass.'

  return {
    title,
    headline,
    excerpt,
    clock: `${formatClock(span.start)}–${formatClock(span.end)}`,
    speakerId,
    scene: scene ? { title: scene.title, kind: scene.kind, summary: scene.summary || undefined } : undefined,
    tag:
      tag && (tag.kind === 'keep' || tag.kind === 'demo')
        ? { kind: tag.kind, label: tag.label || (tag.kind === 'demo' ? 'Silent demo' : 'Protected') }
        : undefined,
    actions: choices.map((c, i) => ({ ...c, primary: i === 0 })),
    relatedSuggestions,
    nextHint
  }
}

export function sceneInspectorDetail(project: Project, sceneId: string): SceneInspectorDetail | null {
  const scene = (project.scenes ?? []).find((s) => s.id === sceneId)
  if (!scene) return null

  const family = takeFamily(project.scenes ?? [], scene.id)
  const sug = suggestionForScene(project, scene)
  const spoken = project.transcript.words.filter((w) => w.start >= scene.start && w.end <= scene.end)
  const dropped =
    Boolean(sug?.applied) || (spoken.length > 0 && spoken.every((w) => w.deleted))
  const excerpt = spoken.map((w) => (w.deleted ? `[${w.text}]` : w.text)).join(' ')
  const dur = Math.max(0, scene.end - scene.start)
  const actions: InspectorAction[] = []

  if (family.length > 1 || scene.kind === 'retake') {
    if (dropped) {
      actions.push({
        id: 'keep-all',
        label: 'Keep all takes',
        consequence: 'Puts the dropped attempt back.',
        command: commandForScene(project, scene, 'revert'),
        primary: true
      })
    } else if (scene.kind === 'retake') {
      const later = family.filter((s) => s.start > scene.start)
      const saved = later.reduce((sum, s) => sum + (s.end - s.start), 0)
      actions.push({
        id: 'use-final',
        label: 'Use final take',
        consequence:
          later.length > 1
            ? `Keeps the successful later attempt${saved > 1 ? ` and shortens the reel by about ${formatSpan(saved)}` : ''}.`
            : 'Drops this attempt. The later take stays.',
        command: commandForScene(project, scene, 'apply'),
        primary: true
      })
    }
    if (family.length > 1) {
      actions.push({
        id: 'compare',
        label: 'Loop takes A ↔ B',
        consequence: 'Loops playback across this take and the next attempt.',
        navigate: 'compare-takes'
      })
    }
    if (!dropped && family.length > 1 && scene.kind !== 'retake') {
      actions.push({
        id: 'keep-take',
        label: 'Keep this take',
        consequence: 'Cuts the other attempts of this line.',
        command: { type: 'keepTake', sceneId: scene.id }
      })
    }
    if (!dropped && hasUncollapsedRetakes(project)) {
      actions.push({
        id: 'collapse-all',
        label: 'Collapse all retakes',
        consequence: 'Drop superseded takes across the reel.',
        command: { type: 'collapseRetakes' }
      })
    }
  } else if (dropped) {
    actions.push({
      id: 'restore-scene',
      label: 'Put scene back',
      consequence: `Restores ${formatSpan(dur)} and opens the gap.`,
      command: { type: 'restoreRange', start: scene.start, end: scene.end },
      primary: true
    })
  } else {
    actions.push({
      id: 'cut-scene',
      label: scene.kind === 'demo' ? 'Remove walkthrough' : 'Remove scene',
      consequence: `Removes ${formatSpan(dur)} and closes the gap. Captions stay in sync.`,
      command: { type: 'deleteRange', start: scene.start, end: scene.end, source: 'transcript' },
      primary: true
    })
  }

  let title = 'Scene'
  let headline = scene.title
  let explanation = scene.summary || 'Editorial scene from the transcript.'
  if (scene.kind === 'retake' || family.length > 1) {
    title = family.length > 1 ? 'Retake' : 'Scene'
    headline =
      family.length > 1
        ? `${family.length} attempts · ${scene.title}`
        : `${scene.title} · ${formatSpan(dur)}`
    explanation =
      family.length > 1
        ? `This line has ${family.length} attempts. Pick the take that should stay.`
        : explanation
  } else if (scene.kind === 'demo') {
    title = 'Demo section'
    explanation = 'Silent walkthrough — Auto Edit skips pauses here.'
  }

  return {
    title,
    headline,
    clock: `${formatClock(scene.start)}–${formatClock(scene.end)}`,
    explanation,
    excerpt: excerpt || undefined,
    takeCount: family.length,
    actions,
    nextHint: family.length > 1 && !dropped ? 'Compare takes to hear each attempt before deciding.' : undefined
  }
}

function overlapSuggestion(s: EditSuggestion, span: { start: number; end: number }): boolean {
  const overlap = Math.min(s.end, span.end) - Math.max(s.start, span.start)
  return overlap > 0.02
}

export function suggestionInspectorDetail(project: Project, suggestionId: string): SuggestionInspectorDetail | null {
  const suggestion = project.suggestions.find((s) => s.id === suggestionId)
  if (!suggestion) return null

  const dur = Math.max(0, suggestion.end - suggestion.start)
  const blockedLabel = blockedByLabel(project.tags, suggestion.blockedBy)
  const similar = project.suggestions.filter(
    (s) => s.id !== suggestion.id && s.type === suggestion.type && !s.applied && s.action === suggestion.action
  )
  const similarSafe = similar.filter((s) => s.safe && !s.blockedBy)

  const words = project.transcript.words
    .filter((w) => w.start >= suggestion.start - 0.02 && w.end <= suggestion.end + 0.02)
    .map((w) => w.text)
  const excerpt = words.slice(0, 12).join(' ')

  const actions: InspectorAction[] = []
  if (suggestion.applied) {
    actions.push({
      id: 'put-back',
      label: 'Put back',
      consequence: `Restores ${formatSpan(dur)} · ${suggestion.label.toLowerCase()}.`,
      command: { type: 'revertSuggestion', suggestionId: suggestion.id },
      primary: true
    })
  } else if (suggestion.blockedBy) {
    actions.push({
      id: 'skip',
      label: 'Skip',
      consequence: 'Leave this edit open and move on.',
      command: { type: 'dismissSuggestion', suggestionId: suggestion.id },
      primary: true
    })
  } else if (suggestion.action === 'review') {
    actions.push({
      id: 'keep',
      label: 'Keep',
      consequence: 'Dismisses this suggestion without cutting.',
      command: { type: 'dismissSuggestion', suggestionId: suggestion.id },
      primary: true
    })
  } else {
    actions.push({
      id: 'apply',
      label: suggestion.action === 'speed' ? `Speed ${suggestion.speed ?? 4}×` : 'Apply',
      consequence:
        suggestion.action === 'cut'
          ? `Removes ${formatSpan(dur)} and closes the gap.`
          : 'Normalizes loudness on this stretch.',
      command: { type: 'applySuggestion', suggestionId: suggestion.id },
      primary: true
    })
    actions.push({
      id: 'keep',
      label: 'Keep',
      consequence: 'Leaves this section unchanged.',
      command: { type: 'dismissSuggestion', suggestionId: suggestion.id }
    })
  }

  if (similarSafe.length > 1) {
    actions.push({
      id: 'apply-similar',
      label: `Apply ${similarSafe.length} similar`,
      consequence: `Applies every safe ${suggestion.type} edit like this one.`,
      command: { type: 'applySafeSuggestions' }
    })
  }

  let nextHint: string | undefined
  const reviewLeft = project.suggestions.filter((s) => !s.applied && !s.safe).length
  if (!suggestion.applied && reviewLeft > 1) nextHint = `${reviewLeft - 1} other uncertain edit${reviewLeft === 2 ? '' : 's'} waiting in review.`
  const nextSug = nextPendingSuggestionAfter(project, suggestion.id)

  return {
    title: suggestion.type === 'silence' ? 'Pause' : suggestion.type,
    headline: suggestion.label,
    clock: `${formatClock(suggestion.start)}–${formatClock(suggestion.end)}${suggestion.safe ? ' · safe' : ' · review'}`,
    explanation: suggestionSafetyExplanation(project, suggestion),
    blockedLabel,
    actions,
    similarCount: similar.length,
    similarSafeCount: similarSafe.length,
    excerpt: excerpt || undefined,
    nextHint,
    next: nextSug ? { label: 'Review next →', suggestionId: nextSug.id } : undefined
  }
}

export function projectInspectorDetail(project: Project): ProjectInspectorDetail {
  const task = suggestTask(project)
  const pending = project.suggestions.filter((s) => !s.applied)
  const applied = project.suggestions.filter((s) => s.applied)
  const byType = new Map<string, { count: number; safe: number }>()
  for (const s of pending) {
    const row = byType.get(s.type) ?? { count: 0, safe: 0 }
    row.count += 1
    if (s.safe && !s.blockedBy) row.safe += 1
    byType.set(s.type, row)
  }

  let nextHint: string | undefined
  const hasMedia = Object.keys(project.assets).length > 0 || project.sourceDuration > 0
  const isEmpty = !project.transcript.words.length && !hasMedia
  const pendingCount = pending.length

  if (isEmpty) {
    nextHint = 'Open media to transcribe, drop a transcript file, or try the studio demo.'
  } else if (!project.transcript.words.length) {
    nextHint = 'Open media to transcribe and analyze pauses, fillers, and retakes.'
  } else if (pending.length === 0 && applied.length > 0) {
    nextHint = 'Watch the program, then export when it sounds right.'
  } else if (pending.length) {
    nextHint = 'Click a word or pause in the transcript — tools appear on what you select.'
  }

  const agentHint =
    pendingCount > 0
      ? `${pendingCount} open edit${pendingCount === 1 ? '' : 's'} — Agent can batch-apply safe cuts or explain what's protected.`
      : undefined

  return {
    title: 'Project',
    headline: isEmpty ? 'Start a reel' : task.headline,
    pendingByType: [...byType.entries()].map(([type, row]) => ({ type, ...row })),
    appliedCount: applied.length,
    nextHint,
    isEmpty,
    agentHint,
    showMcpHint: true
  }
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
  if (focus === 'words' || focus === 'suggestion' || focus === 'gap' || focus === 'scene') {
    const labels: Record<'words' | 'suggestion' | 'gap' | 'scene', string> = {
      words: 'Words',
      gap: 'Pause',
      suggestion: 'Suggestion',
      scene: 'Scene'
    }
    return [
      { id: focus, label: labels[focus] },
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
  group: 'job' | 'selection' | 'edit' | 'export' | 'file' | 'playback'
  run: () => void
}

export function rankPalette(
  items: PaletteSpec[],
  query: string,
  ctx: {
    exporting: boolean
    analyzing: string | null
    hasWordSelection: boolean
    hasClip: boolean
    empty?: boolean
  }
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
    else if (ctx.empty && item.group === 'file') score = 8
    else if (ctx.empty && item.name === 'Export…') score = 14
    else if (ctx.empty && (item.group === 'export' || item.group === 'edit' || item.group === 'selection'))
      score = 70
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
