import {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_TRANSFORM,
  emptyClipFields,
  type CaptionStyle,
  type Clip,
  type Project,
  type TitlePreset,
  type Word
} from '../types'
import { sourceToProgramOf } from './resolver'
import { uid } from './time'
import { prettySpeakerName, splitVoiceTag } from './diarize'
import { transcriptIsPlaceholder } from './transcript'
import { revealStackTrack } from './timelineTracks'

export interface CaptionBuildOptions {
  maxWords?: number
  speakerPrefix?: boolean
  emphasize?: boolean
  gap?: number
}

export const TITLE_PRESETS: Record<TitlePreset, CaptionStyle> = {
  title: { ...DEFAULT_CAPTION_STYLE, fontSize: 64, align: 'center', position: 'center' },
  'lower-third': { ...DEFAULT_CAPTION_STYLE, fontSize: 28, align: 'left', position: 'lower' },
  chapter: { ...DEFAULT_CAPTION_STYLE, fontSize: 34, align: 'left', position: 'upper' }
}

export function emphasizeToken(text: string): string {
  const core = text.replace(/[.,!?]+$/g, '')
  if (/^\d+(\.\d+)?$/.test(core)) return `**${text}**`
  if (/^[A-Z]{2,}$/.test(core)) return `**${text}**`
  if (/[_./\\]/.test(core) || /[a-z][A-Z]/.test(core)) return `**${text}**`
  return text
}

export function srtEmphasis(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
}

export function plainCaption(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1')
}

function speakerName(project: Project, speakerId: string): string {
  return project.transcript.speakers.find((s) => s.id === speakerId)?.name ?? prettySpeakerName(speakerId)
}

function captionText(project: Project, group: Word[], opts: CaptionBuildOptions): string {
  const tokens = group.map((w) => (opts.emphasize ? emphasizeToken(w.text) : w.text))
  let body = tokens.join(' ')
  if (opts.speakerPrefix) {
    const id = group[0]?.speaker
    if (id) body = `${speakerName(project, id)}: ${body}`
  }
  return body
}

export function wordsToCaptions(project: Project, opts: CaptionBuildOptions = {}): Clip[] {
  const maxWords = opts.maxWords ?? 10
  const gapLimit = opts.gap ?? 0.7
  const live = project.transcript.words.filter((w) => !w.deleted)
  if (transcriptIsPlaceholder(live)) return []
  const groups: Word[][] = []
  let bucket: Word[] = []

  for (const word of live) {
    const prev = bucket[bucket.length - 1]
    const gap = prev ? word.start - prev.end : 0
    const punct = prev?.text.match(/[.!?]$/)
    const speakerChanged = opts.speakerPrefix && prev && prev.speaker !== word.speaker
    if (bucket.length && (gap > gapLimit || punct || speakerChanged || bucket.length >= maxWords)) {
      groups.push(bucket)
      bucket = [word]
    } else {
      bucket.push(word)
    }
  }
  if (bucket.length) groups.push(bucket)

  return groups.map((group) => {
    const start = sourceToProgramOf(project, group[0].start)
    const end = sourceToProgramOf(project, group[group.length - 1].end)
    const duration = Math.max(0.8, end - start)
    return {
      id: uid('cap'),
      trackId: 'v3',
      start,
      duration,
      inPoint: 0,
      outPoint: duration,
      transform: { ...DEFAULT_TRANSFORM },
      volume: 1,
      muted: false,
      speed: 1,
      text: captionText(project, group, opts),
      style: { ...DEFAULT_CAPTION_STYLE },
      ...emptyClipFields(),
      auto: true
    }
  })
}

export function captionClipsOf(project: Project): Clip[] {
  return project.tracks.filter((t) => t.type === 'caption').flatMap((t) => t.clips.filter((c) => c.text))
}

export function transcriptReadyForCaptions(project: Project): boolean {
  const live = project.transcript.words.filter((word) => !word.deleted)
  return live.length > 0 && !transcriptIsPlaceholder(live)
}

/** Empty track, or every title still marked auto — safe to rebuild from words. */
export function captionTrackIsAuto(project: Project): boolean {
  const caps = captionClipsOf(project)
  return caps.length === 0 || caps.every((clip) => clip.auto)
}

export function shouldAutoCaption(project: Project): boolean {
  return transcriptReadyForCaptions(project) && captionTrackIsAuto(project)
}

export function captionsForExport(project: Project): Clip[] {
  const existing = captionClipsOf(project)
  return existing.length ? existing : wordsToCaptions(project)
}

export function withCaptionClips(project: Project, clips: Clip[]): Project {
  const track = project.tracks.find((t) => t.type === 'caption')
  const placed = clips.map((clip) => ({ ...clip, trackId: track?.id ?? clip.trackId }))
  if (!track) {
    return {
      ...project,
      updatedAt: Date.now(),
      tracks: [
        {
          id: uid('trk'),
          type: 'caption',
          name: 'V3 Captions',
          locked: false,
          muted: false,
          hidden: false,
          clips: placed
        },
        ...project.tracks
      ]
    }
  }
  return {
    ...project,
    updatedAt: Date.now(),
    tracks: project.tracks.map((t) =>
      t.type === 'caption' && t.id === track.id ? revealStackTrack({ ...t, clips: placed }) : t
    )
  }
}

export function withGeneratedCaptions(project: Project, opts: CaptionBuildOptions = {}): Project {
  const clips = wordsToCaptions(project, opts)
  if (!clips.length) return project
  return withCaptionClips(project, clips)
}

export function lowerThirdClips(project: Project): Clip[] {
  const scenes = (project.scenes ?? []).filter((s) => s.kind !== 'retake')
  return scenes.map((scene) => {
    const start = sourceToProgramOf(project, scene.start)
    const duration = 2.4
    return {
      id: uid('lt'),
      trackId: 'v2',
      start,
      duration,
      inPoint: 0,
      outPoint: duration,
      transform: { ...DEFAULT_TRANSFORM, x: -520, y: 280 },
      volume: 1,
      muted: false,
      speed: 1,
      text: scene.summary ? `${scene.title}\n${scene.summary}` : scene.title,
      style: { ...TITLE_PRESETS['lower-third'] },
      ...emptyClipFields()
    }
  })
}

export function withLowerThirds(project: Project): Project {
  const overlay = project.tracks.find((t) => t.type === 'overlay')
  if (!overlay) return project
  const extras = lowerThirdClips(project).map((clip) => ({ ...clip, trackId: overlay.id }))
  const stale = new Set(
    overlay.clips
      .filter((c) => extras.some((n) => n.text === c.text && Math.abs(n.start - c.start) < 0.08))
      .map((c) => c.id)
  )
  return {
    ...project,
    updatedAt: Date.now(),
    tracks: project.tracks.map((t) =>
      t.id === overlay.id ? { ...t, clips: [...t.clips.filter((c) => !stale.has(c.id)), ...extras] } : t
    )
  }
}

export interface CaptionCue {
  start: number
  end: number
  text: string
}

function parseTimestamp(value: string): number {
  const clean = value.trim().replace(',', '.')
  const parts = clean.split(':')
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2])
  }
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1])
  return Number(clean)
}

export function parseCaptionCues(text: string): CaptionCue[] {
  const body = text.replace(/\r/g, '').replace(/^WEBVTT.*\n+/i, '')
  const blocks = body.split(/\n\n+/)
  const cues: CaptionCue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean)
    if (lines.length < 2) continue
    const time = lines.find((l) => l.includes('-->'))
    if (!time) continue
    const [startRaw, endRaw] = time.split('-->')
    const payload = lines
      .filter((l) => l !== time && !/^\d+$/.test(l) && !l.startsWith('NOTE'))
      .join(' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const voiced = splitVoiceTag(payload)
    if (!voiced.text) continue
    cues.push({
      start: parseTimestamp(startRaw),
      end: parseTimestamp(endRaw.split(/\s+/)[0] ?? endRaw),
      text: voiced.text
    })
  }
  return cues
}

export function clipsFromCaptionCues(cues: CaptionCue[], trackId = 'v3'): Clip[] {
  return cues.map((cue) => {
    const duration = Math.max(0.4, cue.end - cue.start)
    return {
      id: uid('cap'),
      trackId,
      start: cue.start,
      duration,
      inPoint: 0,
      outPoint: duration,
      transform: { ...DEFAULT_TRANSFORM },
      volume: 1,
      muted: false,
      speed: 1,
      text: cue.text,
      style: { ...DEFAULT_CAPTION_STYLE },
      ...emptyClipFields()
    }
  })
}

function stamp(seconds: number, vtt = false): string {
  const t = Math.max(0, seconds)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  const ms = Math.floor((t % 1) * 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const sep = vtt ? '.' : ','
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms, 3)}`
}

export function cuesToSrt(clips: Clip[]): string {
  return clips
    .map((clip, i) => {
      const start = clip.start
      const end = clip.start + clip.duration
      return `${i + 1}\n${stamp(start)} --> ${stamp(end)}\n${srtEmphasis(clip.text ?? '')}\n`
    })
    .join('\n')
}

export function cuesToVtt(clips: Clip[]): string {
  const body = clips
    .map((clip) => {
      const start = clip.start
      const end = clip.start + clip.duration
      return `${stamp(start, true)} --> ${stamp(end, true)}\n${srtEmphasis(clip.text ?? '')}\n`
    })
    .join('\n')
  return `WEBVTT\n\n${body}`
}

export function projectToTranscriptTxt(project: Project): string {
  return project.transcript.words
    .filter((w) => !w.deleted)
    .map((w) => w.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function projectToTranscriptMd(project: Project): string {
  const live = project.transcript.words.filter((w) => !w.deleted)
  const names = new Map(project.transcript.speakers.map((s) => [s.id, s.name]))
  const turns: { speaker: string; words: string[] }[] = []
  for (const word of live) {
    const name = names.get(word.speaker) ?? prettySpeakerName(word.speaker)
    const last = turns[turns.length - 1]
    if (!last || last.speaker !== name) turns.push({ speaker: name, words: [word.text] })
    else last.words.push(word.text)
  }
  return turns.map((turn) => `## ${turn.speaker}\n\n${turn.words.join(' ')}\n`).join('\n')
}

export function projectToChapters(project: Project): string {
  const scenes = (project.scenes ?? []).filter((s) => s.kind !== 'retake')
  const chapters = scenes.map((scene) => ({
    start: Number(sourceToProgramOf(project, scene.start).toFixed(3)),
    title: scene.title,
    summary: scene.summary,
    kind: scene.kind
  }))
  return JSON.stringify({ chapters }, null, 2)
}

export function serialCaptions(clips: Clip[]): Array<{
  start: number
  duration: number
  text: string
  style?: CaptionStyle
}> {
  return clips.map((c) => ({
    start: c.start,
    duration: c.duration,
    text: c.text ?? '',
    style: c.style
  }))
}
