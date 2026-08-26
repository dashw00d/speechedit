import type { Command, Project } from '../types'
import { findTake } from './sceneAnalysis'
import { sentenceRange, wordRange, wordsMatchingPhrase } from './transcriptEdit'

const PRODUCT = /^(shotcut|premiere|final|davinci|descript|rescript|capcut|resolve)$/i

export interface IntentPlan {
  commands: Command[]
  note: string
}

export function saidDoNotCut(lower: string): boolean {
  return /\bdo not cut\b|\bdon't cut\b|\bdont cut\b|\bdo not edit\b/.test(lower)
}

function wantsCollapseTakes(lower: string): boolean {
  return /collapse retake|keep (the )?best take|drop (false|bad) (start|take)s?|use (the )?good take/.test(lower)
}

export function planIntent(project: Project, intent: string): IntentPlan {
  const text = intent.trim()
  const quoted = [...text.matchAll(/[“"]([^”"]+)[”"]/g)].map((m) => m[1])
  const lower = text.toLowerCase()
  const noCut = saidDoNotCut(lower)

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
  if (
    wantsCollapseTakes(lower) &&
    !/auto[- ]?cut|auto[- ]?edit|cut the reel/.test(lower)
  ) {
    return { commands: [{ type: 'collapseRetakes' }], note: 'Cut superseded takes. Undo still works one-by-one.' }
  }
  if (/caption remaining|generate captions|burn captions|caption the/.test(lower)) {
    return {
      commands: [
        {
          type: 'generateCaptions',
          maxWords: 5,
          speakerPrefix: /speaker/.test(lower),
          emphasize: !/no emphasis/.test(lower)
        }
      ],
      note: 'Generate captions from live words.'
    }
  }
  if (/lower[- ]thirds?|chapter titles/.test(lower)) {
    return { commands: [{ type: 'addLowerThirds' }], note: 'Add scene lower thirds.' }
  }
  if (/rebuild|re-?analy/.test(lower)) {
    return { commands: [{ type: 'rebuildSuggestions' }], note: 'Rebuild suggestions from analysis + words.' }
  }
  if (/find scenes|group scenes|mark retakes|chapterize/.test(lower) && !wantsCollapseTakes(lower)) {
    if (noCut || !/\b(apply safe|apply model)\b/.test(lower)) {
      return { commands: [{ type: 'inferScenes' }], note: 'Group scenes and mark retakes from the transcript (no LLM required).' }
    }
  }
  if (
    /auto[- ]?cut|auto[- ]?edit/.test(lower) &&
    /(skip|except|keep|but)/.test(lower) &&
    /(demo|tag|guard|silent)/.test(lower) &&
    !noCut
  ) {
    return {
      commands: [{ type: 'applySafeSuggestions' }],
      note: 'Auto-cut like Auto-Editor; tagged demo/keep guards stay.'
    }
  }
  if (
    /auto[- ]?cut the reel|auto[- ]?edit the reel|cut the reel/.test(lower) &&
    !noCut &&
    !/except|keep/.test(lower)
  ) {
    const commands: Command[] = [{ type: 'applySafeSuggestions' }]
    if (wantsCollapseTakes(lower)) commands.push({ type: 'collapseRetakes' })
    return {
      commands,
      note: wantsCollapseTakes(lower)
        ? 'Safe silence/filler cuts, then collapse retakes. Demo/keep guards stay.'
        : 'Apply safe silence/filler/normalize cuts; guards stay.'
    }
  }
  if (wantsCollapseTakes(lower) && !noCut) {
    return { commands: [{ type: 'collapseRetakes' }], note: 'Cut superseded takes. Undo still works one-by-one.' }
  }
  if (/apply (the )?model|model cuts/.test(lower) && !noCut) {
    return { commands: [{ type: 'applyModelSuggestions' }], note: 'Apply model cuts. Guards stay.' }
  }
  if (/apply safe|safe edits|auto[- ]?edit|auto[- ]?cut/.test(lower) && !noCut && !/except|keep/.test(lower)) {
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

  if (/fumble|stumble|botch|wrong (product )?name|product name/.test(lower)) {
    const hit = project.transcript.words.find((w) => !w.deleted && PRODUCT.test(w.text.replace(/[^\w]/g, '')))
    if (hit) {
      const span = sentenceRange(project.transcript.words, hit.id) ?? { start: hit.start, end: hit.end }
      return {
        commands: [{ type: 'deleteRange', start: span.start, end: span.end, source: 'model' }],
        note: `Cut the fumbled product name (“${hit.text}”).`
      }
    }
  }

  if (!noCut && /(cut|remove|delete|drop)\b/.test(lower) && quoted.length) {
    const commands: Command[] = []
    for (const phrase of quoted) {
      const words = wordsMatchingPhrase(project.transcript.words, phrase)
      if (words.length) commands.push({ type: 'toggleWords', wordIds: words.map((w) => w.id) })
    }
    if (commands.length) return { commands, note: `Cut quoted phrases (${quoted.join(', ')}).` }
  }

  const about = text.match(/\b(?:about|part|section|scene)\s+[“"]([^”"]+)[”"]/i) ?? text.match(/\babout\s+([a-z0-9][\w\s-]{1,40})/i)
  if (!noCut && /(cut|remove|delete|drop)\b/.test(lower) && about?.[1] && !quoted.length) {
    const words = wordsMatchingPhrase(project.transcript.words, about[1].trim())
    if (words.length) {
      return {
        commands: [{ type: 'toggleWords', wordIds: words.map((w) => w.id) }],
        note: `Cut the part about “${about[1].trim()}”.`
      }
    }
    const scene = (project.scenes ?? []).find((s) =>
      s.title.toLowerCase().includes(about[1].trim().toLowerCase())
    )
    if (scene) {
      return {
        commands: [{ type: 'deleteRange', start: scene.start, end: scene.end, source: 'model' }],
        note: `Cut scene “${scene.title}”.`
      }
    }
  }

  if (/(keep|guard|protect)\b/.test(lower) && /demo|silent|walkthrough/.test(lower) && !quoted.length) {
    const demos = (project.scenes ?? []).filter((s) => s.kind === 'demo')
    if (demos.length) {
      return {
        commands: demos.map((s) => ({
          type: 'addTag' as const,
          start: s.start,
          end: s.end,
          kind: 'demo' as const,
          label: s.title
        })),
        note: `Tagged ${demos.length} silent demo scene(s) so Auto Edit skips them.`
      }
    }
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

  if (!noCut && /fillers?/.test(lower) && /(cut|remove|strip)/.test(lower)) {
    const fillers = project.suggestions.filter((s) => s.type === 'filler' && !s.applied)
    return {
      commands: fillers.map((s) => ({ type: 'applySuggestion', suggestionId: s.id })),
      note: `Removed ${fillers.length} filler${fillers.length === 1 ? '' : 's'}.`
    }
  }

  return {
    commands: [],
    note: 'No local plan. Configure an intelligence model or use a more specific request, e.g. cut “you know”.'
  }
}
