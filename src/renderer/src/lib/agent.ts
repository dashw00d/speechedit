import type { Command, Project } from '../types'
import { EMPTY_SESSION, type EditorSession, renderAgentBrief } from './agentContext'
import { planIntent } from './intent'
import { MCP_TOOLS, assistantToolsForIntent, runTool, type ToolDomain } from './mcpTools'
import { endpointReady, extractJson, type ChatMessage } from './providers'
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
    case 'splitScene':
      return { name: 'split_scene', args: { time: command.time, title: command.title, summary: command.summary } }
    case 'mergeScenes':
      return { name: 'merge_scenes', args: { sceneId: command.sceneId, otherId: command.otherId } }
    case 'rippleDelete':
      return { name: 'ripple_delete', args: { start: command.start, end: command.end } }
    case 'rippleDeleteMarks':
      return { name: 'ripple_delete_marks', args: {} }
    case 'applySuggestion':
      return { name: 'apply_suggestion', args: { suggestionId: command.suggestionId } }
    case 'resolveSuggestion':
      return {
        name: 'apply_command',
        args: { command }
      }
    case 'applySuggestions':
      return { name: 'apply_command', args: { command } }
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
    case 'setTranscript':
      return { name: 'set_transcript', args: { words: command.words } }
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
    case 'keepTake':
      return { name: 'keep_take', args: { sceneId: command.sceneId } }
    case 'rebuildIntelligence':
      return { name: 'rebuild_intelligence', args: {} }
    case 'generateCaptions':
      return {
        name: 'generate_captions',
        args: {
          maxWords: command.maxWords,
          speakerPrefix: command.speakerPrefix,
          emphasize: command.emphasize
        }
      }
    case 'addLowerThirds':
      return { name: 'add_lower_thirds', args: {} }
    case 'relinkAsset':
      return { name: 'apply_command', args: { command } }
    case 'applyModelSuggestions':
      return { name: 'apply_model_suggestions', args: {} }
    case 'setSpeed':
      return { name: 'set_speed', args: { start: command.start, end: command.end, speed: command.speed } }
    case 'setRangeVolume':
      return {
        name: 'set_range_volume',
        args: { start: command.start, end: command.end, volume: command.volume }
      }
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
  if (note.trim()) return note
  const bits = writes.map((c) => c.message).filter(Boolean)
  return bits.join(' · ')
}

export interface AgentFollowUpContext {
  question: string
  answer: string
  calls: AgentCall[]
}

export type AgentComplete = (endpoint: ModelEndpoint, messages: ChatMessage[], label?: string) => Promise<string>

async function completeFromHost(endpoint: ModelEndpoint, messages: ChatMessage[], label?: string): Promise<string> {
  const { host } = await import('../host')
  return host.complete({ endpoint, messages, label })
}

async function executeCalls(
  project: Project,
  planned: PlannedCall[],
  intel: ModelEndpoint | undefined,
  session: EditorSession,
  complete: AgentComplete
): Promise<{ project: Project; calls: AgentCall[] }> {
  let current = project
  const calls: AgentCall[] = []
  for (const call of planned) {
    if (call.name === 'edit_with_intent') continue
    const result = await runTool(current, call.name, call.args, intel, session, complete)
    calls.push({ name: call.name, args: call.args, message: result.message })
    current = result.project
  }
  return { project: current, calls }
}

function parseToolDraft(raw: unknown, allowedNames = new Set(MCP_TOOLS.map((tool) => tool.name))): { note: string; calls: PlannedCall[] } {
  const data = raw as { note?: string; calls?: PlannedCall[]; tools?: PlannedCall[] }
  const list = Array.isArray(data.calls) ? data.calls : Array.isArray(data.tools) ? data.tools : []
  const rejected = list
    .filter((call) => call && typeof call.name === 'string' && !allowedNames.has(call.name))
    .map((call) => call.name)
  const calls = list.flatMap((call) => {
    if (!call || typeof call.name !== 'string' || !allowedNames.has(call.name)) return []
    if (call.name === 'edit_with_intent') return []
    return [{ name: call.name, args: (call.args ?? {}) as Record<string, unknown> }]
  })
  const note = rejected.length
    ? `No edit made — blocked tool${rejected.length === 1 ? '' : 's'} outside this content domain: ${[...new Set(rejected)].join(', ')}.`
    : String(data.note ?? '')
  return { note, calls }
}

async function planWithModel(
  project: Project,
  intent: string,
  session: EditorSession,
  intel: ModelEndpoint,
  prior: AgentCall[],
  complete: AgentComplete,
  followUp?: AgentFollowUpContext
): Promise<{ note: string; calls: PlannedCall[] }> {
  const domainLabels: Record<ToolDomain, string> = {
    read_context: 'READ ONLY — inspect project state',
    timeline_edit: 'TIMELINE EDITS — cuts, timing, speed, and marks only',
    review_suggestions: 'REVIEW SUGGESTIONS — apply, dismiss, or revert suggestions only',
    annotations: 'ANNOTATIONS — keep/demo/note tags only',
    scene_structure: 'SCENE STRUCTURE — transcript chapters, names, summaries, and retakes only',
    transcript_content: 'TRANSCRIPT CONTENT — spoken words and speaker identity only',
    visible_graphics: 'VISIBLE GRAPHICS — on-screen captions, titles, lower thirds, and zooms only',
    media_layers: 'MEDIA LAYERS — B-roll, music, overlays, and extra timeline clips only',
    picture_effects: 'PICTURE EFFECTS — zoom, crop, transform, redaction, and canvas only',
    audio_mix: 'AUDIO MIX — volume automation only',
    internal_orchestration: 'INTERNAL — unavailable to Assistant'
  }
  const selectedTools = assistantToolsForIntent(
    intent,
    [...prior.map((call) => call.name), ...(followUp?.calls.map((call) => call.name) ?? [])]
  )
  const allowedNames = new Set(selectedTools.map((tool) => tool.name))
  const tools = [...new Set(selectedTools.map((tool) => tool.contract.domain))]
    .map((domain) => {
      const rows = selectedTools
        .filter((tool) => tool.contract.domain === domain)
        .map((tool) => `- ${tool.name} [${tool.contract.timebase} time]: ${tool.description}`)
        .join('\n')
      return `### ${domainLabels[domain]}\n${rows}`
    })
    .join('\n\n')
  const priorText = prior.length
    ? `\nPrior tool results:\n${prior.map((c) => `${c.name} → ${c.message}`).join('\n')}`
    : ''
  const conversationText = followUp
    ? `\nPrevious agent turn:\nUser: ${followUp.question}\nAgent: ${followUp.answer}\nActions: ${
        followUp.calls.length
          ? followUp.calls.map((call) => `${call.name} (${call.message})`).join('; ')
          : 'none'
      }\nThe request below is a follow-up to that turn. Use its context, but inspect the current editor state before changing anything.\n`
    : ''
  const text = await complete(intel, [
      {
        role: 'system',
        content: `You edit a SpeechEdit reel by calling tools. Every write tool wraps applyCommand, so undo works.
Return ONLY JSON: {"note":"what changed","calls":[{"name":"tool_name","args":{}}]}
Times are SOURCE seconds unless a tool says program time.
Honor keep/demo tags. Auto-cut like Auto-Editor while skipping a tagged silent demo = apply_safe_edits (guards already punch holes).
To remove a fumbled product name: search_transcript, then delete_range or cut_words.
"Caption" can mean the user's transcript or spoken section. If they ask to split a caption/transcript into mini scenes, beats, chapters, or sections, use split_scene with the existing scene id/title, exact beforeText from Transcript by scene, and a meaningful title. The tool enforces natural sentence boundaries. Never use add_title, add_lower_thirds, or add_caption unless they explicitly request visible on-screen graphics or subtitles.
Content domains are hard boundaries. A scene-structure request may change only scene headings, summaries, boundaries, and retake relationships. It must never create visible graphics. A visible-graphics request must never reorganize transcript scenes. Transcript-content tools change words or speakers, not timing. Timeline tools change playback timing, not transcript wording. Media-layer tools place or move B-roll/music/overlays; picture-effects tools change how visuals look; audio-mix tools change only sound.
Use the narrowest tool that matches the requested content. Generic command escape hatches and duplicate aliases are intentionally unavailable.
Do not invent a second project format. Do not call edit_with_intent.
Tools:\n${tools}`
      },
      {
        role: 'user',
        content: `${conversationText}\nCurrent request:\n${intent}\n\n${renderAgentBrief(project, session)}${priorText}`
      }
    ], `Plan edit · ${intent.slice(0, 54)}`)
  try {
    return parseToolDraft(extractJson(text), allowedNames)
  } catch {
    const note = text.trim()
    if (!note) throw new Error('Model returned an empty reply.')
    return { note, calls: [] }
  }
}

export async function runAgent(
  project: Project,
  intent: string,
  session: EditorSession = EMPTY_SESSION,
  intel?: ModelEndpoint,
  complete: AgentComplete = completeFromHost,
  followUp?: AgentFollowUpContext
): Promise<AgentTurn> {
  const local = planToolCalls(project, intent, session)
  if (local.calls.length && !followUp) {
    const ran = await executeCalls(project, local.calls, intel, session, complete)
    return { project: ran.project, calls: ran.calls, message: summarize(local.note, ran.calls) }
  }

  if (intel && endpointReady(intel)) {
    let current = project
    const calls: AgentCall[] = []
    for (let round = 0; round < 3; round++) {
      const draft = await planWithModel(current, intent, session, intel, calls, complete, followUp)
      if (!draft.calls.length) {
        return {
          project: current,
          calls,
          message: summarize(draft.note || local.note, calls)
        }
      }
      const beforeRound = current
      const ran = await executeCalls(current, draft.calls, intel, session, complete)
      calls.push(...ran.calls)
      current = ran.project
      if (draft.calls.some((c) => !READ_TOOLS.has(c.name))) {
        if (current === beforeRound) continue
        return { project: current, calls, message: summarize(draft.note || 'Model edited the reel.', calls) }
      }
    }
    const failedWrites = calls.filter((call) => !READ_TOOLS.has(call.name)).map((call) => call.message)
    return {
      project: current,
      calls,
      message: failedWrites.length
        ? `No edit made. ${failedWrites.join(' · ')}`
        : summarize('Read context; no edit.', calls)
    }
  }

  return { project, calls: [], message: local.note }
}
