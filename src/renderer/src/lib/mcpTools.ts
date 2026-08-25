import type { Command, Project, SuggestionType, TagKind, TitlePreset } from '../types'
import {
  EMPTY_SESSION,
  buildAgentContext,
  compactSnapshot,
  renderAgentBrief,
  type EditorSession
} from './agentContext'
import { applyCommand, programLength } from './commands'
import { parseAnyTranscript, parseTranscriptJson } from './transcript'
import { runSceneIntelligence } from './intelligence'
import { endpointReady } from './providers'
import { programToSourceOf, sourceToProgramOf } from './resolver'
import type { ModelEndpoint } from './settings'
import { wordRange, wordsMatchingPhrase } from './transcriptEdit'

/** Agent-exposed applyCommand types. Not the full Command union (NLE owns moveClip, setTrackFlag, …). */
export const COMMAND_BUS: Command['type'][] = [
  'deleteRange',
  'restoreRange',
  'toggleWords',
  'setWordText',
  'splitAt',
  'rippleDelete',
  'rippleDeleteMarks',
  'liftMarks',
  'insertGap',
  'removeInsert',
  'applySuggestion',
  'applySafeSuggestions',
  'dismissSuggestion',
  'revertSuggestion',
  'revertSuggestionType',
  'addTag',
  'eraseTag',
  'removeTag',
  'setMarks',
  'addCaption',
  'rebuildSuggestions',
  'setTranscript',
  'cutSentence',
  'cutPreviousSentence',
  'tightenRange',
  'setScenes',
  'revertAt',
  'inferScenes',
  'rebuildIntelligence',
  'collapseRetakes',
  'keepTake',
  'applyModelSuggestions',
  'generateCaptions',
  'addLowerThirds',
  'addTitle',
  'importCaptions',
  'setSpeed',
  'setRangeVolume',
  'setSpeaker',
  'addSpeaker',
  'renameSpeaker',
  'renameScene'
]

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
    description: 'Full editorial brief: transcript with cuts marked, scenes, protected ranges, suggestions, program length.',
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
    description: 'Protected / silent-demo / note ranges that Auto Edit skips.',
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
    name: 'get_snapshot',
    description: 'Compact view of the same project JSON (no waveforms). Enough to auto-cut with protected ranges, retakes, speakers, and In/Out marks.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_cuts',
    description: 'Source cuts with program-time mapping.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_selection',
    description: 'Selected words, selected clip, playhead (program + source), and In/Out marks.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'list_commands',
    description:
      'Agent-exposed applyCommand types (subset of the full Command union; NLE-only types like moveClip/setTrackFlag are omitted).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'apply_command',
    description: 'Apply one SpeechEdit command object from the command bus.',
    inputSchema: { type: 'object', properties: { command: { type: 'object' } }, required: ['command'] }
  },
  {
    name: 'delete_range',
    description: 'Ripple-cut a source-time range via deleteRange.',
    inputSchema: {
      type: 'object',
      properties: { start: { type: 'number' }, end: { type: 'number' }, source: { type: 'string' } },
      required: ['start', 'end']
    }
  },
  {
    name: 'cut_range',
    description: 'Alias of delete_range.',
    inputSchema: {
      type: 'object',
      properties: { start: { type: 'number' }, end: { type: 'number' }, source: { type: 'string' } },
      required: ['start', 'end']
    }
  },
  {
    name: 'toggle_words',
    description: 'Toggle cut/restore on word ids (same as clicking words).',
    inputSchema: {
      type: 'object',
      properties: { wordIds: { type: 'array', items: { type: 'string' } } },
      required: ['wordIds']
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
    description: 'Cut gaps in a source range. Protected and silent-demo ranges stay.',
    inputSchema: {
      type: 'object',
      properties: { start: { type: 'number' }, end: { type: 'number' } },
      required: ['start', 'end']
    }
  },
  {
    name: 'apply_safe_edits',
    description: 'Apply safe silence/filler/normalize suggestions. Protected demo/keep ranges stay.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'apply_safe_suggestions',
    description: 'Alias of apply_safe_edits (applySafeSuggestions).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'dismiss_suggestion',
    description: 'Dismiss one suggestion without applying it.',
    inputSchema: { type: 'object', properties: { suggestionId: { type: 'string' } }, required: ['suggestionId'] }
  },
  {
    name: 'ripple_delete_marks',
    description: 'Cut the marked In/Out range and close the gap.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'lift_marks',
    description: 'Cut the marked In/Out range but leave a black/silence hold so later clips stay put.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'insert_gap',
    description: 'Insert a program-time hold (black + silence) at time, shifting later overlays.',
    inputSchema: {
      type: 'object',
      properties: { time: { type: 'number' }, duration: { type: 'number' } },
      required: ['time']
    }
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
    description: 'Protect a source range (keep / silent demo / note). Auto Edit skips it. Keep and demo also put back overlapping auto-edits.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: 'number' },
        end: { type: 'number' },
        kind: { type: 'string', enum: ['keep', 'demo', 'note', 'hook', 'cta'] },
        label: { type: 'string' }
      },
      required: ['start', 'end', 'kind']
    }
  },
  {
    name: 'erase_tag',
    description: 'Remove protection in a source range.',
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
    name: 'add_speaker',
    description: 'Add a speaker to the reel.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } } }
  },
  {
    name: 'rename_speaker',
    description: 'Rename a speaker.',
    inputSchema: {
      type: 'object',
      properties: { speakerId: { type: 'string' }, name: { type: 'string' } },
      required: ['speakerId', 'name']
    }
  },
  {
    name: 'rename_scene',
    description: 'Rename an editorial scene heading or rewrite its summary.',
    inputSchema: {
      type: 'object',
      properties: {
        sceneId: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string' }
      },
      required: ['sceneId']
    }
  },
  {
    name: 'rebuild_suggestions',
    description: 'Rebuild silence/filler/repeat/static suggestions. Keeps applied ones.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'rebuild_intelligence',
    description: 'Local heuristic: regroup scenes, mark retakes, rebuild suggestions. Keeps applied cuts.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'infer_scenes',
    description: 'Group transcript words into scenes and mark retakes (offline heuristic).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'collapse_retakes',
    description: 'Cut superseded takes. Suggestions stay revertible.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'keep_take',
    description: 'Keep one scene in a retake family and cut the others.',
    inputSchema: { type: 'object', properties: { sceneId: { type: 'string' } }, required: ['sceneId'] }
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
    description:
      'Group scenes, find retakes, propose cuts. Uses the configured LLM, or a local heuristic pass if none is set.',
    inputSchema: { type: 'object', properties: { intent: { type: 'string' } } }
  },
  {
    name: 'apply_model_suggestions',
    description: 'Apply unblocked model-type cuts from the intelligence pass.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'set_speed',
    description: 'Speed a source-time range (static screens, loading).',
    inputSchema: {
      type: 'object',
      properties: { start: { type: 'number' }, end: { type: 'number' }, speed: { type: 'number' } },
      required: ['start', 'end', 'speed']
    }
  },
  {
    name: 'set_range_volume',
    description: 'Set voice volume on a source-time range (hot spikes).',
    inputSchema: {
      type: 'object',
      properties: { start: { type: 'number' }, end: { type: 'number' }, volume: { type: 'number' } },
      required: ['start', 'end', 'volume']
    }
  },
  {
    name: 'add_caption',
    description: 'Add a caption/title on the caption track at program time.',
    inputSchema: {
      type: 'object',
      properties: { start: { type: 'number' }, duration: { type: 'number' }, text: { type: 'string' } },
      required: ['start', 'text']
    }
  },
  {
    name: 'add_zoom',
    description: 'Add a zoom overlay at program time.',
    inputSchema: {
      type: 'object',
      properties: { start: { type: 'number' }, duration: { type: 'number' }, scale: { type: 'number' } },
      required: ['start']
    }
  },
  {
    name: 'get_mapping',
    description: 'Map a source time to program time, or the reverse.',
    inputSchema: {
      type: 'object',
      properties: { source: { type: 'number' }, program: { type: 'number' } }
    }
  },
  {
    name: 'generate_captions',
    description: 'Build V3 captions from live transcript words (command bus).',
    inputSchema: {
      type: 'object',
      properties: {
        maxWords: { type: 'number' },
        speakerPrefix: { type: 'boolean' },
        emphasize: { type: 'boolean' }
      }
    }
  },
  {
    name: 'add_lower_thirds',
    description: 'Add scene titles as lower thirds on the overlay track.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'add_title',
    description: 'Add a title, lower-third, or chapter card at program time.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: 'number' },
        duration: { type: 'number' },
        text: { type: 'string' },
        preset: { type: 'string' }
      },
      required: ['start', 'text']
    }
  },
  {
    name: 'import_captions',
    description: 'Replace the caption track from SRT or VTT text.',
    inputSchema: {
      type: 'object',
      properties: { filename: { type: 'string' }, text: { type: 'string' } },
      required: ['text']
    }
  },
  {
    name: 'set_transcript',
    description:
      'Replace the transcript from SpeechEdit words[], Whisper/OpenAI JSON, SRT, or VTT. Same command bus as File → Open transcript.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string' },
        text: { type: 'string', description: 'File body (JSON, SRT, or VTT)' },
        words: { type: 'array', description: 'Already-parsed Word[] or Whisper words[]' }
      }
    }
  },
  {
    name: 'apply_diarization',
    description: 'Map provider speaker labels onto transcript speakers via the command bus.',
    inputSchema: {
      type: 'object',
      properties: {
        assignments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              start: { type: 'number' },
              end: { type: 'number' },
              speaker: { type: 'string' }
            }
          }
        }
      }
    }
  }
]

export async function runTool(
  project: Project,
  name: string,
  args: Record<string, unknown>,
  intel?: ModelEndpoint,
  session: EditorSession = EMPTY_SESSION
): Promise<ToolResult> {
  const apply = (command: Command, message: string): ToolResult => ({
    project: applyCommand(project, command),
    message
  })

  switch (name) {
    case 'get_context':
      return {
        project,
        message: renderAgentBrief(project, session),
        data: buildAgentContext(project, session)
      }
    case 'get_snapshot':
      return {
        project,
        message: 'Compact project snapshot.',
        data: compactSnapshot(project)
      }
    case 'get_cuts':
      return {
        project,
        message: `${project.cuts.length} cuts`,
        data: buildAgentContext(project, session).cuts
      }
    case 'get_selection':
      return {
        project,
        message: session.selectedWordIds.length
          ? `${session.selectedWordIds.length} words selected`
          : 'No words selected.',
        data: {
          ...buildAgentContext(project, session).selection,
          playhead: buildAgentContext(project, session).playhead,
          marks: buildAgentContext(project, session).marks
        }
      }
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
      return {
        project,
        message: `${COMMAND_BUS.length} agent-exposed command types`,
        data: { commands: COMMAND_BUS, scope: 'agent-exposed subset of applyCommand' }
      }
    case 'apply_command':
      return apply(args.command as Command, 'Applied command.')
    case 'delete_range':
    case 'cut_range':
      return apply(
        {
          type: 'deleteRange',
          start: num(args.start),
          end: num(args.end),
          lift: Boolean(args.lift),
          source: args.source === 'transcript' || args.source === 'repeat' || args.source === 'silence' || args.source === 'filler'
            ? args.source
            : 'model'
        },
        args.lift ? 'Lifted range.' : 'Cut range.'
      )
    case 'toggle_words': {
      const wordIds = Array.isArray(args.wordIds) ? args.wordIds.map(String) : []
      if (!wordIds.length) return { project, message: 'No word ids.' }
      return apply({ type: 'toggleWords', wordIds }, `Toggled ${wordIds.length} words.`)
    }
    case 'restore_range':
      return apply({ type: 'restoreRange', start: num(args.start), end: num(args.end) }, 'Restored range.')
    case 'cut_words': {
      const words = wordsMatchingPhrase(project.transcript.words, String(args.phrase ?? '')).filter((w) => !w.deleted)
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
    case 'apply_safe_suggestions':
      return apply({ type: 'applySafeSuggestions' }, 'Applied safe edits.')
    case 'dismiss_suggestion':
      return apply({ type: 'dismissSuggestion', suggestionId: String(args.suggestionId) }, 'Dismissed suggestion.')
    case 'ripple_delete_marks':
      return apply({ type: 'rippleDeleteMarks' }, 'Cut the marked range.')
    case 'lift_marks':
      return apply({ type: 'liftMarks' }, 'Lifted the marked range.')
    case 'insert_gap':
      return apply(
        { type: 'insertGap', time: num(args.time), duration: num(args.duration, 1) },
        'Inserted a hold.'
      )
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
    case 'add_speaker':
      return apply({ type: 'addSpeaker', name: args.name ? String(args.name) : undefined }, 'Added speaker.')
    case 'rename_speaker':
      return apply(
        { type: 'renameSpeaker', speakerId: String(args.speakerId), name: String(args.name ?? '') },
        'Renamed speaker.'
      )
    case 'rename_scene':
      return apply(
        {
          type: 'renameScene',
          sceneId: String(args.sceneId),
          title: args.title == null ? undefined : String(args.title),
          summary: args.summary == null ? undefined : String(args.summary)
        },
        'Renamed scene.'
      )
    case 'rebuild_suggestions':
      return apply({ type: 'rebuildSuggestions' }, 'Rebuilt suggestions.')
    case 'rebuild_intelligence':
      return apply({ type: 'rebuildIntelligence' }, 'Rebuilt scenes and retakes.')
    case 'infer_scenes':
      return apply({ type: 'inferScenes' }, 'Inferred scenes and retakes.')
    case 'collapse_retakes':
      return apply({ type: 'collapseRetakes' }, 'Collapsed retakes.')
    case 'keep_take':
      return apply({ type: 'keepTake', sceneId: String(args.sceneId) }, 'Kept that take.')
    case 'set_scenes':
      return apply({ type: 'setScenes', scenes: (args.scenes as Project['scenes']) ?? [] }, 'Set scenes.')
    case 'edit_with_intent': {
      const { runAgent } = await import('./agent')
      const turn = await runAgent(project, String(args.intent ?? ''), session, intel)
      return { project: turn.project, message: turn.message, data: turn.calls }
    }
    case 'generate_captions':
      return apply(
        {
          type: 'generateCaptions',
          maxWords: args.maxWords == null ? undefined : num(args.maxWords, 5),
          speakerPrefix: Boolean(args.speakerPrefix),
          emphasize: args.emphasize == null ? true : Boolean(args.emphasize)
        },
        'Generated captions.'
      )
    case 'add_lower_thirds':
      return apply({ type: 'addLowerThirds' }, 'Added scene lower thirds.')
    case 'add_title':
      return apply(
        {
          type: 'addTitle',
          start: num(args.start),
          duration: args.duration == null ? 3 : num(args.duration, 3),
          text: String(args.text ?? 'Title'),
          preset: args.preset ? (String(args.preset) as TitlePreset) : 'title'
        },
        'Added title.'
      )
    case 'import_captions':
      return apply(
        {
          type: 'importCaptions',
          filename: String(args.filename ?? 'captions.srt'),
          text: String(args.text ?? '')
        },
        'Imported captions.'
      )
    case 'set_transcript': {
      const words = Array.isArray(args.words)
        ? parseTranscriptJson(args.words)
        : parseAnyTranscript(String(args.filename ?? 'transcript.json'), String(args.text ?? ''))
      return apply({ type: 'setTranscript', words }, `Transcript · ${words.length} words`)
    }
    case 'apply_diarization':
      return apply(
        {
          type: 'applyDiarization',
          assignments: Array.isArray(args.assignments)
            ? (args.assignments as Array<{ start: number; end: number; speaker: string }>)
            : undefined
        },
        'Applied diarization.'
      )
    case 'run_intelligence': {
      const draft = await runSceneIntelligence(
        project,
        intel && endpointReady(intel) ? intel : undefined,
        args.intent ? String(args.intent) : undefined
      )
      const next = applyCommand(project, {
        type: 'mergeIntelligence',
        scenes: draft.scenes,
        suggestions: draft.suggestions
      })
      return { project: next, message: draft.notes || 'Proposed scenes and cuts.', data: draft }
    }
    case 'apply_model_suggestions':
      return apply({ type: 'applyModelSuggestions' }, 'Applied model cuts.')
    case 'set_speed':
      return apply(
        { type: 'setSpeed', start: num(args.start), end: num(args.end), speed: num(args.speed, 4) },
        'Set speed.'
      )
    case 'set_range_volume':
      return apply(
        {
          type: 'setRangeVolume',
          start: num(args.start),
          end: num(args.end),
          volume: num(args.volume, 0.5)
        },
        'Set range volume.'
      )
    case 'add_caption':
      return apply(
        {
          type: 'addCaption',
          start: num(args.start),
          duration: num(args.duration, 3),
          text: String(args.text ?? 'Title')
        },
        'Added caption.'
      )
    case 'add_zoom':
      return apply(
        {
          type: 'addZoom',
          start: num(args.start),
          duration: num(args.duration, 3),
          scale: num(args.scale, 1.45)
        },
        'Added zoom.'
      )
    case 'get_mapping': {
      const source =
        args.source != null ? num(args.source) : programToSourceOf(project, num(args.program))
      const program =
        args.program != null ? num(args.program) : sourceToProgramOf(project, source)
      return { project, message: `source ${source.toFixed(3)} ↔ program ${program.toFixed(3)}`, data: { source, program } }
    }
    default:
      return { project, message: `Unknown tool ${name}` }
  }
}
