import type { CaptionStyle, Command, Project, SuggestionType, TagKind, TitlePreset, Transform } from '../types'
import {
  EMPTY_SESSION,
  buildAgentContext,
  compactSnapshot,
  renderAgentBrief,
  type EditorSession
} from './agentContext'
import { toastForCaptionFollow } from './captions'
import { applyCommand, programLength } from './commands'
import { parseAnyTranscript, parseTranscriptJson } from './transcript'
import { runSceneIntelligence, type IntelligenceComplete } from './intelligence'
import { endpointReady } from './providers'
import { programToSourceOf, sourceToProgramOf } from './resolver'
import type { ModelEndpoint } from './settings'
import { PARAGRAPH_GAP, wordRange, wordsMatchingPhrase } from './transcriptEdit'

/** Agent-exposed applyCommand types. Not the full Command union (NLE owns moveClip, setTrackFlag, …). */
export const COMMAND_BUS: Command['type'][] = [
  'deleteRange',
  'restoreRange',
  'toggleWords',
  'setWordText',
  'splitAt',
  'splitScene',
  'mergeScenes',
  'rippleDelete',
  'rippleDeleteMarks',
  'liftMarks',
  'insertGap',
  'removeInsert',
  'applySuggestion',
  'resolveSuggestion',
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
  'addBroll',
  'addAudio',
  'removeClip',
  'moveClip',
  'trimClip',
  'setText',
  'setTransform',
  'setPicture',
  'addRedaction',
  'setCanvas',
  'setCaptionStyle',
  'setCaptionStyleAll',
  'setVolume',
  'setMuted',
  'setPan',
  'setAudioMaster',
  'setFade',
  'dissolveAtPlayhead',
  'importCaptions',
  'setSpeed',
  'setRangeVolume',
  'setSpeaker',
  'addSpeaker',
  'renameSpeaker',
  'removeSpeaker',
  'renameScene'
]

export type ToolDomain =
  | 'read_context'
  | 'timeline_edit'
  | 'review_suggestions'
  | 'annotations'
  | 'scene_structure'
  | 'transcript_content'
  | 'visible_graphics'
  | 'media_layers'
  | 'picture_effects'
  | 'audio_mix'
  | 'internal_orchestration'

export type ToolTimebase = 'none' | 'source' | 'program' | 'mixed'

export interface ToolContract {
  domain: ToolDomain
  access: 'read' | 'write'
  timebase: ToolTimebase
  assistant: boolean
}

export interface ToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  contract: ToolContract
}

type RawToolSpec = Omit<ToolSpec, 'contract'>

export interface ToolResult {
  project: Project
  message: string
  data?: unknown
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function sourceTime(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  const clean = String(value ?? '').trim().replace(/^~\s*/, '')
  if (!clean.includes(':')) return num(clean, fallback)
  const parts = clean.split(':').map((part) => Number(part))
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return fallback
  return parts.reduce((total, part) => total * 60 + part, 0)
}

function boundedTime(value: unknown, maximum: number): number | undefined {
  const parsed = sourceTime(value, Number.NaN)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(0, Math.min(maximum, parsed))
}

function boundedRange(
  args: Record<string, unknown>,
  maximum: number
): { start: number; end: number } | undefined {
  const start = boundedTime(args.start, maximum)
  const end = boundedTime(args.end, maximum)
  if (start == null || end == null || end <= start + 0.01) return undefined
  return { start, end }
}

function endsSentence(text: string): boolean {
  return /[.!?]["')\]]*$/.test(text.trim())
}

function sceneWords(project: Project, scene: Project['scenes'][number]) {
  return project.transcript.words.filter(
    (word) => !word.deleted && word.end > scene.start + 0.01 && word.start < scene.end - 0.01
  )
}

function sentenceBoundaries(project: Project, scene: Project['scenes'][number]): number[] {
  const words = sceneWords(project, scene)
  const boundaries: number[] = []
  for (let index = 1; index < words.length; index++) {
    const previous = words[index - 1]
    const word = words[index]
    const sentenceStart = endsSentence(previous.text) || word.start - previous.end > PARAGRAPH_GAP
    if (!sentenceStart) continue
    const before = words.slice(0, index).filter((item) => /[\p{L}\p{N}]/u.test(item.text))
    const after = words.slice(index).filter((item) => /[\p{L}\p{N}]/u.test(item.text))
    if (before.length < 2 || after.length < 2) continue
    if (word.start <= scene.start + 0.6 || word.start >= scene.end - 0.6) continue
    boundaries.push(word.start)
  }
  return boundaries
}

function derivedSceneCopy(project: Project, scene: Project['scenes'][number], start: number) {
  const sentence: string[] = []
  for (const word of sceneWords(project, scene).filter((item) => item.start >= start - 0.01)) {
    if (!/[\p{L}\p{N}]/u.test(word.text)) continue
    sentence.push(word.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’-]+$/gu, ''))
    if (endsSentence(word.text) || sentence.length >= 12) break
  }
  const clean = sentence.filter(Boolean)
  const summary = clean.join(' ').slice(0, 110)
  const titleWords = clean
    .filter((word, index) => index > 0 || !/^(so|and|but|then|well|okay|ok|um|uh)$/i.test(word))
    .slice(0, 5)
  const rawTitle = titleWords.join(' ').slice(0, 48) || 'New scene'
  return {
    title: rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1),
    summary
  }
}

function meaningfulSceneTitle(
  value: unknown,
  scene: Project['scenes'][number],
  derived: { title: string; summary: string }
): string {
  const title = String(value ?? '').trim()
  const vague =
    !title ||
    /^(scene|chapter|part|beat|demo|example|mini[- ]?scene)\s*\d*$/i.test(title) ||
    /\(cont\.?\)$/i.test(title) ||
    /^(like|this|that|it|here|there)\b/i.test(title)
  if (!vague) return title.slice(0, 64)
  const context = `${scene.title} ${scene.summary}`.toLowerCase()
  if (/filler/.test(context)) return 'Filler example'
  if (/dead air|silence|pause/.test(context)) return 'Dead air example'
  if (/import/.test(context)) return 'Import workflow'
  if (/pitch|thesis|promise/.test(context)) return 'Core promise'
  if (/close|call to action|cta/.test(context)) return 'Closing point'
  return /^(like|this|that|it|here|there)\b/i.test(derived.title)
    ? `${scene.title} example`.slice(0, 64)
    : derived.title
}

function phraseStartInScene(project: Project, scene: Project['scenes'][number], phrase: string): number | undefined {
  const tokens = phrase.toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) ?? []
  if (!tokens.length) return undefined
  const words = sceneWords(project, scene)
  const normalized = words.map((word) => (word.text.toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) ?? []).join(''))
  for (let index = 0; index <= normalized.length - tokens.length; index++) {
    if (tokens.every((token, offset) => normalized[index + offset] === token)) return words[index].start
  }
  return undefined
}

function transformPatch(value: unknown): Partial<Transform> {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const patch: Partial<Transform> = {}
  for (const key of ['x', 'y', 'rotation'] as const) {
    const value = Number(raw[key])
    if (Number.isFinite(value)) patch[key] = value
  }
  const scale = Number(raw.scale)
  if (Number.isFinite(scale)) patch.scale = Math.max(0.05, Math.min(10, scale))
  const opacity = Number(raw.opacity)
  if (Number.isFinite(opacity)) patch.opacity = Math.max(0, Math.min(1, opacity))
  if (raw.crop && typeof raw.crop === 'object') {
    const crop = raw.crop as Record<string, unknown>
    const values = ['x', 'y', 'w', 'h'].map((key) => Number(crop[key]))
    if (values.every(Number.isFinite)) patch.crop = { x: values[0], y: values[1], w: values[2], h: values[3] }
  }
  return patch
}

function captionStylePatch(value: unknown): Partial<CaptionStyle> {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const patch: Partial<CaptionStyle> = {}
  const fontSize = Number(raw.fontSize)
  if (Number.isFinite(fontSize)) patch.fontSize = Math.max(8, Math.min(240, fontSize))
  if (raw.align === 'left' || raw.align === 'center' || raw.align === 'right') patch.align = raw.align
  if (raw.position === 'lower' || raw.position === 'center' || raw.position === 'upper') patch.position = raw.position
  if (typeof raw.fill === 'string' && raw.fill.trim()) patch.fill = raw.fill.trim()
  if (typeof raw.stroke === 'string' && raw.stroke.trim()) patch.stroke = raw.stroke.trim()
  return patch
}

function audioMasterPatch(value: unknown): Partial<Project['audioMaster']> {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const patch: Partial<Project['audioMaster']> = {}
  const ranged = (key: 'volume' | 'fadeIn' | 'fadeOut' | 'eqLow' | 'eqMid' | 'eqHigh' | 'duck', min: number, max: number) => {
    const value = Number(raw[key])
    if (Number.isFinite(value)) patch[key] = Math.max(min, Math.min(max, value))
  }
  ranged('volume', 0, 2)
  ranged('fadeIn', 0, 30)
  ranged('fadeOut', 0, 30)
  ranged('eqLow', -24, 24)
  ranged('eqMid', -24, 24)
  ranged('eqHigh', -24, 24)
  ranged('duck', 0, 1)
  for (const key of ['muted', 'normalize', 'compress'] as const) {
    if (typeof raw[key] === 'boolean') patch[key] = raw[key]
  }
  return patch
}

const TOOL_DEFINITIONS: RawToolSpec[] = [
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
    description: 'Protect a source range (keep / silent demo / note). Hook and CTA become typed notes. Auto Edit skips keep and demo. Notes are comments.',
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
    name: 'split_scene',
    description:
      'SCENE STRUCTURE ONLY. Split one transcript scene/chapter at a natural sentence boundary and name the new section. Prefer beforeText (the opening words of the next sentence) over an approximate time. Approximate times are snapped to a valid sentence boundary; a scene with no internal sentence boundary is not split. Never creates on-screen titles, subtitles, captions, lower thirds, or graphics.',
    inputSchema: {
      type: 'object',
      properties: {
        sceneId: { type: 'string', description: 'Scene id or exact existing scene title from get_scenes.' },
        beforeText: { type: 'string', description: 'Recommended: exact opening words of the sentence that should begin the new scene.' },
        beforeWordId: { type: 'string', description: 'Alternative: id of the first word in the new scene.' },
        time: { type: ['number', 'string'], description: 'Fallback SOURCE time in seconds or MM:SS; it will snap to the nearest sentence boundary.' },
        title: { type: 'string', description: 'Required meaningful editorial heading for the new transcript scene; never visible on screen.' },
        summary: { type: 'string', description: 'Optional one-sentence editorial summary of the new scene.' }
      },
      required: ['title'],
      anyOf: [{ required: ['beforeText'] }, { required: ['beforeWordId'] }, { required: ['time'] }]
    }
  },
  {
    name: 'merge_scenes',
    description: 'Join two editorial transcript scenes/chapters. This never changes captions or graphics.',
    inputSchema: {
      type: 'object',
      properties: { sceneId: { type: 'string' }, otherId: { type: 'string' } },
      required: ['sceneId', 'otherId']
    }
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
    description: 'Rewrite one transcript word without cutting it. Auto captions that cover the word follow.',
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
    name: 'remove_speaker',
    description: 'Remove a speaker. Words they owned move to the first remaining speaker.',
    inputSchema: {
      type: 'object',
      properties: { speakerId: { type: 'string' } },
      required: ['speakerId']
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
    description:
      'Add explicit visible ON-SCREEN subtitle text. Only use when the user asks for subtitles, burned-in words, or visible text. Never use to split a transcript/caption into scenes or sections.',
    inputSchema: {
      type: 'object',
      properties: { start: { type: 'number' }, duration: { type: 'number' }, text: { type: 'string' } },
      required: ['start', 'text']
    }
  },
  {
    name: 'add_zoom',
    description: 'PICTURE EFFECT ONLY. Add a zoom overlay at PROGRAM time; never changes transcript scenes or text.',
    inputSchema: {
      type: 'object',
      properties: { start: { type: 'number' }, duration: { type: 'number' }, scale: { type: 'number' } },
      required: ['start']
    }
  },
  {
    name: 'add_broll_clip',
    description: 'MEDIA LAYER ONLY. Place an existing project video/image asset as B-roll at PROGRAM time. Does not change transcript, scene structure, or captions.',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: 'Existing asset id from get_snapshot.' },
        start: { type: ['number', 'string'], description: 'PROGRAM time.' },
        duration: { type: 'number', description: 'Positive seconds.' },
        inPoint: { type: 'number', description: 'Optional source in-point in the B-roll asset.' },
        muted: { type: 'boolean', default: true }
      },
      required: ['assetId', 'start', 'duration']
    }
  },
  {
    name: 'add_music_clip',
    description: 'MEDIA LAYER ONLY. Place an existing project audio asset as music at PROGRAM time with safe fade defaults. Does not alter voice transcript or scenes.',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: 'Existing audio asset id from get_snapshot.' },
        start: { type: ['number', 'string'], description: 'PROGRAM time.' },
        duration: { type: 'number' },
        inPoint: { type: 'number' },
        fadeIn: { type: 'number', default: 0.4 },
        fadeOut: { type: 'number', default: 0.4 }
      },
      required: ['assetId', 'start', 'duration']
    }
  },
  {
    name: 'move_timeline_clip',
    description: 'MEDIA LAYER ONLY. Move an existing non-primary timeline clip to a PROGRAM time and optionally another track.',
    inputSchema: { type: 'object', properties: { clipId: { type: 'string' }, start: { type: ['number', 'string'] }, trackId: { type: 'string' } }, required: ['clipId', 'start'] }
  },
  {
    name: 'trim_timeline_clip',
    description: 'MEDIA LAYER ONLY. Trim an existing timeline clip edge to a PROGRAM time.',
    inputSchema: { type: 'object', properties: { clipId: { type: 'string' }, edge: { type: 'string', enum: ['in', 'out'] }, time: { type: ['number', 'string'] } }, required: ['clipId', 'edge', 'time'] }
  },
  {
    name: 'remove_timeline_clip',
    description: 'MEDIA LAYER ONLY. Remove one overlay, graphic, B-roll, or extra-audio clip by id. Does not cut spoken source media.',
    inputSchema: { type: 'object', properties: { clipId: { type: 'string' } }, required: ['clipId'] }
  },
  {
    name: 'set_graphic_text',
    description: 'VISIBLE GRAPHICS ONLY. Rewrite the visible text on an existing title/caption/lower-third clip. Never rewrites transcript words or scene names.',
    inputSchema: { type: 'object', properties: { clipId: { type: 'string' }, text: { type: 'string' } }, required: ['clipId', 'text'] }
  },
  {
    name: 'set_caption_style',
    description: 'VISIBLE GRAPHICS ONLY. Style one existing caption/title clip. Does not change its text, timing, transcript, or scenes.',
    inputSchema: { type: 'object', properties: { clipId: { type: 'string' }, style: { type: 'object', description: 'CaptionStyle patch: fontSize, color, background, position, align, fontFamily, weight, italic.' } }, required: ['clipId', 'style'] }
  },
  {
    name: 'set_all_caption_styles',
    description: 'VISIBLE GRAPHICS ONLY. Apply a CaptionStyle patch to every caption clip.',
    inputSchema: { type: 'object', properties: { style: { type: 'object' } }, required: ['style'] }
  },
  {
    name: 'set_visual_clip_transform',
    description: 'PICTURE EFFECT ONLY. Change position, scale, rotation, or opacity of one visual clip without changing its timing or text.',
    inputSchema: { type: 'object', properties: { clipId: { type: 'string' }, transform: { type: 'object', description: 'Transform patch: x, y, scale, rotation, opacity.' } }, required: ['clipId', 'transform'] }
  },
  {
    name: 'set_project_picture_transform',
    description: 'PICTURE EFFECT ONLY. Change the master picture crop/position/scale/rotation/opacity.',
    inputSchema: { type: 'object', properties: { transform: { type: 'object' } }, required: ['transform'] }
  },
  {
    name: 'add_blur_redaction',
    description: 'PICTURE EFFECT ONLY. Add a visible blur/redaction overlay at PROGRAM time.',
    inputSchema: { type: 'object', properties: { start: { type: ['number', 'string'] }, duration: { type: 'number', default: 4 } }, required: ['start'] }
  },
  {
    name: 'set_canvas_size',
    description: 'PICTURE EFFECT ONLY. Set output canvas pixels, e.g. 1920x1080 landscape, 1080x1920 vertical, or 1080x1080 square.',
    inputSchema: { type: 'object', properties: { width: { type: 'integer', minimum: 240, maximum: 7680 }, height: { type: 'integer', minimum: 240, maximum: 7680 } }, required: ['width', 'height'] }
  },
  {
    name: 'set_clip_volume',
    description: 'AUDIO MIX ONLY. Set one audio/media clip volume from 0 (mute) to 2 (200%). Does not change transcript or picture.',
    inputSchema: { type: 'object', properties: { clipId: { type: 'string' }, volume: { type: 'number', minimum: 0, maximum: 2 } }, required: ['clipId', 'volume'] }
  },
  {
    name: 'set_clip_muted',
    description: 'AUDIO MIX ONLY. Mute or unmute one timeline clip.',
    inputSchema: { type: 'object', properties: { clipId: { type: 'string' }, muted: { type: 'boolean' } }, required: ['clipId', 'muted'] }
  },
  {
    name: 'set_clip_pan',
    description: 'AUDIO MIX ONLY. Set stereo pan for one audio clip from -1 (left) to 1 (right).',
    inputSchema: { type: 'object', properties: { clipId: { type: 'string' }, pan: { type: 'number', minimum: -1, maximum: 1 } }, required: ['clipId', 'pan'] }
  },
  {
    name: 'set_audio_fade',
    description: 'AUDIO MIX ONLY. Set fade-in or fade-out duration on an audio/voice target clip.',
    inputSchema: { type: 'object', properties: { clipId: { type: 'string' }, edge: { type: 'string', enum: ['in', 'out'] }, duration: { type: 'number', minimum: 0, maximum: 30 } }, required: ['clipId', 'edge', 'duration'] }
  },
  {
    name: 'set_audio_master',
    description: 'AUDIO MIX ONLY. Patch master normalization, EQ, compressor, gain, or limiter settings without changing clip timing.',
    inputSchema: { type: 'object', properties: { patch: { type: 'object' } }, required: ['patch'] }
  },
  {
    name: 'add_dissolve',
    description: 'TIMELINE EDIT ONLY. Add a cross-dissolve centered at a PROGRAM time; does not change transcript or scene structure.',
    inputSchema: { type: 'object', properties: { time: { type: ['number', 'string'] }, duration: { type: 'number', default: 0.4 } }, required: ['time'] }
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
    description: 'Add visible ON-SCREEN lower-third graphics for existing scene titles. Never use to split or organize transcript scenes.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'add_title',
    description:
      'Add one explicit visible ON-SCREEN title card/graphic. Only use when the user asks for a title card or visible graphic. Never use to split a caption, transcript, chapter, or scene into sections.',
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

const TOOLS_BY_DOMAIN: Record<ToolDomain, readonly string[]> = {
  read_context: [
    'get_context', 'get_transcript', 'search_transcript', 'get_timeline', 'get_suggestions',
    'get_tags', 'get_scenes', 'get_program', 'get_snapshot', 'get_cuts', 'get_selection',
    'list_commands', 'get_mapping'
  ],
  timeline_edit: [
    'delete_range', 'cut_range', 'toggle_words', 'restore_range', 'cut_words', 'restore_words',
    'cut_sentence', 'cut_previous_sentence', 'tighten', 'ripple_delete_marks', 'lift_marks',
    'insert_gap', 'revert_at', 'set_marks', 'split_at', 'ripple_delete', 'set_speed', 'add_dissolve'
  ],
  review_suggestions: [
    'apply_safe_edits', 'apply_safe_suggestions', 'dismiss_suggestion', 'apply_suggestion',
    'revert_suggestion', 'revert_suggestion_type', 'rebuild_suggestions', 'apply_model_suggestions'
  ],
  annotations: ['add_tag', 'erase_tag', 'remove_tag'],
  scene_structure: [
    'split_scene', 'merge_scenes', 'rename_scene', 'rebuild_intelligence', 'infer_scenes',
    'collapse_retakes', 'keep_take', 'set_scenes', 'run_intelligence'
  ],
  transcript_content: [
    'set_word_text', 'set_speaker', 'add_speaker', 'rename_speaker', 'remove_speaker',
    'set_transcript', 'apply_diarization'
  ],
  visible_graphics: [
    'add_caption', 'generate_captions', 'add_lower_thirds', 'add_title',
    'import_captions', 'set_graphic_text', 'set_caption_style', 'set_all_caption_styles'
  ],
  media_layers: [
    'add_broll_clip', 'add_music_clip', 'move_timeline_clip', 'trim_timeline_clip',
    'remove_timeline_clip'
  ],
  picture_effects: [
    'add_zoom', 'set_visual_clip_transform', 'set_project_picture_transform',
    'add_blur_redaction', 'set_canvas_size'
  ],
  audio_mix: [
    'set_range_volume', 'set_clip_volume', 'set_clip_muted', 'set_clip_pan',
    'set_audio_fade', 'set_audio_master'
  ],
  internal_orchestration: ['apply_command', 'edit_with_intent']
}

const ASSISTANT_HIDDEN = new Set([
  'list_commands',
  'apply_command',
  'cut_range',
  'apply_safe_suggestions',
  'ripple_delete',
  'set_scenes',
  'edit_with_intent',
  'set_transcript',
  'apply_diarization',
  'import_captions'
])

const SOURCE_TIME_TOOLS = new Set([
  'delete_range', 'cut_range', 'restore_range', 'tighten', 'revert_at', 'add_tag', 'erase_tag',
  'split_at', 'split_scene', 'ripple_delete', 'set_speed', 'set_range_volume'
])
const PROGRAM_TIME_TOOLS = new Set([
  'set_marks', 'ripple_delete_marks', 'lift_marks', 'insert_gap', 'add_caption', 'add_zoom', 'add_title',
  'add_broll_clip', 'add_music_clip', 'move_timeline_clip', 'trim_timeline_clip',
  'add_blur_redaction', 'add_dissolve'
])
const MIXED_TIME_TOOLS = new Set(['get_context', 'get_timeline', 'get_snapshot', 'get_cuts', 'get_selection', 'get_mapping'])

function contractFor(name: string): ToolContract {
  const domain = (Object.entries(TOOLS_BY_DOMAIN) as [ToolDomain, readonly string[]][])
    .find(([, names]) => names.includes(name))?.[0]
  if (!domain) throw new Error(`Tool ${name} has no content-domain contract.`)
  const timebase: ToolTimebase = SOURCE_TIME_TOOLS.has(name)
    ? 'source'
    : PROGRAM_TIME_TOOLS.has(name)
      ? 'program'
      : MIXED_TIME_TOOLS.has(name)
        ? 'mixed'
        : 'none'
  return {
    domain,
    access: domain === 'read_context' ? 'read' : 'write',
    timebase,
    assistant: !ASSISTANT_HIDDEN.has(name)
  }
}

export const MCP_TOOLS: ToolSpec[] = TOOL_DEFINITIONS.map((tool) => ({
  ...tool,
  contract: contractFor(tool.name)
}))

export function assistantToolsForIntent(intent: string, priorToolNames: string[] = []): ToolSpec[] {
  const text = intent.toLowerCase()
  const domains = new Set<ToolDomain>()
  const structural = /\b(split|divide|organize|restructure|group|merge|rename|find)\b[^.!?]{0,50}\b(scene|scenes|chapter|chapters|beat|beats|retake|retakes|transcript|caption)\b|\bmini[- ]?scenes?\b/.test(text)
  if (structural) domains.add('scene_structure')
  if (/\b(title card|on[- ]?screen|subtitle|subtitles|lower third|lower thirds|graphic|graphics|burned[- ]?in caption|visible caption)\b/.test(text) || /\b(add|create|generate|show|style|rewrite)\b[^.!?]{0,30}\b(title|captions?)\b/.test(text)) {
    domains.add('visible_graphics')
  }
  if (/\b(b[- ]?roll|music|media layer|overlay clip|move (the )?clip|trim (the )?clip|remove (the )?clip)\b/.test(text)) domains.add('media_layers')
  if (/\b(zoom|crop|position|scale|rotation|opacity|blur|redact|redaction|canvas|aspect ratio|vertical|square|picture transform)\b/.test(text)) domains.add('picture_effects')
  if (/\b(volume|loud|quiet|audio|sound|mix|mute|duck)\b/.test(text)) domains.add('audio_mix')
  if (/\b(speaker|rename speaker|transcript text|rewrite|spelling|correct (the )?word|change (the )?word)\b/.test(text)) domains.add('transcript_content')
  if (/\b(cut|remove|delete|restore|put back|tighten|pause|silence|filler|speed|ripple|lift|mark in|mark out|razor)\b/.test(text)) domains.add('timeline_edit')
  if (/\b(suggestion|safe edit|review issue|apply safe|dismiss|revert suggestion)\b/.test(text)) domains.add('review_suggestions')
  if (/\b(protect|tag|note|silent demo|keep range|annotation)\b/.test(text)) domains.add('annotations')

  if (!domains.size) {
    for (const name of priorToolNames) {
      const tool = MCP_TOOLS.find((candidate) => candidate.name === name)
      if (tool && tool.contract.domain !== 'read_context') domains.add(tool.contract.domain)
    }
  }

  return MCP_TOOLS.filter((tool) => {
    if (!tool.contract.assistant) return false
    if (tool.contract.domain === 'read_context') return true
    return !domains.size || domains.has(tool.contract.domain)
  })
}

export async function runTool(
  project: Project,
  name: string,
  args: Record<string, unknown>,
  intel?: ModelEndpoint,
  session: EditorSession = EMPTY_SESSION,
  complete?: IntelligenceComplete
): Promise<ToolResult> {
  const apply = (command: Command, message: string): ToolResult => {
    const next = applyCommand(project, command)
    return {
      project: next,
      message: next === project ? `No change — ${message}` : message,
      data: { changed: next !== project, command: command.type }
    }
  }
  const noChange = (message: string): ToolResult => ({
    project,
    message: `No change — ${message}`,
    data: { changed: false }
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
    case 'cut_range': {
      const range = boundedRange(args, project.sourceDuration)
      if (!range) return noChange('provide a valid SOURCE start and end with end after start.')
      return apply(
        {
          type: 'deleteRange',
          ...range,
          lift: Boolean(args.lift),
          source: args.source === 'transcript' || args.source === 'repeat' || args.source === 'silence' || args.source === 'filler'
            ? args.source
            : 'model'
        },
        args.lift ? 'Lifted range.' : 'Cut range.'
      )
    }
    case 'toggle_words': {
      const wordIds = Array.isArray(args.wordIds) ? args.wordIds.map(String) : []
      if (!wordIds.length) return { project, message: 'No word ids.' }
      return apply({ type: 'toggleWords', wordIds }, `Toggled ${wordIds.length} words.`)
    }
    case 'restore_range': {
      const range = boundedRange(args, project.sourceDuration)
      return range ? apply({ type: 'restoreRange', ...range }, 'Restored range.') : noChange('provide a valid SOURCE start and end.')
    }
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
      return apply({ type: 'cutSentence', wordId: String(args.wordId) }, 'Cut this sentence — saved the time. Hear the join.')
    case 'cut_previous_sentence':
      return apply({ type: 'cutPreviousSentence', wordId: String(args.wordId) }, 'Cut previous sentence.')
    case 'tighten': {
      const range = boundedRange(args, project.sourceDuration)
      return range ? apply({ type: 'tightenRange', ...range }, 'Tightened gaps.') : noChange('provide a valid SOURCE start and end.')
    }
    case 'apply_safe_edits':
    case 'apply_safe_suggestions':
      return apply({ type: 'applySafeSuggestions' }, 'Applied safe edits.')
    case 'dismiss_suggestion':
      return apply({ type: 'dismissSuggestion', suggestionId: String(args.suggestionId) }, 'Dismissed suggestion.')
    case 'ripple_delete_marks':
      return apply({ type: 'rippleDeleteMarks' }, 'Cut the marked range.')
    case 'lift_marks':
      return apply({ type: 'liftMarks' }, 'Lifted the marked range.')
    case 'insert_gap': {
      const time = boundedTime(args.time, programLength(project))
      const duration = sourceTime(args.duration, 1)
      if (time == null || !Number.isFinite(duration) || duration <= 0) return noChange('provide a valid PROGRAM time and positive duration.')
      return apply({ type: 'insertGap', time, duration }, 'Inserted a hold.')
    }
    case 'apply_suggestion':
      return apply({ type: 'applySuggestion', suggestionId: String(args.suggestionId) }, 'Applied suggestion.')
    case 'revert_suggestion':
      return apply({ type: 'revertSuggestion', suggestionId: String(args.suggestionId) }, 'Reverted suggestion.')
    case 'revert_suggestion_type':
      return apply(
        { type: 'revertSuggestionType', suggestionType: String(args.type) as SuggestionType },
        `Reverted ${args.type}.`
      )
    case 'revert_at': {
      const range = boundedRange(args, project.sourceDuration)
      return range ? apply({ type: 'revertAt', ...range }, 'Reverted span.') : noChange('provide a valid SOURCE start and end.')
    }
    case 'add_tag': {
      const range = boundedRange(args, project.sourceDuration)
      if (!range) return noChange('provide a valid SOURCE start and end for the annotation.')
      const asked = String(args.kind)
      const kind: TagKind = asked === 'hook' || asked === 'cta' ? 'note' : (asked as TagKind)
      const label =
        args.label != null
          ? String(args.label)
          : asked === 'hook'
            ? 'hook'
            : asked === 'cta'
              ? 'ask'
              : undefined
      return apply(
        {
          type: 'addTag',
          ...range,
          kind,
          label
        },
        kind === 'note' ? 'Note on the tape. Type what it is for.' : `Tagged ${kind}.`
      )
    }
    case 'erase_tag': {
      const range = boundedRange(args, project.sourceDuration)
      if (!range) return noChange('provide a valid SOURCE start and end for the annotation.')
      return apply(
        {
          type: 'eraseTag',
          ...range,
          kind: args.kind ? (String(args.kind) as TagKind) : undefined
        },
        'Erased tag paint.'
      )
    }
    case 'remove_tag':
      return apply({ type: 'removeTag', tagId: String(args.tagId) }, 'Removed tag.')
    case 'set_marks': {
      const maximum = programLength(project)
      const markIn = args.markIn == null ? undefined : boundedTime(args.markIn, maximum)
      const markOut = args.markOut == null ? undefined : boundedTime(args.markOut, maximum)
      if (args.markIn != null && markIn == null || args.markOut != null && markOut == null) return noChange('marks use valid PROGRAM times.')
      if (markIn != null && markOut != null && markOut <= markIn) return noChange('Mark Out must be after Mark In.')
      return apply(
        {
          type: 'setMarks',
          markIn,
          markOut
        },
        'Set marks.'
      )
    }
    case 'split_at': {
      const time = boundedTime(args.time, project.sourceDuration)
      return time == null ? noChange('provide a valid SOURCE time.') : apply({ type: 'splitAt', time }, 'Split.')
    }
    case 'split_scene': {
      const scenes = project.scenes ?? []
      const requestedScene = String(args.sceneId ?? args.scene ?? '').trim().toLowerCase()
      const named = requestedScene
        ? scenes.find((item) => item.id.toLowerCase() === requestedScene || item.title.toLowerCase() === requestedScene)
        : undefined
      const beforeWord = args.beforeWordId == null
        ? undefined
        : project.transcript.words.find((word) => word.id === String(args.beforeWordId) && !word.deleted)
      const phrase = String(args.beforeText ?? '').trim()
      const globalPhraseWord = phrase ? wordsMatchingPhrase(project.transcript.words, phrase).find((word) => !word.deleted) : undefined
      const rawRequested = beforeWord?.start ?? globalPhraseWord?.start ?? sourceTime(args.time ?? args.sourceTime ?? args.source_time, Number.NaN)
      let scene = named ?? scenes.find((item) => Number.isFinite(rawRequested) && rawRequested > item.start && rawRequested < item.end)
      let requested = named && phrase
        ? phraseStartInScene(project, named, phrase) ?? rawRequested
        : rawRequested
      if (!scene) {
        const nearest = scenes
          .flatMap((item) => sentenceBoundaries(project, item)
            .map((time) => ({ scene: item, distance: Math.abs(time - requested) })))
          .sort((a, b) => a.distance - b.distance)[0]
        if (nearest && nearest.distance <= 5) scene = nearest.scene
      }
      if (!scene) return { project, message: 'No matching transcript scene was found. Read get_scenes and retry with sceneId plus beforeText.' }
      const boundaries = sentenceBoundaries(project, scene)
      if (!boundaries.length) {
        return { project, message: `No change — “${scene.title}” contains no safe internal sentence boundary. It was not split mid-sentence.` }
      }
      if (!Number.isFinite(requested)) requested = (scene.start + scene.end) / 2
      const time = boundaries.reduce((best, candidate) =>
        Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best)
      const derived = derivedSceneCopy(project, scene, time)
      const title = meaningfulSceneTitle(args.title, scene, derived)
      const summary = String(args.summary ?? '').trim().slice(0, 160) || derived.summary
      return apply(
        {
          type: 'splitScene',
          sceneId: scene.id,
          time,
          title,
          summary
        },
        `Split “${scene.title}” at a sentence boundary into “${title}” (${time.toFixed(2)}s source).`
      )
    }
    case 'merge_scenes':
      return apply(
        {
          type: 'mergeScenes',
          sceneId: String(args.sceneId ?? ''),
          otherId: String(args.otherId ?? '')
        },
        'Joined transcript scenes.'
      )
    case 'ripple_delete': {
      const range = boundedRange(args, project.sourceDuration)
      return range ? apply({ type: 'rippleDelete', ...range }, 'Ripple deleted.') : noChange('provide a valid SOURCE start and end.')
    }
    case 'set_word_text': {
      const command = { type: 'setWordText' as const, wordId: String(args.wordId), text: String(args.text) }
      const next = applyCommand(project, command)
      return next === project
        ? noChange('the transcript word id or replacement text was invalid.')
        : { project: next, message: toastForCaptionFollow(project, next) ?? 'Rewrote word.', data: { changed: true, command: command.type } }
    }
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
    case 'remove_speaker':
      return apply({ type: 'removeSpeaker', speakerId: String(args.speakerId) }, 'Removed speaker.')
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
      const turn = await runAgent(project, String(args.intent ?? ''), session, intel, complete)
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
      return apply({ type: 'addLowerThirds' }, 'Type this name — Enter keeps it and opens the next. Fill is on the tape.')
    case 'add_title': {
      const start = boundedTime(args.start, programLength(project))
      const duration = sourceTime(args.duration, 3)
      const text = String(args.text ?? '').trim()
      if (start == null || duration <= 0 || !text) return noChange('a visible title needs PROGRAM start, positive duration, and text.')
      return apply(
        {
          type: 'addTitle',
          start,
          duration,
          text,
          preset: args.preset ? (String(args.preset) as TitlePreset) : 'title'
        },
        'Added title.'
      )
    }
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
        args.intent ? String(args.intent) : undefined,
        complete
      )
      const next = applyCommand(project, {
        type: 'mergeIntelligence',
        scenes: draft.scenes,
        suggestions: draft.suggestions
      })
      return {
        project: next,
        message: next === project ? `No change — ${draft.notes || 'the intelligence pass proposed nothing new.'}` : draft.notes || 'Proposed scenes and cuts.',
        data: { ...draft, changed: next !== project }
      }
    }
    case 'apply_model_suggestions':
      return apply({ type: 'applyModelSuggestions' }, 'Applied model cuts.')
    case 'set_speed': {
      const range = boundedRange(args, project.sourceDuration)
      const speed = num(args.speed, Number.NaN)
      if (!range || !Number.isFinite(speed) || speed < 0.25 || speed > 16) return noChange('use a valid SOURCE range and speed from 0.25× to 16×.')
      return apply({ type: 'setSpeed', ...range, speed }, 'Set speed.')
    }
    case 'set_range_volume': {
      const range = boundedRange(args, project.sourceDuration)
      const volume = num(args.volume, Number.NaN)
      if (!range || !Number.isFinite(volume) || volume < 0 || volume > 2) return noChange('use a valid SOURCE range and volume from 0 (mute) to 2 (200%).')
      return apply(
        {
          type: 'setRangeVolume',
          ...range,
          volume
        },
        'Set range volume.'
      )
    }
    case 'add_caption': {
      const start = boundedTime(args.start, programLength(project))
      const duration = sourceTime(args.duration, 3)
      const text = String(args.text ?? '').trim()
      if (start == null || duration <= 0 || !text) return noChange('a visible caption needs PROGRAM start, positive duration, and text.')
      return apply(
        {
          type: 'addCaption',
          start,
          duration,
          text
        },
        'Added caption.'
      )
    }
    case 'add_zoom': {
      const start = boundedTime(args.start, programLength(project))
      const duration = sourceTime(args.duration, 3)
      const scale = num(args.scale, 1.45)
      if (start == null || duration <= 0 || scale < 1 || scale > 4) return noChange('a zoom needs PROGRAM start, positive duration, and scale from 1× to 4×.')
      return apply(
        {
          type: 'addZoom',
          start,
          duration,
          scale
        },
        'Added zoom.'
      )
    }
    case 'add_broll_clip': {
      const asset = project.assets[String(args.assetId ?? '')]
      const start = boundedTime(args.start, programLength(project))
      const requestedDuration = sourceTime(args.duration, Number.NaN)
      const inPoint = Math.max(0, sourceTime(args.inPoint, 0))
      if (!asset || asset.kind === 'audio') return noChange('choose an existing video or image assetId from get_snapshot.')
      if (start == null || !Number.isFinite(requestedDuration) || requestedDuration <= 0) return noChange('provide a valid PROGRAM start and positive duration.')
      const available = asset.duration > 0 ? Math.max(0.05, asset.duration - inPoint) : requestedDuration
      return apply({
        type: 'addBroll',
        asset,
        start,
        duration: Math.min(requestedDuration, available),
        inPoint,
        muted: args.muted == null ? true : Boolean(args.muted)
      }, `Added B-roll “${asset.name}”.`)
    }
    case 'add_music_clip': {
      const asset = project.assets[String(args.assetId ?? '')]
      const start = boundedTime(args.start, programLength(project))
      const requestedDuration = sourceTime(args.duration, Number.NaN)
      const inPoint = Math.max(0, sourceTime(args.inPoint, 0))
      if (!asset || asset.kind !== 'audio') return noChange('choose an existing audio assetId from get_snapshot.')
      if (start == null || !Number.isFinite(requestedDuration) || requestedDuration <= 0) return noChange('provide a valid PROGRAM start and positive duration.')
      const duration = Math.min(requestedDuration, Math.max(0.05, asset.duration - inPoint))
      const fadeIn = Math.min(duration / 2, Math.max(0, sourceTime(args.fadeIn, 0.4)))
      const fadeOut = Math.min(duration / 2, Math.max(0, sourceTime(args.fadeOut, 0.4)))
      return apply({ type: 'addAudio', asset, start, duration, inPoint, fadeIn, fadeOut }, `Added music “${asset.name}”.`)
    }
    case 'move_timeline_clip': {
      const start = boundedTime(args.start, programLength(project))
      if (start == null) return noChange('provide a clip id and valid PROGRAM start.')
      return apply({ type: 'moveClip', clipId: String(args.clipId ?? ''), start, trackId: args.trackId ? String(args.trackId) : undefined }, 'Moved timeline clip.')
    }
    case 'trim_timeline_clip': {
      const time = boundedTime(args.time, programLength(project))
      const edge = args.edge === 'in' || args.edge === 'out' ? args.edge : undefined
      if (time == null || !edge) return noChange('provide clipId, edge in/out, and a valid PROGRAM time.')
      return apply({ type: 'trimClip', clipId: String(args.clipId ?? ''), edge, time }, 'Trimmed timeline clip.')
    }
    case 'remove_timeline_clip':
      return apply({ type: 'removeClip', clipId: String(args.clipId ?? '') }, 'Removed timeline clip.')
    case 'set_graphic_text': {
      const text = String(args.text ?? '').trim()
      if (!text) return noChange('visible graphic text cannot be empty.')
      return apply({ type: 'setText', clipId: String(args.clipId ?? ''), text }, 'Updated visible graphic text.')
    }
    case 'set_caption_style': {
      const style = captionStylePatch(args.style)
      if (!Object.keys(style).length) return noChange('provide at least one valid CaptionStyle field.')
      return apply({ type: 'setCaptionStyle', clipId: String(args.clipId ?? ''), style }, 'Styled one visible caption.')
    }
    case 'set_all_caption_styles': {
      const style = captionStylePatch(args.style)
      if (!Object.keys(style).length) return noChange('provide at least one valid CaptionStyle field.')
      return apply({ type: 'setCaptionStyleAll', style }, 'Styled all visible captions.')
    }
    case 'set_visual_clip_transform': {
      const transform = transformPatch(args.transform)
      if (!Object.keys(transform).length) return noChange('provide at least one valid transform field.')
      return apply({ type: 'setTransform', clipId: String(args.clipId ?? ''), transform }, 'Updated visual clip transform.')
    }
    case 'set_project_picture_transform': {
      const transform = transformPatch(args.transform)
      if (!Object.keys(transform).length) return noChange('provide at least one valid transform field.')
      return apply({ type: 'setPicture', transform }, 'Updated master picture transform.')
    }
    case 'add_blur_redaction': {
      const start = boundedTime(args.start, programLength(project))
      const duration = sourceTime(args.duration, 4)
      if (start == null || duration <= 0) return noChange('provide a valid PROGRAM start and positive duration.')
      return apply({ type: 'addRedaction', start, duration }, 'Added blur redaction.')
    }
    case 'set_canvas_size': {
      const width = Math.round(num(args.width, Number.NaN))
      const height = Math.round(num(args.height, Number.NaN))
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 240 || height < 240 || width > 7680 || height > 7680) return noChange('canvas width and height must be 240–7680 pixels.')
      return apply({ type: 'setCanvas', width, height }, `Set canvas to ${width}×${height}.`)
    }
    case 'set_clip_volume': {
      const volume = num(args.volume, Number.NaN)
      if (!Number.isFinite(volume) || volume < 0 || volume > 2) return noChange('clip volume must be 0–2.')
      return apply({ type: 'setVolume', clipId: String(args.clipId ?? ''), volume }, 'Set clip volume.')
    }
    case 'set_clip_muted':
      if (typeof args.muted !== 'boolean') return noChange('muted must be true or false.')
      return apply({ type: 'setMuted', clipId: String(args.clipId ?? ''), muted: args.muted }, args.muted ? 'Muted clip.' : 'Unmuted clip.')
    case 'set_clip_pan': {
      const pan = num(args.pan, Number.NaN)
      if (!Number.isFinite(pan) || pan < -1 || pan > 1) return noChange('clip pan must be -1 to 1.')
      return apply({ type: 'setPan', clipId: String(args.clipId ?? ''), pan }, 'Set clip pan.')
    }
    case 'set_audio_fade': {
      const edge = args.edge === 'in' || args.edge === 'out' ? args.edge : undefined
      const duration = num(args.duration, Number.NaN)
      if (!edge || !Number.isFinite(duration) || duration < 0 || duration > 30) return noChange('choose fade edge in/out and duration 0–30 seconds.')
      return apply({ type: 'setFade', targetId: String(args.clipId ?? ''), edge, duration }, `Set fade ${edge}.`)
    }
    case 'set_audio_master': {
      const patch = audioMasterPatch(args.patch)
      if (!Object.keys(patch).length) return noChange('provide at least one valid master-audio field.')
      return apply({ type: 'setAudioMaster', patch }, 'Updated master audio.')
    }
    case 'add_dissolve': {
      const time = boundedTime(args.time, programLength(project))
      const duration = num(args.duration, 0.4)
      if (time == null || !Number.isFinite(duration) || duration <= 0) return noChange('provide a valid PROGRAM time and positive duration.')
      return apply({ type: 'dissolveAtPlayhead', time, duration }, 'Added cross-dissolve.')
    }
    case 'get_mapping': {
      if (args.source == null && args.program == null) return noChange('provide either a SOURCE time or PROGRAM time.')
      const sourceInput = args.source == null ? undefined : boundedTime(args.source, project.sourceDuration)
      const programInput = args.program == null ? undefined : boundedTime(args.program, programLength(project))
      if (args.source != null && sourceInput == null || args.program != null && programInput == null) return noChange('provide a valid SOURCE or PROGRAM time.')
      const source = sourceInput ?? programToSourceOf(project, programInput ?? 0)
      const program = programInput ?? sourceToProgramOf(project, source)
      return { project, message: `source ${source.toFixed(3)} ↔ program ${program.toFixed(3)}`, data: { source, program } }
    }
    default:
      return { project, message: `Unknown tool ${name}` }
  }
}
