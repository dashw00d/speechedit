export interface TranscriptCue {
  text: string
  start: number
  end: number
  speaker?: string
}

export interface SpeakerAssignment {
  start: number
  end: number
  speaker: string
}

const SPEAKER_KEYS = ['speaker', 'speaker_id', 'speaker_label', 'spk', 'speakerLabel'] as const

export function speakerLabel(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  for (const key of SPEAKER_KEYS) {
    const value = rec[key]
    if (value == null || value === '') continue
    const label = String(value).trim()
    if (label) return label
  }
  return undefined
}

export function prettySpeakerName(label: string): string {
  const numbered = label.match(/^SPEAKER[_-]?(\d+)$/i)
  if (numbered) return `Speaker ${Number(numbered[1])}`
  return label
}

export function speakerSlug(label: string): string {
  const numbered = label.match(/^SPEAKER[_-]?(\d+)$/i)
  if (numbered) return `spk_${numbered[1]}`
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return slug || 'spk'
}

export function splitVoiceTag(text: string): { speaker?: string; text: string } {
  const vtt = text.match(/^<v\s+([^>]+)>\s*(.*)$/i)
  if (vtt) return { speaker: vtt[1].trim(), text: vtt[2].trim() }
  const prefixed = text.match(/^([A-Z][A-Za-z0-9 _.-]{0,40}):\s+(.+)$/)
  if (prefixed) return { speaker: prefixed[1].trim(), text: prefixed[2].trim() }
  return { text }
}

function asWordCue(item: unknown, fallbackSpeaker?: string): TranscriptCue | null {
  if (!item || typeof item !== 'object') return null
  const rec = item as Record<string, unknown>
  const text = String(rec.word ?? rec.text ?? '').trim()
  if (!text) return null
  const start = Number(rec.start ?? rec.begin ?? 0)
  const end = Number(rec.end ?? rec.finish ?? start + 0.2)
  return {
    text,
    start,
    end,
    speaker: speakerLabel(rec) ?? fallbackSpeaker
  }
}

/** Whisper / WhisperX / Speaches / Groq verbose_json, including optional diarization. */
export function cuesFromTranscriptJson(raw: unknown): TranscriptCue[] {
  if (!raw || typeof raw !== 'object') return []
  const data = raw as {
    words?: unknown[]
    segments?: Array<{
      text?: string
      start?: number
      end?: number
      speaker?: string
      words?: unknown[]
    }>
  }
  if (data.words?.length) {
    return data.words.map((item) => asWordCue(item)).filter((c): c is TranscriptCue => Boolean(c))
  }
  const out: TranscriptCue[] = []
  for (const seg of data.segments ?? []) {
    const speaker = speakerLabel(seg)
    if (seg.words?.length) {
      for (const word of seg.words) {
        const cue = asWordCue(word, speaker)
        if (cue) out.push(cue)
      }
      continue
    }
    const text = String(seg.text ?? '').trim()
    if (!text) continue
    out.push({
      text,
      start: Number(seg.start ?? 0),
      end: Number(seg.end ?? Number(seg.start ?? 0) + 0.4),
      speaker
    })
  }
  return out
}

export function assignmentsFromCues(cues: TranscriptCue[]): SpeakerAssignment[] {
  return cues
    .filter((cue) => cue.speaker)
    .map((cue) => ({ start: cue.start, end: cue.end, speaker: cue.speaker as string }))
}

export function hasProviderSpeakers(cues: TranscriptCue[]): boolean {
  const labels = new Set(cues.map((c) => c.speaker).filter(Boolean))
  return labels.size > 0
}
