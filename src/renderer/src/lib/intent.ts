import type { Command, Project } from '../types'
import { findTake } from './sceneAnalysis'
import { wordRange, wordsMatchingPhrase } from './transcriptEdit'

export interface IntentPlan {
  commands: Command[]
  note: string
}

export function planIntent(project: Project, intent: string): IntentPlan {
  const text = intent.trim()
  const quoted = [...text.matchAll(/[“"]([^”"]+)[”"]/g)].map((m) => m[1])
  const lower = text.toLowerCase()

  const keepTake = lower.match(
    /keep take (\d+)(?:\s+of\s+(?:the\s+)?(.+?))?$|use take (\d+)(?:\s+of\s+(?:the\s+)?(.+))?/
  )
  if (keepTake) {
    const index = Number(keepTake[1] || keepTake[3])
    const topic = (keepTake[2] || keepTake[4] || '').trim()
    const scene = findTake(project, topic || undefined, index)
    if (scene) {
      return {
        commands: [{ type: 'keepTake', sceneId: scene.id }],
        note: topic
          ? `Keep take ${index} of “${topic}”. Other takes stay revertible.`
          : `Keep take ${index}. Other takes stay revertible.`
      }
    }
  }
  if (/rebuild intelligence|re-?group scenes|refresh scenes/.test(lower)) {
    return { commands: [{ type: 'rebuildIntelligence' }], note: 'Rebuild scenes, retakes, and suggestions (local heuristic).' }
  }
  if (/find scenes|group scenes|mark retakes|chapterize/.test(lower) && !/collapse|cut|remove|apply/.test(lower)) {
    return { commands: [{ type: 'inferScenes' }], note: 'Group scenes and mark retakes from the transcript (no LLM required).' }
  }
  if (/collapse retake|keep (the )?best take|drop (false|bad) (start|take)s?|use (the )?good take/.test(lower)) {
    return { commands: [{ type: 'collapseRetakes' }], note: 'Cut superseded takes. Undo still works one-by-one.' }
  }
  if (/rebuild|re-?analy/.test(lower)) {
    return { commands: [{ type: 'rebuildSuggestions' }], note: 'Rebuild suggestions from analysis + words.' }
  }
  if (/apply safe|safe edits|auto[- ]?edit|auto[- ]?cut/.test(lower) && !/except|keep|don't|dont/.test(lower)) {
    return { commands: [{ type: 'applySafeSuggestions' }], note: 'Apply safe silence/filler/normalize cuts; guards stay.' }
  }
  if (/put back silence|restore silence|revert silence/.test(lower)) {
    return { commands: [{ type: 'revertSuggestionType', suggestionType: 'silence' }], note: 'Put back silence cuts.' }
  }
  if (/put back filler|restore filler|revert filler/.test(lower)) {
    return { commands: [{ type: 'revertSuggestionType', suggestionType: 'filler' }], note: 'Put back filler cuts.' }
  }
  if (/put back retake|restore retake|revert repeat/.test(lower)) {
    return { commands: [{ type: 'revertSuggestionType', suggestionType: 'repeat' }], note: 'Put back retake cuts.' }
  }
  if (/tighten/.test(lower)) {
    const span =
      wordRange(project.transcript.words, []) ??
      (project.sourceDuration > 0 ? { start: 0, end: project.sourceDuration } : null)
    const range = quoted[0]
      ? wordRange(project.transcript.words, wordsMatchingPhrase(project.transcript.words, quoted[0]).map((w) => w.id))
      : span
    if (!range) return { commands: [], note: 'Nothing to tighten.' }
    return { commands: [{ type: 'tightenRange', start: range.start, end: range.end }], note: 'Tighten gaps; demo/keep guards stay.' }
  }

  if (/(cut|remove|delete|drop)\b/.test(lower) && quoted.length) {
    const commands: Command[] = []
    for (const phrase of quoted) {
      const words = wordsMatchingPhrase(project.transcript.words, phrase)
      if (words.length) commands.push({ type: 'toggleWords', wordIds: words.map((w) => w.id) })
    }
    if (commands.length) return { commands, note: `Cut quoted phrases (${quoted.join(', ')}).` }
  }

  if (/(keep|guard|protect|demo)\b/.test(lower) && quoted.length) {
    const kind = /demo|silent|show/.test(lower) ? 'demo' : 'keep'
    const words = wordsMatchingPhrase(project.transcript.words, quoted[0])
    const span = wordRange(project.transcript.words, words.map((w) => w.id))
    if (span) {
      return {
        commands: [{ type: 'addTag', start: span.start, end: span.end, kind, label: quoted[0] }],
        note: `Tag “${quoted[0]}” as ${kind}.`
      }
    }
  }

  if (/fillers?/.test(lower) && /(cut|remove|strip)/.test(lower)) {
    const fillers = project.suggestions.filter((s) => s.type === 'filler' && !s.applied)
    return {
      commands: fillers.map((s) => ({ type: 'applySuggestion', suggestionId: s.id })),
      note: `Cut ${fillers.length} filler suggestion(s).`
    }
  }

  return {
    commands: [],
    note: 'No local plan. Configure an intelligence model or use a more specific request, e.g. cut “you know”.'
  }
}
