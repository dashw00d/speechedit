import type { Command, EditSuggestion, EditorialScene, Project } from '../types'
import { renderAgentBrief } from './agentContext'
import { completeOpenAI, extractJson } from './providers'
import type { ModelEndpoint } from './settings'
import { uid } from './time'

export interface IntelligenceDraft {
  scenes: EditorialScene[]
  suggestions: EditSuggestion[]
  commands: Command[]
  notes: string
}

const COMMAND_TYPES = new Set<Command['type']>([
  'deleteRange',
  'restoreRange',
  'toggleWords',
  'setWordText',
  'splitAt',
  'rippleDelete',
  'rippleDeleteMarks',
  'applySuggestion',
  'applySafeSuggestions',
  'dismissSuggestion',
  'revertSuggestion',
  'revertSuggestionType',
  'addTag',
  'eraseTag',
  'removeTag',
  'setMarks',
  'rebuildSuggestions',
  'cutSentence',
  'cutPreviousSentence',
  'tightenRange',
  'setScenes',
  'revertAt',
  'inferScenes',
  'collapseRetakes',
  'applyModelSuggestions'
])

export function parseIntelligence(raw: unknown): IntelligenceDraft {
  const data = raw as {
    notes?: string
    scenes?: Array<Partial<EditorialScene>>
    suggestions?: Array<Partial<EditSuggestion>>
    cuts?: Array<{ start: number; end: number; label?: string; safe?: boolean }>
    commands?: Command[]
  }
  const scenes: EditorialScene[] = (data.scenes ?? []).flatMap((s) => {
    if (s.start == null || s.end == null || !s.title) return []
    return [
      {
        id: typeof s.id === 'string' ? s.id : uid('sc'),
        start: Number(s.start),
        end: Number(s.end),
        title: String(s.title),
        summary: String(s.summary ?? ''),
        kind: (s.kind as EditorialScene['kind']) || 'talk',
        takeOf: s.takeOf
      }
    ]
  })
  const fromCuts: EditSuggestion[] = (data.cuts ?? []).map((c) => ({
    id: uid('sug'),
    type: 'model' as const,
    start: Number(c.start),
    end: Number(c.end),
    action: 'cut' as const,
    label: c.label || 'Model cut',
    safe: Boolean(c.safe),
    applied: false
  }))
  const suggestions: EditSuggestion[] = [
    ...(data.suggestions ?? []).flatMap((s) => {
      if (s.start == null || s.end == null) return []
      return [
        {
          id: typeof s.id === 'string' ? s.id : uid('sug'),
          type: (s.type as EditSuggestion['type']) || 'model',
          start: Number(s.start),
          end: Number(s.end),
          action: (s.action as EditSuggestion['action']) || 'cut',
          label: String(s.label ?? 'Model edit'),
          safe: Boolean(s.safe),
          applied: false
        }
      ]
    }),
    ...fromCuts
  ]
  const commands = (data.commands ?? []).filter((c) => c && COMMAND_TYPES.has(c.type))
  return { scenes, suggestions, commands, notes: String(data.notes ?? '') }
}

export function intelligencePrompt(project: Project, intent?: string): { system: string; user: string } {
  return {
    system: `You are the editorial intelligence for SpeechEdit, a transcript-first video editor.
Return ONLY JSON with this shape:
{
  "notes": "one paragraph",
  "scenes": [{"id":"sc1","start":0,"end":8.2,"title":"...","summary":"...","kind":"talk|demo|retake|broll|other","takeOf":"optional scene id"}],
  "cuts": [{"start":1.2,"end":1.5,"label":"why","safe":false}],
  "commands": [{"type":"deleteRange","start":1.2,"end":1.5,"source":"model"}]
}
Rules:
- Times are SOURCE seconds, not program time.
- Never cut ranges tagged keep or demo unless the user explicitly says to.
- A retake scene should set takeOf to the keeper scene id and prefer cutting the worse take.
- Prefer specific commands when the user asked to change the cut. Prefer cuts/scenes when analyzing.
- Allowed command types: deleteRange, restoreRange, toggleWords, applySafeSuggestions, applySuggestion, revertSuggestion, revertSuggestionType, addTag, tightenRange, cutSentence, rebuildSuggestions, revertAt, inferScenes, collapseRetakes, applyModelSuggestions.
- Do not invent word ids. Use deleteRange for time spans.`,
    user: `${intent ? `User request:\n${intent}\n\n` : 'Analyze this reel. Group scenes, mark retakes, and propose cuts a human would make.\n\n'}${renderAgentBrief(project)}`
  }
}

export async function runIntelligence(
  project: Project,
  endpoint: ModelEndpoint,
  intent?: string
): Promise<IntelligenceDraft> {
  const prompt = intelligencePrompt(project, intent)
  const text = await completeOpenAI(endpoint, [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ])
  return parseIntelligence(extractJson(text))
}
