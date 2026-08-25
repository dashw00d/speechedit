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
import { overlap } from './edl'
import { sourceToProgramOf } from './resolver'
import { formatYoutubeClock, uid } from './time'
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

function clipSpan(clip: Clip): { start: number; end: number } {
  return { start: clip.start, end: clip.start + clip.duration }
}

/** Handmade titles and edited cards. Auto cards are safe to rebuild. */
export function keepManualCaptionClips(project: Project): Clip[] {
  return captionClipsOf(project).filter((clip) => Boolean(clip.text) && !clip.auto && !clip.assetId)
}

export function captionsNeedFilling(project: Project): boolean {
  if (!transcriptReadyForCaptions(project)) return false
  const live = project.transcript.words.filter((word) => !word.deleted)
  const caps = captionClipsOf(project)
  if (!caps.length) return true
  const uncovered = live.filter((word) => {
    const start = sourceToProgramOf(project, word.start)
    const end = sourceToProgramOf(project, word.end)
    return !caps.some((clip) => overlap({ start, end }, clipSpan(clip)) > 0.02)
  })
  return uncovered.length >= 3
}

export function withGeneratedCaptions(project: Project, opts: CaptionBuildOptions = {}): Project {
  const generated = wordsToCaptions(project, opts)
  const keep = keepManualCaptionClips(project)
  if (!generated.length) return keep.length ? withCaptionClips(project, keep) : project
  const fresh = generated.filter((clip) => !keep.some((held) => overlap(clipSpan(clip), clipSpan(held)) > 0.25))
  return withCaptionClips(project, [...keep, ...fresh].sort((a, b) => a.start - b.start))
}

function wordsCoveringClip(project: Project, clip: Clip): Word[] {
  const clipEnd = clip.start + clip.duration
  return project.transcript.words.filter((word) => {
    if (word.deleted) return false
    const start = sourceToProgramOf(project, word.start)
    const end = sourceToProgramOf(project, word.end)
    const lo = Math.min(start, end)
    const hi = Math.max(start, end)
    if (hi > lo + 1e-4) return lo < clipEnd && hi > clip.start
    return word.start < clipEnd && word.end > clip.start
  })
}

/** Rebuild auto caption cards that cover these words. Manual titles and edited cards stay. */
export function syncAutoCaptionsForWords(project: Project, wordIds: string[]): Project {
  if (!wordIds.length) return project
  const wanted = new Set(wordIds)
  if (!project.transcript.words.some((word) => wanted.has(word.id))) return project

  let changed = false
  const tracks = project.tracks.map((track) => {
    if (track.type !== 'caption') return track
    const clips = track.clips.map((clip) => {
      if (!clip.auto || !clip.text) return clip
      if (clip.style?.position === 'center' && (clip.style.fontSize ?? 0) >= 56) return clip
      const group = wordsCoveringClip(project, clip)
      if (!group.some((word) => wanted.has(word.id))) return clip
      const text = captionText(project, group, { emphasize: true })
      if (text === clip.text) return clip
      changed = true
      return { ...clip, text }
    })
    return changed ? { ...track, clips } : track
  })
  return changed ? { ...project, tracks, updatedAt: Date.now() } : project
}

export function captionsFollowed(before: Project, after: Project): boolean {
  const prev = new Map(captionClipsOf(before).map((clip) => [clip.id, clip.text]))
  return captionClipsOf(after).some((clip) => prev.has(clip.id) && prev.get(clip.id) !== clip.text)
}

export function toastForCaptionFollow(before: Project, after: Project): string | null {
  return captionsFollowed(before, after) ? 'Captions follow the word.' : null
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

export function hasSceneLowerThirds(project: Project): boolean {
  const chapters = (project.scenes ?? []).filter((scene) => scene.kind !== 'retake')
  if (chapters.length < 2) return false
  const overlay = project.tracks.find((track) => track.type === 'overlay')?.clips ?? []
  const names = overlay.filter((clip) => Boolean(clip.text) && !clip.assetId && clip.style?.position === 'lower')
  return names.length >= chapters.length
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

/** Notes someone actually typed — not the empty “Note” placeholder. */
export function typedTapeNotes(project: Project): { start: number; label: string }[] {
  return (project.tags ?? [])
    .filter((tag) => tag.kind === 'note')
    .map((tag) => ({ start: tag.start, label: tag.label.trim() }))
    .filter((note) => note.label && note.label !== 'Note')
    .sort((a, b) => a.start - b.start)
}

export function projectToTranscriptMd(project: Project): string {
  const live = project.transcript.words.filter((w) => !w.deleted)
  const names = new Map(project.transcript.speakers.map((s) => [s.id, s.name]))
  const chapters = (project.scenes ?? [])
    .filter((scene) => scene.kind !== 'retake')
    .slice()
    .sort((a, b) => a.start - b.start)
  const notes = typedTapeNotes(project)
  const parts: string[] = []
  let chapter = -1
  let noteAt = 0
  let speaker: string | null = null
  let lastSpeaker: string | null = null
  let words: string[] = []

  const flushSpeech = () => {
    if (!speaker || !words.length) return
    if (lastSpeaker !== speaker) {
      parts.push(`## ${speaker}\n\n${words.join(' ')}\n`)
      lastSpeaker = speaker
    } else {
      parts.push(`${words.join(' ')}\n`)
    }
    words = []
  }

  const emitNote = (label: string) => {
    flushSpeech()
    parts.push(`> ${label}\n`)
  }

  for (const word of live) {
    while (chapter + 1 < chapters.length && chapters[chapter + 1]!.start <= word.start + 0.05) {
      chapter += 1
      flushSpeech()
      speaker = null
      lastSpeaker = null
      const title = chapters[chapter]!.title.trim() || 'Chapter'
      parts.push(`### ${title}\n`)
    }
    while (noteAt < notes.length && notes[noteAt]!.start <= word.start + 0.05) {
      emitNote(notes[noteAt]!.label)
      noteAt += 1
    }
    const name = names.get(word.speaker) ?? prettySpeakerName(word.speaker)
    if (name !== speaker) {
      flushSpeech()
      speaker = name
    }
    words.push(word.text)
  }
  flushSpeech()
  while (noteAt < notes.length) {
    emitNote(notes[noteAt]!.label)
    noteAt += 1
  }
  return parts.join('\n')
}

const YOUTUBE_CHAPTER_GAP = 10

/** Pasteable YouTube description lines from scene headings. Retakes stay out. */
export function projectToChapters(project: Project): string {
  const scenes = (project.scenes ?? [])
    .filter((scene) => scene.kind !== 'retake')
    .map((scene) => ({
      start: sourceToProgramOf(project, scene.start),
      title: scene.title.trim() || 'Chapter'
    }))
    .sort((a, b) => a.start - b.start)
  const rows: { start: number; title: string }[] = []
  for (const scene of scenes) {
    if (!rows.length) {
      if (scene.start <= 0.5) rows.push({ start: 0, title: scene.title })
      else {
        rows.push({ start: 0, title: 'Start' })
        if (scene.start >= YOUTUBE_CHAPTER_GAP) rows.push(scene)
      }
      continue
    }
    if (scene.start - rows[rows.length - 1]!.start < YOUTUBE_CHAPTER_GAP) continue
    rows.push(scene)
  }
  return rows.map((row) => `${formatYoutubeClock(row.start)} ${row.title}`).join('\n')
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
