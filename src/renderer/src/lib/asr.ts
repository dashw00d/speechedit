import type { Word } from '../types'
import {
  expandAsrCues,
  looksWordLevel,
  parseAsrPayload,
  type AsrCue,
  type AsrResult
} from '../../../shared/asr'
import { withPlayableWordDurations } from './edl'
import { uid } from './time'

export {
  TRANSCRIPT_PROVIDERS,
  coerceTranscriptKind,
  expandAsrCues,
  extractJsonBlob,
  looksWordLevel,
  parseAsrPayload,
  presetIdFor,
  transcriptionsUrl,
  type AsrCue,
  type AsrResult,
  type TranscriptKind
} from '../../../shared/asr'

export function wordsFromCues(
  cues: AsrCue[],
  opts?: { wordLevel?: boolean; speaker?: string }
): Word[] {
  const speaker = opts?.speaker ?? 'ryan'
  return withPlayableWordDurations(
    expandAsrCues(cues, opts?.wordLevel).map((c) => ({
      id: uid('w'),
      text: c.text,
      start: c.start,
      end: c.end,
      speaker: c.speaker || speaker,
      deleted: false
    }))
  )
}

export function wordsFromAsr(
  raw: AsrCue[] | AsrResult | null | undefined,
  speaker = 'ryan'
): Word[] {
  if (!raw) return []
  if (Array.isArray(raw)) return wordsFromCues(raw, { speaker })
  return wordsFromCues(raw.cues, { wordLevel: raw.wordLevel, speaker })
}
