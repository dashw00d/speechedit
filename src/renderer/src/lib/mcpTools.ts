import type { Command, Project, SuggestionType, TagKind } from '../types'
import { buildAgentContext, renderAgentBrief } from './agentContext'
import { applyCommand, programLength } from './commands'
import { planIntent } from './intent'
import { runIntelligence } from './intelligence'
import { endpointReady } from './providers'
import type { ModelEndpoint } from './settings'
import { wordRange, wordsMatchingPhrase } from './transcriptEdit'

export interface ToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ToolResult {
  project: Project
  message: string
  data?: unknown
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export const MCP_TOOLS: ToolSpec[] = [
  {
    name: 'get_context',
    description: 'Full editorial brief: transcript with cuts marked, scenes, guards, suggestions, program length.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_transcript',
    description: 'Word-level transcript with ids, times, speakers, and deleted flags.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'search_transcript',
    description: 'Find words matching a phrase.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    }
  },
  {
    name: 'get_timeline',
    description: 'Cuts, overlays, captions, extra audio, marks, and program duration.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_suggestions',
    description: 'Auto-edit and model suggestions.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_tags',
    description: 'Keep/demo/note guards that punch holes in auto-edit.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_scenes',
    description: 'Editorial scenes and retake links.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_program',
    description: 'Program vs source duration and live word count.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'list_commands',
    description: 'Command-bus types the editor accepts.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'apply_command',
    description: 'Apply one SpeechEdit command object from the command bus.',
    inputSchema: { type: 'object', properties: { command: { type: 'object' } }, required: ['command'] }
  },
  {
    name: 'cut_range',
    description: 'Ripple-cut a source-time range.',
    inputSchema: {
      type: 'object',
      properties: { start: { type: 'number' }, end: { type: 'number' }, source: { type: 'string' } },
      required: ['start', 'end']
    }
  },
  {
    name: 'restore_range',
    description: 'Put a source-time range back.',
    inputSchema: {
      type: 'object',
      properties: { start: { type: 'number' }, end: { type: 'number' } },
      required: ['start', 'end']
    }
  },
  {
    name: 'cut_words',
    description: 'Cut every match of a phrase in the transcript.',
    inputSchema: { type: 'object', properties: { phrase: { type: 'string' } }, required: ['phrase'] }
  },
  {
    name: 'restore_words',
    description: 'Restore every match of a phrase.',
    inputSchema: { type: 'object', properties: { phrase: { type: 'string' } }, required: ['phrase'] }
  },
  {
    name: 'cut_sentence',
    description: 'Cut the sentence containing this word id.',
    inputSchema: { type: 'object', properties: { wordId: { type: 'string' } }, required: ['wordId'] }
  },
  {
    name: 'cut_previous_sentence',
    description: 'Cut the sentence before this word (false start).',
    inputSchema: { type: 'object', properties: { wordId: { type: 'string' } }, required: ['wordId'] }
  },
  {
    name: 'tighten',
    description: 'Cut gaps in a source range, honoring keep/demo guards.',
    inputSchema: {
      type: 'object',
      properties: { start: { type: 'number' }, end: { type: 'number' } },
      required: ['start', 'end']
    }
  },
  {
    name: 'apply_safe_edits',
    description: 'Apply safe silence/filler/normalize suggestions. Guarded demo/keep ranges stay.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'apply_suggestion',
    description: 'Apply one suggestion by id.',
    inputSchema: { type: 'object', properties: { suggestionId: { type: 'string' } }, required: ['suggestionId'] }
  },
  {
    name: 'revert_suggestion',
    description: 'Undo one applied suggestion without touching the rest.',
    inputSchema: { type: 'object', properties: { suggestionId: { type: 'string' } }, required: ['suggestionId'] }
  },
  {
    name: 'revert_suggestion_type',
    description: 'Undo every applied suggestion of a type: silence, filler, repeat, model, static, loud, pace.',
    inputSchema: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] }
  },
  {
    name: 'revert_at',
    description: 'Put back the auto-edit covering this source span, or restore the range.',
    inputSchema: {
      type: 'object',
      properties: { start: { type: 'number' }, end: { type: 'number' } },
      required: ['start', 'end']
    }
  },
  {
    name: 'add_tag',
    description: 'Paint a keep/demo/note guard so Auto Edit skips that footage. Keep/demo also puts back overlapping auto-edits.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: 'number' },
        end: { type: 'number' },
        kind: { type: 'string', enum: ['keep', 'demo', 'note'] },
        label: { type: 'string' }
      },
      required: ['start', 'end', 'kind']
    }
  },
  {
    name: 'erase_tag',
    description: 'Erase guards in a source range.',
    inputSchema: {
      type: 'object',
      properties: { start: { type: 'number' }, end: { type: 'number' }, kind: { type: 'string' } },
      required: ['start', 'end']
    }
  },
  {
    name: 'remove_tag',
    description: 'Remove a guard by id.',
    inputSchema: { type: 'object', properties: { tagId: { type: 'string' } }, required: ['tagId'] }
  },
  {
    name: 'set_marks',
    description: 'Set in/out marks in program time.',
    inputSchema: {
      type: 'object',
      properties: { markIn: { type: 'number' }, markOut: { type: 'number' } }
    }
  },
  {
    name: 'split_at',
    description: 'Razor the primary at a source time.',
    inputSchema: { type: 'object', properties: { time: { type: 'number' } }, required: ['time'] }
  },
  {
    name: 'ripple_delete',
    description: 'Ripple-delete a source range.',
    inputSchema: {
      type: 'object',
      properties: { start: { type: 'number' }, end: { type: 'number' } },
      required: ['start', 'end']
    }
  },
  {
    name: 'set_word_text',
    description: 'Rewrite one transcript word without cutting it.',
    inputSchema: {
      type: 'object',
      properties: { wordId: { type: 'string' }, text: { type: 'string' } },
      required: ['wordId', 'text']
    }
  },
  {
    name: 'set_speaker',
    description: 'Assign words to a speaker id.',
    inputSchema: {
      type: 'object',
      properties: { wordIds: { type: 'array', items: { type: 'string' } }, speakerId: { type: 'string' } },
      required: ['wordIds', 'speakerId']
    }
  },
  {
    name: 'rebuild_suggestions',
    description: 'Rebuild silence/filler/repeat/static suggestions. Keeps applied ones.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'set_scenes',
    description: 'Replace editorial scenes.',
    inputSchema: { type: 'object', properties: { scenes: { type: 'array' } }, required: ['scenes'] }
  },
  {
    name: 'edit_with_intent',
    description:
      'Natural-language edit. Uses local heuristics, then an intelligence model if configured (Ollama/Groq/OpenAI-compatible).',
    inputSchema: { type: 'object', properties: { intent: { type: 'string' } }, required: ['intent'] }
  },
  {
    name: 'run_intelligence',
    description: 'Ask the configured model to group scenes, find retakes, and propose cuts.',
    inputSchema: { type: 'object', properties: { intent: { type: 'string' } } }
  }
]

export async function runTool(
  project: Project,
  name: string,
  args: Record<string, unknown>,
  intel?: ModelEndpoint
): Promise<ToolResult> {
  const apply = (command: Command, message: string): ToolResult => ({
    project: applyCommand(project, command),
    message
  })

  switch (name) {
    case 'get_context':
      return { project, message: renderAgentBrief(project), data: buildAgentContext(project) }
    case 'get_transcript':
      return { project, message: `${project.transcript.words.length} words`, data: project.transcript }
    case 'search_transcript': {
      const hits = wordsMatchingPhrase(project.transcript.words, String(args.query ?? ''))
      return { project, message: `${hits.length} hits`, data: hits }
    }
    case 'get_timeline':
      return {
        project,
        message: `program ${programLength(project).toFixed(2)}s`,
        data: {
          cuts: project.cuts,
          tracks: project.tracks.map((t) => ({
            id: t.id,
            type: t.type,
            name: t.name,
            clips: t.clips.map((c) => ({ id: c.id, start: c.start, duration: c.duration, text: c.text }))
          })),
          markIn: project.markIn,
          markOut: project.markOut
        }
      }
    case 'get_suggestions':
      return { project, message: `${project.suggestions.length} suggestions`, data: project.suggestions }
    case 'get_tags':
      return { project, message: `${project.tags.length} tags`, data: project.tags }
    case 'get_scenes':
      return { project, message: `${(project.scenes ?? []).length} scenes`, data: project.scenes ?? [] }
    case 'get_program':
      return {
        project,
        message: `source ${project.sourceDuration} → program ${programLength(project)}`,
        data: {
          sourceDuration: project.sourceDuration,
          programDuration: programLength(project),
          liveWords: project.transcript.words.filter((w) => !w.deleted).length
        }
      }
    case 'list_commands':
      return { project, message: `${MCP_TOOLS.length} tools`, data: MCP_TOOLS.map((t) => t.name) }
    case 'apply_command':
      return apply(args.command as Command, 'Applied command.')
    case 'cut_range':
      return apply(
        { type: 'deleteRange', start: num(args.start), end: num(args.end), source: 'model' },
        'Cut range.'
      )
    case 'restore_range':
      return apply({ type: 'restoreRange', start: num(args.start), end: num(args.end) }, 'Restored range.')
    case 'cut_words': {
      const words = wordsMatchingPhrase(project.transcript.words, String(args.phrase ?? ''))
      if (!words.length) return { project, message: 'No matching words.' }
      return apply({ type: 'toggleWords', wordIds: words.map((w) => w.id) }, `Cut “${args.phrase}”.`)
    }
    case 'restore_words': {
      const words = wordsMatchingPhrase(project.transcript.words, String(args.phrase ?? ''))
      const span = wordRange(project.transcript.words, words.map((w) => w.id))
      if (!span) return { project, message: 'No matching words.' }
      return apply({ type: 'restoreRange', start: span.start, end: span.end }, `Restored “${args.phrase}”.`)
    }
    case 'cut_sentence':
      return apply({ type: 'cutSentence', wordId: String(args.wordId) }, 'Cut sentence.')
    case 'cut_previous_sentence':
      return apply({ type: 'cutPreviousSentence', wordId: String(args.wordId) }, 'Cut previous sentence.')
    case 'tighten':
      return apply({ type: 'tightenRange', start: num(args.start), end: num(args.end) }, 'Tightened gaps.')
    case 'apply_safe_edits':
      return apply({ type: 'applySafeSuggestions' }, 'Applied safe edits.')
    case 'apply_suggestion':
      return apply({ type: 'applySuggestion', suggestionId: String(args.suggestionId) }, 'Applied suggestion.')
    case 'revert_suggestion':
      return apply({ type: 'revertSuggestion', suggestionId: String(args.suggestionId) }, 'Reverted suggestion.')
    case 'revert_suggestion_type':
      return apply(
        { type: 'revertSuggestionType', suggestionType: String(args.type) as SuggestionType },
        `Reverted ${args.type}.`
      )
    case 'revert_at':
      return apply({ type: 'revertAt', start: num(args.start), end: num(args.end) }, 'Reverted span.')
    case 'add_tag':
      return apply(
        {
          type: 'addTag',
          start: num(args.start),
          end: num(args.end),
          kind: String(args.kind) as TagKind,
          label: args.label ? String(args.label) : undefined
        },
        `Tagged ${args.kind}.`
      )
    case 'erase_tag':
      return apply(
        {
          type: 'eraseTag',
          start: num(args.start),
          end: num(args.end),
          kind: args.kind ? (String(args.kind) as TagKind) : undefined
        },
        'Erased tag paint.'
      )
    case 'remove_tag':
      return apply({ type: 'removeTag', tagId: String(args.tagId) }, 'Removed tag.')
    case 'set_marks':
      return apply(
        {
          type: 'setMarks',
          markIn: args.markIn == null ? undefined : num(args.markIn),
          markOut: args.markOut == null ? undefined : num(args.markOut)
        },
        'Set marks.'
      )
    case 'split_at':
      return apply({ type: 'splitAt', time: num(args.time) }, 'Split.')
    case 'ripple_delete':
      return apply({ type: 'rippleDelete', start: num(args.start), end: num(args.end) }, 'Ripple deleted.')
    case 'set_word_text':
      return apply(
        { type: 'setWordText', wordId: String(args.wordId), text: String(args.text) },
        'Rewrote word.'
      )
    case 'set_speaker':
      return apply(
        {
          type: 'setSpeaker',
          wordIds: Array.isArray(args.wordIds) ? args.wordIds.map(String) : [],
          speakerId: String(args.speakerId)
        },
        'Assigned speaker.'
      )
    case 'rebuild_suggestions':
      return apply({ type: 'rebuildSuggestions' }, 'Rebuilt suggestions.')
    case 'set_scenes':
      return apply({ type: 'setScenes', scenes: (args.scenes as Project['scenes']) ?? [] }, 'Set scenes.')
    case 'edit_with_intent': {
      const intent = String(args.intent ?? '')
      const local = planIntent(project, intent)
      if (local.commands.length) {
        const next = local.commands.reduce((acc, command) => applyCommand(acc, command), project)
        return { project: next, message: local.note, data: local.commands }
      }
      if (intel && endpointReady(intel)) {
        const draft = await runIntelligence(project, intel, intent)
        let next = applyCommand(project, {
          type: 'mergeIntelligence',
          scenes: draft.scenes,
          suggestions: draft.suggestions
        })
        next = draft.commands.reduce((acc, command) => applyCommand(acc, command), next)
        return {
          project: next,
          message: draft.notes || 'Model edited the reel.',
          data: draft
        }
      }
      return { project, message: local.note, data: local }
    }
    case 'run_intelligence': {
      if (!intel || !endpointReady(intel)) {
        return { project, message: 'No intelligence model configured. Set SPEECHEDIT_LLM_BASE_URL or the Inspector.' }
      }
      const draft = await runIntelligence(project, intel, args.intent ? String(args.intent) : undefined)
      const next = applyCommand(project, {
        type: 'mergeIntelligence',
        scenes: draft.scenes,
        suggestions: draft.suggestions
      })
      return { project: next, message: draft.notes || 'Model proposed scenes and cuts.', data: draft }
    }
    default:
      return { project, message: `Unknown tool ${name}` }
  }
}
