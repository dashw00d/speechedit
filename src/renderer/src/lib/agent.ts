import type { Command, Project } from '../types'
import { EMPTY_SESSION, type EditorSession, renderAgentBrief } from './agentContext'
import { planIntent } from './intent'
import { MCP_TOOLS, runTool } from './mcpTools'
import { endpointReady, extractJson } from './providers'
import type { ModelEndpoint } from './settings'
import { sentenceRange, wordsMatchingPhrase } from './transcriptEdit'

export interface AgentCall {
  name: string
  args: Record<string, unknown>
  message: string
}

export interface AgentTurn {
  project: Project
  calls: AgentCall[]
  message: string
}

export interface PlannedCall {
  name: string
  args: Record<string, unknown>
}

const READ_TOOLS = new Set([
  'get_context',
  'get_snapshot',
  'get_transcript',
  'search_transcript',
  'get_timeline',
  'get_suggestions',
  'get_tags',
  'get_scenes',
  'get_program',
  'get_cuts',
  'get_selection',
  'get_mapping',
  'list_commands'
])

const PRODUCT = /^(shotcut|premiere|final|davinci|descript|rescript|capcut|resolve)$/i

export function commandToTool(command: Command): PlannedCall {
  switch (command.type) {
    case 'deleteRange':
      return {
        name: 'delete_range',
        args: { start: command.start, end: command.end, source: command.source ?? 'model' }
      }
    case 'restoreRange':
      return { name: 'restore_range', args: { start: command.start, end: command.end } }
    case 'toggleWords':
      return { name: 'toggle_words', args: { wordIds: command.wordIds } }
    case 'setWordText':
      return { name: 'set_word_text', args: { wordId: command.wordId, text: command.text } }
    case 'splitAt':
      return { name: 'split_at', args: { time: command.time } }
    case 'rippleDelete':
      return { name: 'ripple_delete', args: { start: command.start, end: command.end } }
    case 'rippleDeleteMarks':
      return { name: 'ripple_delete_marks', args: {} }
    case 'applySuggestion':
      return { name: 'apply_suggestion', args: { suggestionId: command.suggestionId } }
    case 'applySafeSuggestions':
      return { name: 'apply_safe_edits', args: {} }
    case 'dismissSuggestion':
      return { name: 'dismiss_suggestion', args: { suggestionId: command.suggestionId } }
    case 'revertSuggestion':
      return { name: 'revert_suggestion', args: { suggestionId: command.suggestionId } }
    case 'revertSuggestionType':
      return { name: 'revert_suggestion_type', args: { type: command.suggestionType } }
    case 'addTag':
      return {
        name: 'add_tag',
        args: { start: command.start, end: command.end, kind: command.kind, label: command.label }
      }
    case 'eraseTag':
      return { name: 'erase_tag', args: { start: command.start, end: command.end, kind: command.kind } }
    case 'removeTag':
      return { name: 'remove_tag', args: { tagId: command.tagId } }
    case 'setMarks':
      return { name: 'set_marks', args: { markIn: command.markIn, markOut: command.markOut } }
    case 'rebuildSuggestions':
      return { name: 'rebuild_suggestions', args: {} }
    case 'cutSentence':
      return { name: 'cut_sentence', args: { wordId: command.wordId } }
    case 'cutPreviousSentence':
      return { name: 'cut_previous_sentence', args: { wordId: command.wordId } }
    case 'tightenRange':
      return { name: 'tighten', args: { start: command.start, end: command.end } }
    case 'setScenes':
      return { name: 'set_scenes', args: { scenes: command.scenes } }
    case 'revertAt':
      return { name: 'revert_at', args: { start: command.start, end: command.end } }
    case 'inferScenes':
      return { name: 'infer_scenes', args: {} }
    case 'collapseRetakes':
      return { name: 'collapse_retakes', args: {} }
    case 'applyModelSuggestions':
      return { name: 'apply_model_suggestions', args: {} }
    case 'setSpeed':
      return { name: 'set_speed', args: { start: command.start, end: command.end, speed: command.speed } }
    case 'addCaption':
      return { name: 'add_caption', args: { start: command.start, duration: command.duration, text: command.text } }
    case 'addZoom':
      return { name: 'add_zoom', args: { start: command.start, duration: command.duration, scale: command.scale } }
    case 'setSpeaker':
      return { name: 'set_speaker', args: { wordIds: command.wordIds, speakerId: command.speakerId } }
    default:
      return { name: 'apply_command', args: { command } }
  }
}

export function findProductFumble(project: Project): { start: number; end: number; text: string } | null {
  const hit = project.transcript.words.find((w) => !w.deleted && PRODUCT.test(w.text.replace(/[^\w]/g, '')))
  if (!hit) return null
  const span = sentenceRange(project.transcript.words, hit.id) ?? { start: hit.start, end: hit.end }
  return { start: span.start, end: span.end, text: hit.text }
}

export function planToolCalls(
  project: Project,
  intent: string,
  session: EditorSession = EMPTY_SESSION
): { calls: PlannedCall[]; note: string } {
  const lower = intent.trim().toLowerCase()
  const selected = session.selectedWordIds

  if (selected.length && /(cut|remove|delete|drop)\b/.test(lower) && /\b(this|these|selection|selected)\b/.test(lower)) {
    if (/sentence/.test(lower) && /previous|false start/.test(lower)) {
      return {
        calls: [{ name: 'cut_previous_sentence', args: { wordId: selected[0] } }],
        note: 'Cut the previous sentence from the selection.'
      }
    }
    if (/sentence/.test(lower)) {
      return {
        calls: [{ name: 'cut_sentence', args: { wordId: selected[0] } }],
        note: 'Cut the selected sentence.'
      }
    }
    return {
      calls: [{ name: 'toggle_words', args: { wordIds: selected } }],
      note: 'Cut the selected words.'
    }
  }

  if (/fumble|stumble|botch|wrong (product )?name|product name/.test(lower)) {
    const fumble = findProductFumble(project)
    if (fumble) {
      return {
        calls: [{ name: 'delete_range', args: { start: fumble.start, end: fumble.end, source: 'model' } }],
        note: `Cut the fumbled product name (“${fumble.text}”).`
      }
    }
    const about = wordsMatchingPhrase(project.transcript.words, 'Shotcut')
    if (about.length) {
      return {
        calls: [{ name: 'cut_words', args: { phrase: 'Shotcut' } }],
        note: 'Cut “Shotcut”.'
      }
    }
  }

  const planned = planIntent(project, intent)
  if (planned.commands.length) {
    return { calls: planned.commands.map(commandToTool), note: planned.note }
  }
  return { calls: [], note: planned.note }
}

function summarize(note: string, calls: AgentCall[]): string {
  const writes = calls.filter((c) => !READ_TOOLS.has(c.name))
  if (!writes.length) return note
  const bits = writes.map((c) => c.message).filter(Boolean)
  return bits.length ? `${note} · ${bits.join(' · ')}` : note
}

async function executeCalls(
  project: Project,
  planned: PlannedCall[],
  intel: ModelEndpoint | undefined,
  session: EditorSession
): Promise<{ project: Project; calls: AgentCall[] }> {
  let current = project
  const calls: AgentCall[] = []
  for (const call of planned) {
    if (call.name === 'edit_with_intent') continue
    const result = await runTool(current, call.name, call.args, intel, session)
    calls.push({ name: call.name, args: call.args, message: result.message })
    current = result.project
  }
  return { project: current, calls }
}

function parseToolDraft(raw: unknown): { note: string; calls: PlannedCall[] } {
  const data = raw as { note?: string; calls?: PlannedCall[]; tools?: PlannedCall[] }
  const list = Array.isArray(data.calls) ? data.calls : Array.isArray(data.tools) ? data.tools : []
  const allowed = new Set(MCP_TOOLS.map((t) => t.name))
  const calls = list.flatMap((call) => {
    if (!call || typeof call.name !== 'string' || !allowed.has(call.name)) return []
    if (call.name === 'edit_with_intent') return []
    return [{ name: call.name, args: (call.args ?? {}) as Record<string, unknown> }]
  })
  return { note: String(data.note ?? ''), calls }
}

async function planWithModel(
  project: Project,
  intent: string,
  session: EditorSession,
  intel: ModelEndpoint,
  prior: AgentCall[]
): Promise<{ note: string; calls: PlannedCall[] }> {
  const tools = MCP_TOOLS.filter((t) => t.name !== 'edit_with_intent')
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n')
  const priorText = prior.length
    ? `\nPrior tool results:\n${prior.map((c) => `${c.name} → ${c.message}`).join('\n')}`
    : ''
  const { host } = await import('../host')
  const text = await host.complete({
    endpoint: intel,
    messages: [
      {
        role: 'system',
        content: `You edit a SpeechEdit reel by calling tools. Every write tool wraps applyCommand, so undo works.
Return ONLY JSON: {"note":"what changed","calls":[{"name":"tool_name","args":{}}]}
Times are SOURCE seconds unless a tool says program time.
Honor keep/demo tags. Auto-cut like Auto-Editor while skipping a tagged silent demo = apply_safe_edits (guards already punch holes).
To remove a fumbled product name: search_transcript, then delete_range or cut_words.
Do not invent a second project format. Do not call edit_with_intent.
Tools:\n${tools}`
      },
      {
        role: 'user',
        content: `${intent}\n\n${renderAgentBrief(project, session)}${priorText}`
      }
    ]
  })
  return parseToolDraft(extractJson(text))
}

export async function runAgent(
  project: Project,
  intent: string,
  session: EditorSession = EMPTY_SESSION,
  intel?: ModelEndpoint
): Promise<AgentTurn> {
  const local = planToolCalls(project, intent, session)
  if (local.calls.length) {
    const ran = await executeCalls(project, local.calls, intel, session)
    return { project: ran.project, calls: ran.calls, message: summarize(local.note, ran.calls) }
  }

  if (intel && endpointReady(intel)) {
    let current = project
    const calls: AgentCall[] = []
    for (let round = 0; round < 3; round++) {
      const draft = await planWithModel(current, intent, session, intel, calls)
      if (!draft.calls.length) {
        return {
          project: current,
          calls,
          message: summarize(draft.note || local.note, calls)
        }
      }
      const ran = await executeCalls(current, draft.calls, intel, session)
      calls.push(...ran.calls)
      current = ran.project
      if (draft.calls.some((c) => !READ_TOOLS.has(c.name))) {
        return { project: current, calls, message: summarize(draft.note || 'Model edited the reel.', calls) }
      }
    }
    return { project: current, calls, message: summarize('Read context; no edit.', calls) }
  }

  return { project, calls: [], message: local.note }
}
