import {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_TRANSFORM,
  emptyClipFields,
  type Asset,
  type Clip,
  type Command,
  type Cut,
  type Interval,
  type Project,
  type SegmentStyle,
  type SuggestionType,
  type TagKind,
  type Track,
  type TrackType,
  type Transform,
  type Word
} from '../types'
import { buildSuggestions, cutMinusProtected, leftoverKind, protectIntervals, suggestionsFromGaps } from './analysis'
import {
  TITLE_PRESETS,
  clipsFromCaptionCues,
  parseCaptionCues,
  withCaptionClips,
  withGeneratedCaptions,
  withLowerThirds
} from './captions'
import { autoHideEmptyStackTrack, revealStackTrack } from './timelineTracks'
import { speakerPalette } from './theme'
import { assignmentsFromCues, hasProviderSpeakers, prettySpeakerName, speakerSlug } from './diarize'
import {
  commandForScene,
  inferScenesLocal,
  normalizeScenes,
  retakeRanges,
  suggestionsFromScenes,
  takeFamily
} from './sceneAnalysis'
import { takeWordsNeedReplace, transcriptIsPlaceholder } from './transcript'
import { coveringAppliedSuggestion, previousSentenceRange, sentenceRange } from './transcriptEdit'
import {
  clamp,
  mergeIntervals,
  overlap,
  projectKept,
  shiftProgramClips
} from './edl'
import { normalizeProject } from './normalize'
import { sourceOffsetOf } from './takes'
import {
  asVideoClips,
  programLengthOf,
  programToSourceOf,
  resolveMediaSegments,
  resolveSegments,
  segmentAtProgram,
  segmentId,
  sourceToProgramOf
} from './resolver'
import {
  closeInsert,
  consumeInsert,
  isSlugId,
  placeInsert,
  rippleInserts,
  shiftInserts,
  slugInsertId
} from './inserts'
import { uid } from './time'
import {
  applyLookToClip,
  extendedClip,
  neighborsOnTrack,
  rolledPair,
  slidTrio,
  slippedClip
} from './clipEdit'

function touch(project: Project): Project {
  return normalizeProject({ ...project, updatedAt: Date.now() })
}

function mediaProgramLength(project: Project): number {
  const segs = resolveMediaSegments(normalizeProject(project))
  if (!segs.length) return 0
  const last = segs[segs.length - 1]
  return last.start + last.duration
}

function overlayTracks(project: Project): Track[] {
  return project.tracks.filter((t) => t.type === 'overlay' || t.type === 'caption')
}

export function isPrimaryLane(track: Track): boolean {
  return track.id === 'v1' || track.id === 'a1'
}

export function findMovableClip(project: Project, clipId: string | null): Clip | undefined {
  if (!clipId) return undefined
  for (const track of project.tracks) {
    if (isPrimaryLane(track) || track.locked) continue
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip) return clip
  }
  return undefined
}

function shiftOverlays(project: Project, afterProgram: number, delta: number): Track[] {
  return project.tracks.map((track) => {
    if (isPrimaryLane(track)) return track
    return { ...track, clips: shiftProgramClips(track.clips, afterProgram, delta) }
  })
}

function stampWords(words: Word[], start: number, end: number, deleted: boolean): Word[] {
  const out: Word[] = []
  for (const word of words) {
    const ov = overlap(word, { start, end })
    const wordLen = word.end - word.start
    if (ov <= 0 || wordLen <= 0) {
      out.push(word)
      continue
    }
    if (ov >= wordLen - 0.02) {
      out.push({ ...word, deleted })
      continue
    }
    if (word.start < start - 0.02) {
      out.push({ ...word, id: uid('w'), end: start })
    }
    out.push({
      ...word,
      id: uid('w'),
      start: Math.max(word.start, start),
      end: Math.min(word.end, end),
      deleted
    })
    if (word.end > end + 0.02) {
      out.push({ ...word, id: uid('w'), start: end })
    }
  }
  return out
}

function markWords(project: Project, start: number, end: number, deleted: boolean): Project {
  return {
    ...project,
    transcript: {
      ...project.transcript,
      words: stampWords(project.transcript.words, start, end, deleted)
    }
  }
}

function mergeProjectCuts(cuts: Cut[]): Cut[] {
  const merged = mergeIntervals(cuts)
  return merged.map((interval, i) => {
    const hit = cuts.find(
      (c) => Math.abs(c.start - interval.start) < 1e-3 && Math.abs(c.end - interval.end) < 1e-3
    )
    return {
      id: hit?.id ?? uid('cut'),
      start: interval.start,
      end: interval.end,
      source: hit?.source ?? cuts[i]?.source ?? 'manual'
    }
  })
}

function deleteSourceRange(
  project: Project,
  start: number,
  end: number,
  source: Cut['source'],
  lift = false
): Project {
  const lo = clamp(Math.min(start, end), 0, project.sourceDuration || end)
  const hi = clamp(Math.max(start, end), 0, project.sourceDuration || end)
  if (hi - lo < 0.03) return project

  const programStart = sourceToProgramOf(project, lo)
  const programEnd = sourceToProgramOf(project, hi)
  const removedProgram = Math.max(0, programEnd - programStart)

  let next = markWords(project, lo, hi, true)
  next = {
    ...next,
    cuts: mergeProjectCuts([...next.cuts, { id: uid('cut'), start: lo, end: hi, source }]),
    splits: (next.splits ?? []).filter((t) => t < lo || t > hi),
    styles: (next.styles ?? []).flatMap((style) => {
      if (overlap(style, { start: lo, end: hi }) === 0) return [style]
      const pieces: SegmentStyle[] = []
      if (style.start < lo - 0.02) pieces.push({ ...style, id: uid('sty'), end: lo })
      if (style.end > hi + 0.02) pieces.push({ ...style, id: uid('sty'), start: hi })
      return pieces
    }),
    tracks: lift ? next.tracks : shiftOverlays(next, programStart, -removedProgram),
    inserts: lift
      ? placeInsert(next.inserts ?? [], programStart, removedProgram, lo)
      : rippleInserts(next.inserts ?? [], programStart, programEnd),
    suggestions: next.suggestions.map((s) =>
      overlap(s, { start: lo, end: hi }) > s.end - s.start - 0.05 ? { ...s, applied: true } : s
    )
  }
  return touch(next)
}

function subtractFromCuts(cuts: Cut[], lo: number, hi: number): Cut[] {
  const out: Cut[] = []
  for (const cut of cuts) {
    if (overlap(cut, { start: lo, end: hi }) === 0) {
      out.push(cut)
      continue
    }
    if (cut.start < lo - 0.02) out.push({ ...cut, id: uid('cut'), end: lo })
    if (cut.end > hi + 0.02) out.push({ ...cut, id: uid('cut'), start: hi })
  }
  return out
}

function restoreSourceRange(project: Project, start: number, end: number): Project {
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  const programStart = sourceToProgramOf(project, lo)

  let next: Project = {
    ...project,
    cuts: subtractFromCuts(project.cuts, lo, hi),
    transcript: {
      ...project.transcript,
      words: stampWords(project.transcript.words, lo, hi, false)
    },
    suggestions: project.suggestions.map((s) =>
      overlap(s, { start: lo, end: hi }) > s.end - s.start - 0.05 ? { ...s, applied: false } : s
    )
  }

  const addedProgram = Math.max(0, sourceToProgramOf(next, hi) - sourceToProgramOf(next, lo))
  const eaten = consumeInsert(next.inserts ?? [], programStart, addedProgram)
  const leftover = addedProgram - eaten.consumed
  next = {
    ...next,
    inserts: leftover > 0.03 ? shiftInserts(eaten.inserts, programStart, leftover) : eaten.inserts,
    tracks: leftover > 0.03 ? shiftOverlays(next, programStart, leftover) : next.tracks
  }
  return touch(next)
}

function toggleWords(project: Project, wordIds: string[], lift = false): Project {
  const selected = project.transcript.words.filter((w) => wordIds.includes(w.id))
  if (!selected.length) return project
  const start = Math.min(...selected.map((w) => w.start))
  const end = Math.max(...selected.map((w) => w.end))
  const shouldDelete = selected.some((w) => !w.deleted)
  return shouldDelete
    ? deleteSourceRange(project, start, end, 'transcript', lift)
    : restoreSourceRange(project, start, end)
}

function cutMarkedRange(project: Project, lift: boolean): Project {
  if (project.markIn == null || project.markOut == null) return project
  const start = Math.min(project.markIn, project.markOut)
  const end = Math.max(project.markIn, project.markOut)
  return applyCommand(
    { ...project, markIn: null, markOut: null },
    {
      type: 'deleteRange',
      start: programToSourceOf(project, start),
      end: programToSourceOf(project, end),
      source: 'manual',
      lift
    }
  )
}

function findClip(project: Project, clipId: string): { track: Track; clip: Clip } | undefined {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip) return { track, clip }
  }
  return undefined
}

function splitClipsAtProgram(clips: Clip[], program: number): Clip[] {
  const out: Clip[] = []
  for (const clip of clips) {
    const end = clip.start + clip.duration
    if (program > clip.start + 0.05 && program < end - 0.05) {
      const leftDur = program - clip.start
      out.push({ ...clip, duration: leftDur, outPoint: clip.inPoint + leftDur })
      out.push({
        ...clip,
        id: uid('clip'),
        start: program,
        duration: end - program,
        inPoint: clip.inPoint + leftDur
      })
    } else {
      out.push(clip)
    }
  }
  return out
}

function replaceTrackClips(project: Project, trackId: string, clips: Clip[]): Project {
  return touch({
    ...project,
    tracks: project.tracks.map((track) => (track.id === trackId ? { ...track, clips } : track))
  })
}

function mapClips(project: Project, ids: string[], fn: (clip: Clip) => Clip): Project {
  const set = new Set(ids)
  return touch({
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => (set.has(clip.id) ? fn(clip) : clip))
    }))
  })
}

function mapClip(project: Project, clipId: string, fn: (clip: Clip) => Clip): Project {
  if (!findClip(project, clipId)) return project
  return touch({
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => (clip.id === clipId ? fn(clip) : clip))
    }))
  })
}

function upsertStyle(project: Project, start: number, end: number, patch: Partial<SegmentStyle>): Project {
  const styles = [...(project.styles ?? [])]
  const hit = styles.findIndex((s) => Math.abs(s.start - start) < 0.04 && Math.abs(s.end - end) < 0.04)
  if (hit >= 0) {
    styles[hit] = { ...styles[hit], ...patch }
  } else {
    styles.push({
      id: uid('sty'),
      start,
      end,
      speed: 1,
      transform: { ...DEFAULT_TRANSFORM, ...project.picture },
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      keyframes: [],
      ...patch
    })
  }
  return touch({ ...project, styles })
}

function styleFromSegment(project: Project, segmentIdValue: string): SegmentStyle | undefined {
  const seg = resolveSegments(project).find((s) => s.id === segmentIdValue)
  if (!seg) return undefined
  return (
    (project.styles ?? []).find((s) => s.id === segmentIdValue) ?? {
      id: segmentIdValue,
      start: seg.inPoint,
      end: seg.outPoint,
      speed: seg.speed,
      transform: seg.transform,
      volume: seg.volume,
      fadeIn: seg.fadeIn,
      fadeOut: seg.fadeOut,
      keyframes: seg.keyframes
    }
  )
}

function applySuggestion(project: Project, suggestionId: string): Project {
  const suggestion = project.suggestions.find((s) => s.id === suggestionId)
  if (!suggestion || suggestion.applied) return project
  if (suggestion.action === 'review' && leftoverKind(suggestion) !== 'still') return project
  if (suggestion.action === 'normalize') {
    return touch({
      ...project,
      audioMaster: { ...project.audioMaster, normalize: true },
      suggestions: project.suggestions.map((s) =>
        s.id === suggestionId ? { ...s, applied: true } : s
      )
    })
  }
  if (suggestion.action === 'speed') {
    const next = applyCommand(project, {
      type: 'setSpeed',
      start: suggestion.start,
      end: suggestion.end,
      speed: suggestion.speed ?? 4
    })
    return touch({
      ...next,
      suggestions: next.suggestions.map((s) =>
        s.id === suggestionId ? { ...s, applied: true } : s
      )
    })
  }
  if (suggestion.action === 'volume') {
    const next = applyCommand(project, {
      type: 'setRangeVolume',
      start: suggestion.start,
      end: suggestion.end,
      volume: suggestion.volume ?? 0.5
    })
    return touch({
      ...next,
      suggestions: next.suggestions.map((s) =>
        s.id === suggestionId ? { ...s, applied: true } : s
      )
    })
  }
  const source =
    suggestion.type === 'filler'
      ? 'filler'
      : suggestion.type === 'silence'
        ? 'silence'
        : suggestion.type === 'repeat'
          ? 'repeat'
          : suggestion.type === 'model'
            ? 'model'
            : 'manual'
  const pieces = cutMinusProtected(suggestion, protectIntervals(project.tags ?? []))
  if (!pieces.length) return project
  const next = pieces.reduce(
    (acc, piece) => deleteSourceRange(acc, piece.start, piece.end, source),
    project
  )
  return touch({
    ...next,
    suggestions: next.suggestions.map((s) => (s.id === suggestionId ? { ...s, applied: true } : s))
  })
}

function markSuggestion(project: Project, suggestionId: string, applied: boolean): Project {
  return touch({
    ...project,
    suggestions: project.suggestions.map((s) => (s.id === suggestionId ? { ...s, applied } : s))
  })
}

function revertSuggestion(project: Project, suggestionId: string): Project {
  const suggestion = project.suggestions.find((s) => s.id === suggestionId)
  if (!suggestion || !suggestion.applied) return project
  if (suggestion.action === 'normalize') {
    return markSuggestion(
      { ...project, audioMaster: { ...project.audioMaster, normalize: false } },
      suggestionId,
      false
    )
  }
  if (suggestion.action === 'speed') {
    const next = applyCommand(project, {
      type: 'setSpeed',
      start: suggestion.start,
      end: suggestion.end,
      speed: 1
    })
    return markSuggestion(next, suggestionId, false)
  }
  if (suggestion.action === 'volume') {
    const next = applyCommand(project, {
      type: 'setRangeVolume',
      start: suggestion.start,
      end: suggestion.end,
      volume: 1
    })
    return markSuggestion(next, suggestionId, false)
  }
  return markSuggestion(restoreSourceRange(project, suggestion.start, suggestion.end), suggestionId, false)
}

function revertSuggestionType(project: Project, suggestionType: SuggestionType): Project {
  return project.suggestions
    .filter((s) => s.applied && s.type === suggestionType)
    .reduce((acc, suggestion) => revertSuggestion(acc, suggestion.id), project)
}

function tightenRange(project: Project, start: number, end: number): Project {
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  const words = project.transcript.words
    .filter((w) => !w.deleted && w.end > lo && w.start < hi)
    .sort((a, b) => a.start - b.start)
  const gaps: { start: number; end: number }[] = []
  for (let i = 1; i < words.length; i++) {
    const gapStart = Math.max(lo, words[i - 1].end)
    const gapEnd = Math.min(hi, words[i].start)
    if (gapEnd - gapStart >= 0.25) gaps.push({ start: gapStart, end: gapEnd })
  }
  return gaps.reduce((acc, gap) => {
    const pieces = cutMinusProtected(gap, protectIntervals(acc.tags ?? []))
    return pieces.reduce((next, piece) => deleteSourceRange(next, piece.start, piece.end, 'silence'), acc)
  }, project)
}

const TAG_LABELS: Record<TagKind, string> = {
  keep: 'Keep · auto-edit skips this',
  demo: 'Demo · silent walkthrough',
  note: 'Note',
  hook: 'Hook',
  cta: 'CTA'
}

function addTag(project: Project, start: number, end: number, kind: TagKind, label?: string): Project {
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  if (hi - lo < 0.04) return project
  const existing = project.tags ?? []
  const mergeable = existing.filter(
    (t) => t.kind === kind && (overlap(t, { start: lo, end: hi }) > 0 || t.end >= lo - 0.12 && t.start <= hi + 0.12)
  )
  const tag = {
    id: uid('tag'),
    start: Math.min(lo, ...mergeable.map((t) => t.start)),
    end: Math.max(hi, ...mergeable.map((t) => t.end)),
    kind,
    label: label?.trim() || mergeable[0]?.label || TAG_LABELS[kind]
  }
  const next = {
    ...project,
    tags: [...existing.filter((t) => !mergeable.some((m) => m.id === t.id)), tag]
  }
  if (kind === 'keep' || kind === 'demo') {
    return restoreSourceRange(next, lo, hi)
  }
  return touch(next)
}

function eraseTag(project: Project, start: number, end: number, kind?: TagKind): Project {
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  if (hi - lo < 0.03) return project
  const tags = (project.tags ?? []).flatMap((tag) => {
    if (kind && tag.kind !== kind) return [tag]
    if (overlap(tag, { start: lo, end: hi }) === 0) return [tag]
    const out: Project['tags'] = []
    if (tag.start < lo - 0.03) out.push({ ...tag, id: uid('tag'), end: lo })
    if (tag.end > hi + 0.03) out.push({ ...tag, id: uid('tag'), start: hi })
    return out
  })
  return touch({ ...project, tags })
}

function rebuildSuggestionList(project: Project): Project {
  const applied = project.suggestions.filter((s) => s.applied)
  const fresh = buildSuggestions({
    duration: project.sourceDuration,
    silence: project.analysis.silence,
    sceneHits: project.analysis.staticRegions,
    loudnessWindows: project.analysis.loudness,
    words: project.transcript.words,
    margin: project.cutMargin
  }).filter((s) => !applied.some((a) => overlap(a, s) > (s.end - s.start) * 0.6))
  return touch({ ...project, suggestions: [...applied, ...fresh] })
}

function applyDiarization(
  project: Project,
  assignments?: { start: number; end: number; speaker: string }[]
): Project {
  const colors = [...speakerPalette()]
  const speakers = [...project.transcript.speakers]
  const resolve = (label: string): string => {
    const existing = speakers.find(
      (s) => s.id === label || s.id === speakerSlug(label) || s.name.toLowerCase() === label.toLowerCase()
    )
    if (existing) return existing.id
    const id = speakerSlug(label)
    const again = speakers.find((s) => s.id === id)
    if (again) return again.id
    speakers.push({
      id,
      name: prettySpeakerName(label),
      color: colors[speakers.length % colors.length]
    })
    return id
  }

  const words = assignments?.length
    ? project.transcript.words.map((word) => {
        const hit = assignments.find((a) => overlap(word, a) > 0)
        return hit ? { ...word, speaker: resolve(hit.speaker) } : word
      })
    : project.transcript.words.map((word) => ({ ...word, speaker: resolve(word.speaker) }))

  return touch({
    ...project,
    transcript: { ...project.transcript, words, speakers }
  })
}

function newGraphic(
  project: Project,
  trackType: 'caption' | 'overlay',
  start: number,
  duration: number,
  text: string,
  extra: Partial<Clip> = {}
): Project {
  const track = project.tracks.find((t) => t.type === trackType)
  if (!track) return project
  const inPoint = Math.max(0, extra.inPoint ?? 0)
  const clip: Clip = {
    id: uid('clip'),
    trackId: track.id,
    start,
    duration,
    transform: { ...DEFAULT_TRANSFORM },
    volume: 1,
    muted: false,
    speed: 1,
    text,
    style: { ...DEFAULT_CAPTION_STYLE },
    ...emptyClipFields(),
    ...extra,
    inPoint,
    outPoint: extra.outPoint ?? inPoint + duration
  }
  return touch({
    ...project,
    tracks: project.tracks.map((t) =>
      t.id === track.id ? revealStackTrack({ ...t, clips: [...t.clips, clip] }) : t
    )
  })
}

export function applyCommand(project: Project, command: Command): Project {
  const current = normalizeProject(project)
  switch (command.type) {
    case 'deleteRange':
      return deleteSourceRange(current, command.start, command.end, command.source ?? 'manual', command.lift)
    case 'restoreRange':
      return restoreSourceRange(current, command.start, command.end)
    case 'toggleWords':
      return toggleWords(current, command.wordIds, command.lift)
    case 'setWordText':
      return touch({
        ...current,
        transcript: {
          ...current.transcript,
          words: current.transcript.words.map((w) =>
            w.id === command.wordId ? { ...w, text: command.text } : w
          )
        }
      })
    case 'replaceWords': {
      const map = new Map(command.pairs.map((pair) => [pair.wordId, pair.text]))
      if (!map.size) return current
      let changed = false
      const words = current.transcript.words.map((word) => {
        if (!map.has(word.id)) return word
        const text = map.get(word.id)!
        if (word.text === text) return word
        changed = true
        return { ...word, text }
      })
      return changed ? touch({ ...current, transcript: { ...current.transcript, words } }) : current
    }
    case 'rippleDelete':
      return deleteSourceRange(current, command.start, command.end, 'manual')
    case 'rippleDeleteMarks':
      return cutMarkedRange(current, false)
    case 'liftMarks':
      return cutMarkedRange(current, true)
    case 'insertGap': {
      const duration = clamp(command.duration, 0.05, 60)
      const time = clamp(command.time, 0, programLengthOf(current) + 0.01)
      return touch({
        ...current,
        inserts: placeInsert(current.inserts ?? [], time, duration, programToSourceOf(current, time)),
        tracks: shiftOverlays(current, time, duration)
      })
    }
    case 'removeInsert': {
      const closed = closeInsert(current.inserts ?? [], command.insertId)
      if (!closed.removed) return current
      return touch({
        ...current,
        inserts: closed.inserts,
        tracks: shiftOverlays(current, closed.removed.programStart, -closed.removed.duration)
      })
    }
    case 'splitAt': {
      const source = command.time
      const splits = [...(current.splits ?? [])]
      if (!splits.some((t) => Math.abs(t - source) < 0.04)) splits.push(source)
      const program = sourceToProgramOf(current, source)
      return touch({
        ...current,
        splits,
        tracks: current.tracks.map((track) => {
          if (isPrimaryLane(track) || track.locked) return track
          return { ...track, clips: splitClipsAtProgram(track.clips, program) }
        })
      })
    }
    case 'moveClip': {
      const found = findClip(current, command.clipId)
      if (!found || isPrimaryLane(found.track) || found.track.locked) return current
      const destTrack = command.trackId ?? found.clip.trackId
      const dest = current.tracks.find((track) => track.id === destTrack)
      if (!dest || isPrimaryLane(dest) || dest.locked) return current
      const moved: Clip = {
        ...found.clip,
        start: Math.max(0, command.start),
        trackId: destTrack
      }
      return touch({
        ...current,
        tracks: current.tracks.map((track) => {
          const without = track.clips.filter((c) => c.id !== command.clipId)
          if (track.id !== destTrack) return autoHideEmptyStackTrack({ ...track, clips: without })
          return revealStackTrack({ ...track, clips: [...without, moved] })
        })
      })
    }
    case 'trimClip': {
      const found = findClip(current, command.clipId)
      if (!found || isPrimaryLane(found.track) || found.track.locked) return current
      return mapClip(current, command.clipId, (clip) => {
        if (command.edge === 'in') {
          const nextStart = clamp(command.time, 0, clip.start + clip.duration - 0.05)
          const delta = nextStart - clip.start
          return {
            ...clip,
            start: nextStart,
            duration: clip.duration - delta,
            inPoint: clip.inPoint + delta
          }
        }
        const nextEnd = clamp(command.time, clip.start + 0.05, 60 * 60)
        return { ...clip, duration: nextEnd - clip.start, outPoint: clip.inPoint + (nextEnd - clip.start) }
      })
    }
    case 'trimPrimary': {
      const seg = resolveSegments(current).find((s) => s.id === command.segmentId)
      if (!seg) return current
      if (seg.kind === 'slug') {
        const insertId = slugInsertId(seg.id)
        return insertId ? applyCommand(current, { type: 'removeInsert', insertId }) : current
      }
      if (command.edge === 'in') {
        const next = clamp(command.sourceTime, seg.inPoint, seg.outPoint - 0.05)
        return deleteSourceRange(current, seg.inPoint, next, 'manual', command.lift)
      }
      const next = clamp(command.sourceTime, seg.inPoint + 0.05, seg.outPoint)
      return deleteSourceRange(current, next, seg.outPoint, 'manual', command.lift)
    }
    case 'rippleTrimToPlayhead': {
      const seg =
        segmentAtProgram(current, command.time) ??
        resolveSegments(current)
          .filter((s) => s.start + s.duration <= command.time + 1e-4)
          .at(-1)
      if (!seg) return current
      if (seg.kind === 'slug') {
        const insertId = slugInsertId(seg.id)
        return insertId ? applyCommand(current, { type: 'removeInsert', insertId }) : current
      }
      const sourceTime = programToSourceOf(current, command.time)
      return applyCommand(current, {
        type: 'trimPrimary',
        segmentId: seg.id,
        edge: command.edge,
        sourceTime,
        lift: command.lift
      })
    }
    case 'replaceClipMedia': {
      const found = findClip(current, command.clipId)
      if (!found || isPrimaryLane(found.track) || found.track.locked) return current
      return touch({
        ...current,
        assets: { ...current.assets, [command.asset.id]: command.asset },
        tracks: current.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) =>
            clip.id === command.clipId
              ? {
                  ...clip,
                  assetId: command.asset.id,
                  text: command.asset.name,
                  outPoint: clip.inPoint + clip.duration
                }
              : clip
          )
        }))
      })
    }
    case 'setPan': {
      const pan = clamp(command.pan, -1, 1)
      const seg = resolveSegments(current).find((s) => s.id === command.clipId)
      if (seg) return upsertStyle(current, seg.inPoint, seg.outPoint, { pan })
      return mapClip(current, command.clipId, (clip) => ({ ...clip, pan }))
    }
    case 'setTransform': {
      const merge = (base: Transform, patch: Partial<Transform>): Transform => ({
        ...base,
        ...patch,
        crop: { ...base.crop, ...patch.crop }
      })
      const seg = resolveSegments(current).find((s) => s.id === command.clipId)
      if (seg) {
        return upsertStyle(current, seg.inPoint, seg.outPoint, {
          transform: merge(seg.transform, command.transform)
        })
      }
      return mapClip(current, command.clipId, (clip) => ({
        ...clip,
        transform: merge(clip.transform, command.transform)
      }))
    }
    case 'setSegmentStyle': {
      const base = styleFromSegment(current, command.segmentId)
      if (!base) return current
      return upsertStyle(current, base.start, base.end, { ...base, ...command.patch })
    }
    case 'addKeyframe': {
      const base = styleFromSegment(current, command.segmentId)
      if (!base) return current
      return upsertStyle(current, base.start, base.end, {
        keyframes: [
          ...base.keyframes.filter((k) => Math.abs(k.time - command.time) > 0.01),
          { time: command.time, transform: command.transform, easing: 'ease-in-out' }
        ]
      })
    }
    case 'setVolume': {
      const seg = resolveSegments(current).find((s) => s.id === command.clipId)
      if (seg) return upsertStyle(current, seg.inPoint, seg.outPoint, { volume: command.volume })
      return mapClip(current, command.clipId, (clip) => ({
        ...clip,
        volume: clamp(command.volume, 0, 2)
      }))
    }
    case 'setMuted':
      return mapClip(current, command.clipId, (clip) => ({ ...clip, muted: command.muted }))
    case 'setSpeed': {
      const splits = [...(current.splits ?? [])]
      for (const mark of [command.start, command.end]) {
        if (
          mark > 0.04 &&
          mark < (current.sourceDuration || command.end) - 0.04 &&
          !splits.some((t) => Math.abs(t - mark) < 0.04)
        ) {
          splits.push(mark)
        }
      }
      const next = upsertStyle({ ...current, splits }, command.start, command.end, {
        speed: clamp(command.speed, 0.25, 8)
      })
      const delta = mediaProgramLength(next) - mediaProgramLength(current)
      if (Math.abs(delta) < 0.03) return next
      const afterProgram = sourceToProgramOf(current, command.end)
      return {
        ...next,
        inserts: shiftInserts(next.inserts ?? [], afterProgram, delta),
        tracks: shiftOverlays(next, afterProgram, delta)
      }
    }
    case 'setRangeVolume': {
      const splits = [...(current.splits ?? [])]
      for (const mark of [command.start, command.end]) {
        if (
          mark > 0.04 &&
          mark < (current.sourceDuration || command.end) - 0.04 &&
          !splits.some((t) => Math.abs(t - mark) < 0.04)
        ) {
          splits.push(mark)
        }
      }
      return upsertStyle({ ...current, splits }, command.start, command.end, {
        volume: clamp(command.volume, 0, 2)
      })
    }
    case 'setText':
      return mapClip(current, command.clipId, (clip) => ({ ...clip, text: command.text, auto: false }))
    case 'setCaptionStyle':
      return mapClip(current, command.clipId, (clip) => ({
        ...clip,
        auto: false,
        style: { ...DEFAULT_CAPTION_STYLE, ...clip.style, ...command.style }
      }))
    case 'addCaption':
      return newGraphic(current, 'caption', command.start, command.duration, command.text)
    case 'generateCaptions':
      return touch(
        withGeneratedCaptions(current, {
          maxWords: command.maxWords ?? 5,
          speakerPrefix: command.speakerPrefix,
          emphasize: command.emphasize ?? true
        })
      )
    case 'addTitle': {
      const preset = command.preset ?? 'title'
      const trackType = preset === 'title' ? 'caption' : 'overlay'
      return newGraphic(current, trackType, command.start, command.duration, command.text, {
        style: { ...TITLE_PRESETS[preset] }
      })
    }
    case 'addLowerThirds':
      return touch(withLowerThirds(current))
    case 'setCaptionStyleAll':
      return touch({
        ...current,
        tracks: current.tracks.map((track) =>
          track.type === 'caption' || track.type === 'overlay'
            ? {
                ...track,
                clips: track.clips.map((clip) =>
                  clip.text
                    ? {
                        ...clip,
                        auto: false,
                        style: { ...DEFAULT_CAPTION_STYLE, ...clip.style, ...command.style }
                      }
                    : clip
                )
              }
            : track
        )
      })
    case 'importCaptions':
      return touch(withCaptionClips(current, clipsFromCaptionCues(parseCaptionCues(command.text))))
    case 'applyDiarization':
      return applyDiarization(current, command.assignments)
    case 'addOverlay':
      return newGraphic(current, 'overlay', command.start, command.duration, command.text)
    case 'addZoom':
      return newGraphic(current, 'overlay', command.start, command.duration, 'ZOOM', {
        transform: { ...DEFAULT_TRANSFORM, scale: command.scale }
      })
    case 'addBroll': {
      const inPoint = Math.max(0, command.inPoint ?? 0)
      const withAsset = {
        ...current,
        assets: { ...current.assets, [command.asset.id]: command.asset }
      }
      return newGraphic(withAsset, 'overlay', command.start, command.duration, command.asset.name, {
        assetId: command.asset.id,
        inPoint
      })
    }
    case 'addAudio': {
      let next = current.tracks.some((t) => t.type === 'audio' && t.id !== 'a1')
        ? current
        : applyCommand(current, { type: 'addTrack', trackType: 'audio', name: 'A2 Music' })
      const track = next.tracks.find((t) => t.type === 'audio' && t.id !== 'a1')
      if (!track) return current
      const inPoint = Math.max(0, command.inPoint ?? 0)
      const clip: Clip = {
        id: uid('clip'),
        trackId: track.id,
        assetId: command.asset.id,
        start: command.start,
        duration: command.duration,
        inPoint,
        outPoint: inPoint + command.duration,
        transform: { ...DEFAULT_TRANSFORM },
        volume: 0.35,
        muted: false,
        speed: 1,
        text: command.asset.name,
        ...emptyClipFields()
      }
      return touch({
        ...next,
        assets: { ...next.assets, [command.asset.id]: command.asset },
        tracks: next.tracks.map((t) =>
          t.id === track.id ? { ...t, clips: [...t.clips, clip] } : t
        )
      })
    }
    case 'addRedaction':
      return newGraphic(current, 'overlay', command.start, command.duration, 'REDACT', {
        effect: 'blur',
        transform: { ...DEFAULT_TRANSFORM, scale: 0.32 }
      })
    case 'addTrack': {
      const count = current.tracks.filter((t) => t.type === command.trackType).length + 1
      const names: Record<TrackType, string> = {
        caption: `V${count + 2} Captions`,
        overlay: `V${count + 1} Overlay`,
        video: `V${count} Picture`,
        audio: `A${count} Audio`
      }
      const track: Track = {
        id: uid('trk'),
        type: command.trackType,
        name: command.name ?? names[command.trackType],
        locked: false,
        muted: false,
        hidden: false,
        clips: []
      }
      const tracks =
        command.trackType === 'overlay' || command.trackType === 'caption'
          ? [track, ...current.tracks]
          : [...current.tracks, track]
      return touch({ ...current, tracks })
    }
    case 'removeTrack': {
      const track = current.tracks.find((t) => t.id === command.trackId)
      if (!track || isPrimaryLane(track)) return current
      return touch({ ...current, tracks: current.tracks.filter((t) => t.id !== command.trackId) })
    }
    case 'setCutMargin': {
      const margin = clamp(command.margin, 0, 0.45)
      const silence = suggestionsFromGaps({
        duration: current.sourceDuration,
        silence: current.analysis?.silence ?? [],
        sceneHits: current.analysis?.staticRegions ?? [],
        words: current.transcript.words,
        margin
      }).filter((s) => !current.cuts.some((cut) => overlap(cut, s) > (s.end - s.start) * 0.8))
      return touch({
        ...current,
        cutMargin: margin,
        suggestions: [
          ...current.suggestions.filter((s) => s.type !== 'silence' || s.applied),
          ...silence
        ]
      })
    }
    case 'dissolveAtPlayhead': {
      const segs = resolveSegments(current)
      if (segs.length < 2) return current
      let i = segs.findIndex(
        (s) => command.time >= s.start && command.time < s.start + s.duration
      )
      if (i < 0) return current
      const local = command.time - segs[i].start
      if (local < segs[i].duration * 0.5 && i > 0) i -= 1
      const a = segs[i]
      const b = segs[i + 1]
      if (!b) return current
      const duration = clamp(
        command.duration,
        0.08,
        Math.min(a.duration, b.duration) * 0.45
      )
      const faded = upsertStyle(current, a.inPoint, a.outPoint, { fadeOut: duration })
      return upsertStyle(faded, b.inPoint, b.outPoint, { fadeIn: duration })
    }
    case 'setEncoder':
      return touch({ ...current, encoder: command.encoder })
    case 'setFade': {
      const seg = resolveSegments(current).find((s) => s.id === command.targetId)
      if (seg) {
        return upsertStyle(current, seg.inPoint, seg.outPoint, {
          fadeIn: command.edge === 'in' ? command.duration : seg.fadeIn,
          fadeOut: command.edge === 'out' ? command.duration : seg.fadeOut
        })
      }
      return mapClip(current, command.targetId, (clip) => ({
        ...clip,
        fadeIn: command.edge === 'in' ? command.duration : clip.fadeIn,
        fadeOut: command.edge === 'out' ? command.duration : clip.fadeOut
      }))
    }
    case 'removeClip': {
      const insertId = slugInsertId(command.clipId)
      if (insertId) return applyCommand(current, { type: 'removeInsert', insertId })
      return touch({
        ...current,
        tracks: current.tracks.map((track) =>
          autoHideEmptyStackTrack({ ...track, clips: track.clips.filter((c) => c.id !== command.clipId) })
        )
      })
    }
    case 'duplicateClip': {
      const hit = findClip(current, command.clipId)
      if (!hit) return current
      const start = command.start ?? hit.clip.start + hit.clip.duration
      const clone: Clip = {
        ...hit.clip,
        id: uid('clip'),
        start,
        keyframes: hit.clip.keyframes.map((key) => ({ ...key, transform: { ...key.transform } })),
        transform: { ...hit.clip.transform, crop: { ...hit.clip.transform.crop } },
        style: hit.clip.style ? { ...hit.clip.style } : undefined
      }
      return touch({
        ...current,
        tracks: current.tracks.map((track) =>
          track.id === hit.track.id ? { ...track, clips: [...track.clips, clone] } : track
        )
      })
    }
    case 'pasteClip': {
      const destTrack =
        current.tracks.find((track) => track.id === (command.trackId ?? command.clip.trackId)) ??
        current.tracks.find((track) => track.type === 'overlay' && !isPrimaryLane(track) && !track.locked)
      if (!destTrack || isPrimaryLane(destTrack) || destTrack.locked) return current
      const clone: Clip = {
        ...command.clip,
        id: uid('clip'),
        start: Math.max(0, command.start),
        trackId: destTrack.id,
        keyframes: command.clip.keyframes.map((key) => ({ ...key, transform: { ...key.transform } })),
        transform: { ...command.clip.transform, crop: { ...command.clip.transform.crop } },
        style: command.clip.style ? { ...command.clip.style } : undefined
      }
      return touch({
        ...current,
        tracks: current.tracks.map((track) =>
          track.id === destTrack.id ? revealStackTrack({ ...track, clips: [...track.clips, clone] }) : track
        )
      })
    }
    case 'applyClipLook': {
      const ids = command.clipIds.filter((id) => {
        const hit = findClip(current, id)
        return Boolean(hit && !isPrimaryLane(hit.track))
      })
      if (!ids.length) return current
      return mapClips(current, ids, (clip) => applyLookToClip(clip, command.look))
    }
    case 'slipClip': {
      const found = findClip(current, command.clipId)
      if (!found || isPrimaryLane(found.track) || found.track.locked) return current
      const asset = found.clip.assetId ? current.assets[found.clip.assetId] : undefined
      const next = slippedClip(found.clip, command.delta, asset?.duration)
      return next ? mapClip(current, command.clipId, () => next) : current
    }
    case 'rollClip': {
      const found = findClip(current, command.clipId)
      if (!found || isPrimaryLane(found.track) || found.track.locked) return current
      const { prev, next } = neighborsOnTrack(found.track, found.clip.id)
      const neighbor = command.edge === 'in' ? prev : next
      const rolled = rolledPair(found.clip, neighbor, command.edge, command.time)
      if (!rolled) return current
      return replaceTrackClips(
        current,
        found.track.id,
        found.track.clips.map((clip) => {
          if (clip.id === found.clip.id) return rolled.clip
          if (rolled.neighbor && clip.id === rolled.neighbor.id) return rolled.neighbor
          return clip
        })
      )
    }
    case 'slideClip': {
      const found = findClip(current, command.clipId)
      if (!found || isPrimaryLane(found.track) || found.track.locked) return current
      const { prev, next } = neighborsOnTrack(found.track, found.clip.id)
      const slid = slidTrio(found.clip, prev, next, command.start)
      if (!slid) return current
      return replaceTrackClips(
        current,
        found.track.id,
        found.track.clips.map((clip) => {
          if (clip.id === found.clip.id) return slid.clip
          if (slid.prev && clip.id === slid.prev.id) return slid.prev
          if (slid.next && clip.id === slid.next.id) return slid.next
          return clip
        })
      )
    }
    case 'extendClip': {
      const found = findClip(current, command.clipId)
      if (!found || isPrimaryLane(found.track) || found.track.locked) return current
      const asset = found.clip.assetId ? current.assets[found.clip.assetId] : undefined
      const next = extendedClip(found.clip, command.time, asset?.duration)
      return next ? mapClip(current, command.clipId, () => next) : current
    }
    case 'nudgeClips': {
      const ids = command.clipIds.filter((id) => {
        const hit = findClip(current, id)
        return Boolean(hit && !isPrimaryLane(hit.track) && !hit.track.locked)
      })
      if (!ids.length) return current
      return mapClips(current, ids, (clip) => ({ ...clip, start: Math.max(0, clip.start + command.delta) }))
    }
    case 'removeClips': {
      const ids = command.clipIds.filter((id) => !isSlugId(id))
      const slugIds = command.clipIds.map(slugInsertId).filter((id): id is string => Boolean(id))
      let next = current
      for (const insertId of slugIds) next = applyCommand(next, { type: 'removeInsert', insertId })
      if (!ids.length) return next
      return touch({
        ...next,
        tracks: next.tracks.map((track) =>
          autoHideEmptyStackTrack({ ...track, clips: track.clips.filter((clip) => !ids.includes(clip.id)) })
        )
      })
    }
    case 'setSceneBounds': {
      const scenes = [...(current.scenes ?? [])]
      const index = scenes.findIndex((scene) => scene.id === command.sceneId)
      if (index < 0) return current
      const scene = scenes[index]
      const prev = scenes[index - 1]
      const next = scenes[index + 1]
      let start = command.start ?? scene.start
      let end = command.end ?? scene.end
      if (end <= start + 0.15) return current
      const touchingPrev = prev && Math.abs(prev.end - scene.start) < 0.08
      const touchingNext = next && Math.abs(next.start - scene.end) < 0.08
      if (touchingPrev && command.start != null) {
        scenes[index - 1] = { ...prev, end: start }
      }
      if (touchingNext && command.end != null) {
        scenes[index + 1] = { ...next, start: end }
      }
      scenes[index] = { ...scene, start, end }
      return touch({ ...current, scenes })
    }
    case 'setCanvas': {
      const width = Math.round(clamp(command.width, 320, 3840))
      const height = Math.round(clamp(command.height, 320, 3840))
      if (width === current.width && height === current.height) return current
      return touch({ ...current, width, height })
    }
    case 'applySuggestion':
      return applySuggestion(current, command.suggestionId)
    case 'applySuggestions':
      return command.suggestionIds.reduce((acc, id) => applySuggestion(acc, id), current)
    case 'applySafeSuggestions':
      return current.suggestions
        .filter(
          (s) =>
            s.safe &&
            !s.applied &&
            !s.blockedBy &&
            (s.action === 'cut' || s.action === 'normalize')
        )
        .reduce((acc, suggestion) => applySuggestion(acc, suggestion.id), current)
    case 'dismissSuggestion':
      return touch({
        ...current,
        suggestions: current.suggestions.filter((s) => s.id !== command.suggestionId)
      })
    case 'dismissSuggestions': {
      const drop = new Set(command.suggestionIds)
      if (!drop.size) return current
      const next = current.suggestions.filter((suggestion) => !drop.has(suggestion.id))
      if (next.length === current.suggestions.length) return current
      return touch({ ...current, suggestions: next })
    }
    case 'dismissPendingSuggestions': {
      const next = current.suggestions.filter((s) => s.applied)
      if (next.length === current.suggestions.length) return current
      return touch({ ...current, suggestions: next })
    }
    case 'applySuggestionsByType':
      return current.suggestions
        .filter(
          (s) =>
            s.type === command.suggestionType &&
            !s.applied &&
            !s.blockedBy &&
            (s.action === 'cut' || s.action === 'normalize' || s.action === 'speed')
        )
        .reduce((acc, suggestion) => applySuggestion(acc, suggestion.id), current)
    case 'revertSuggestion':
      return revertSuggestion(current, command.suggestionId)
    case 'revertSuggestionType':
      return revertSuggestionType(current, command.suggestionType)
    case 'addTag':
      return addTag(current, command.start, command.end, command.kind, command.label)
    case 'eraseTag':
      return eraseTag(current, command.start, command.end, command.kind)
    case 'removeTag':
      return touch({
        ...current,
        tags: (current.tags ?? []).filter((t) => t.id !== command.tagId)
      })
    case 'setMarks':
      return touch({
        ...current,
        markIn: command.markIn === undefined ? current.markIn : command.markIn,
        markOut: command.markOut === undefined ? current.markOut : command.markOut
      })
    case 'setPicture':
      return touch({ ...current, picture: { ...current.picture, ...command.transform } })
    case 'setAudioMaster':
      return touch({ ...current, audioMaster: { ...current.audioMaster, ...command.patch } })
    case 'setName':
      return touch({ ...current, name: command.name })
    case 'replaceProject':
      return touch(command.project)
    case 'setSpeaker':
      return touch({
        ...current,
        transcript: {
          ...current.transcript,
          words: current.transcript.words.map((w) =>
            command.wordIds.includes(w.id) ? { ...w, speaker: command.speakerId } : w
          )
        }
      })
    case 'addSpeaker': {
      const colors = [...speakerPalette()]
      const id = uid('spk')
      const speaker = {
        id,
        name: command.name?.trim() || `Speaker ${current.transcript.speakers.length + 1}`,
        color: colors[current.transcript.speakers.length % colors.length]
      }
      return touch({
        ...current,
        transcript: {
          ...current.transcript,
          speakers: [...current.transcript.speakers, speaker]
        }
      })
    }
    case 'renameSpeaker':
      return touch({
        ...current,
        transcript: {
          ...current.transcript,
          speakers: current.transcript.speakers.map((s) =>
            s.id === command.speakerId ? { ...s, name: command.name } : s
          )
        }
      })
    case 'renameScene': {
      const scenes = current.scenes.map((scene) => {
        if (scene.id !== command.sceneId) return scene
        const title = command.title !== undefined ? command.title.trim() || scene.title : scene.title
        const summary = command.summary !== undefined ? command.summary : scene.summary
        if (title === scene.title && summary === scene.summary) return scene
        return { ...scene, title, summary }
      })
      if (scenes.every((scene, i) => scene === current.scenes[i])) return current
      return touch({ ...current, scenes })
    }
    case 'splitScene': {
      const scenes = [...(current.scenes ?? [])]
      const index = scenes.findIndex((scene) => scene.id === command.sceneId)
      if (index < 0) return current
      const scene = scenes[index]
      if (command.time <= scene.start + 0.15 || command.time >= scene.end - 0.15) return current
      scenes.splice(index, 1, { ...scene, end: command.time }, {
        ...scene,
        id: uid('scene'),
        start: command.time,
        title: `${scene.title} (cont.)`,
        takeOf: undefined,
        takeIndex: undefined
      })
      return touch({ ...current, scenes: normalizeScenes(scenes) })
    }
    case 'mergeScenes': {
      const scenes = [...(current.scenes ?? [])]
      const a = scenes.find((scene) => scene.id === command.sceneId)
      const b = scenes.find((scene) => scene.id === command.otherId)
      if (!a || !b) return current
      const lo = a.start <= b.start ? a : b
      const hi = lo === a ? b : a
      const merged = {
        ...lo,
        end: Math.max(a.end, b.end),
        summary: [lo.summary, hi.summary].filter(Boolean).join(' ')
      }
      return touch({
        ...current,
        scenes: normalizeScenes(scenes.filter((scene) => scene.id !== a.id && scene.id !== b.id).concat(merged))
      })
    }
    case 'rebuildSuggestions':
      return rebuildSuggestionList(current)
    case 'setTranscript': {
      const words = current.cuts.reduce(
        (list, cut) => stampWords(list, cut.start, cut.end, true),
        command.words
      )
      const next = {
        ...current,
        transcript: { ...current.transcript, words }
      }
      return rebuildSuggestionList(applyDiarization(next))
    }
    case 'cutSentence': {
      const span = sentenceRange(current.transcript.words, command.wordId)
      if (!span) return current
      return deleteSourceRange(current, span.start, span.end, 'transcript')
    }
    case 'cutPreviousSentence': {
      const span = previousSentenceRange(current.transcript.words, command.wordId)
      if (!span) return current
      return deleteSourceRange(current, span.start, span.end, 'transcript')
    }
    case 'tightenRange':
      return tightenRange(current, command.start, command.end)
    case 'setScenes':
      return touch({ ...current, scenes: normalizeScenes(command.scenes) })
    case 'mergeIntelligence': {
      const incoming = command.suggestions ?? []
      const scenes = command.scenes ? normalizeScenes(command.scenes) : current.scenes
      const keep = current.suggestions.filter((s) => {
        if (s.applied) return true
        if (s.type === 'model' && incoming.some((n) => n.type === 'model' && overlap(n, s) > (s.end - s.start) * 0.6)) {
          return false
        }
        if (s.type === 'repeat' && incoming.some((n) => n.type === 'repeat' && overlap(n, s) > (s.end - s.start) * 0.6)) {
          return false
        }
        return true
      })
      const fresh = incoming.filter(
        (s) =>
          !keep.some((k) => k.type === s.type && overlap(k, s) > (s.end - s.start) * 0.6)
      )
      const merged = [...keep, ...fresh]
      return touch({
        ...current,
        scenes,
        suggestions: [...merged, ...suggestionsFromScenes(scenes, merged)]
      })
    }
    case 'inferScenes': {
      const draft = inferScenesLocal(current)
      return applyCommand(current, {
        type: 'mergeIntelligence',
        scenes: draft.scenes,
        suggestions: draft.suggestions
      })
    }
    case 'rebuildIntelligence': {
      const applied = current.suggestions.filter((s) => s.applied)
      const fresh = buildSuggestions({
        duration: current.sourceDuration,
        silence: current.analysis.silence,
        sceneHits: current.analysis.staticRegions,
        loudnessWindows: current.analysis.loudness,
        words: current.transcript.words,
        margin: current.cutMargin
      }).filter((s) => !applied.some((a) => overlap(a, s) > (s.end - s.start) * 0.6))
      const draft = inferScenesLocal({ ...current, suggestions: [...applied, ...fresh] })
      return touch({
        ...current,
        scenes: draft.scenes,
        suggestions: [...applied, ...fresh, ...draft.suggestions]
      })
    }
    case 'collapseRetakes': {
      const ranges = retakeRanges(current)
      let next = current
      for (const span of ranges) {
        const already = next.cuts.some((c) => overlap(c, span) > (span.end - span.start) * 0.7)
        if (already) continue
        const pieces = cutMinusProtected(span, next.tags ?? [])
        next = pieces.reduce((acc, piece) => deleteSourceRange(acc, piece.start, piece.end, 'repeat'), next)
      }
      const leftovers = next.suggestions.filter((s) => s.type === 'repeat' && !s.applied && !s.blockedBy)
      return leftovers.reduce((acc, suggestion) => applySuggestion(acc, suggestion.id), next)
    }
    case 'keepTake': {
      const scene = current.scenes.find((s) => s.id === command.sceneId)
      if (!scene) return current
      const family = takeFamily(current.scenes, scene.id)
      let next = current
      for (const sibling of family) {
        if (sibling.id === scene.id) continue
        next = applyCommand(next, commandForScene(next, sibling, 'apply'))
      }
      return next
    }
    case 'revertAt': {
      const hit = coveringAppliedSuggestion(current, command.start, command.end)
      if (hit) return revertSuggestion(current, hit.id)
      return restoreSourceRange(current, command.start, command.end)
    }
    case 'applyModelSuggestions':
      return current.suggestions
        .filter((s) => s.type === 'model' && !s.applied && !s.blockedBy && s.action === 'cut')
        .reduce((acc, suggestion) => applySuggestion(acc, suggestion.id), current)
    case 'setTrackFlag': {
      const soloOn = command.patch.solo === true
      return touch({
        ...current,
        tracks: current.tracks.map((track) => {
          if (track.id === command.trackId) return { ...track, ...command.patch }
          if (soloOn) return { ...track, solo: false }
          return track
        })
      })
    }
    case 'relinkAsset': {
      const asset = current.assets[command.assetId]
      if (!asset || asset.path === command.path) return current
      return touch({
        ...current,
        assets: {
          ...current.assets,
          [command.assetId]: {
            ...asset,
            path: command.path,
            proxyPath: undefined,
            waveform: [],
            thumbnails: undefined,
            codec: undefined,
            vfr: undefined
          }
        }
      })
    }
    case 'appendTake': {
      const offset = current.sourceDuration
      if (!command.asset.path) return current
      const asset: Asset = { ...command.asset, sourceOffset: offset }
      const shift = <T extends Interval>(row: T): T => ({ ...row, start: row.start + offset, end: row.end + offset })
      const extra = command.analysis ?? { silence: [], staticRegions: [], loudness: [] }
      const words = [
        ...current.transcript.words,
        ...command.words.map((word) => ({
          ...word,
          id: word.id || uid('w'),
          start: word.start + offset,
          end: word.end + offset
        }))
      ]
      const merged = touch({
        ...current,
        sourceDuration: offset + Math.max(0.01, asset.duration),
        assets: { ...current.assets, [asset.id]: asset },
        transcript: { ...current.transcript, words },
        analysis: {
          silence: [...current.analysis.silence, ...extra.silence.map(shift)],
          staticRegions: [...current.analysis.staticRegions, ...extra.staticRegions.map(shift)],
          loudness: [...current.analysis.loudness, ...extra.loudness.map(shift)]
        }
      })
      return applyCommand(merged, { type: 'rebuildIntelligence' })
    }
    case 'attachTakeIntel': {
      const asset = current.assets[command.assetId]
      if (!asset) return current
      const offset = sourceOffsetOf(asset)
      const end = offset + Math.max(0.01, asset.duration)
      const span = { start: offset, end }
      const shift = <T extends Interval>(row: T): T => ({ ...row, start: row.start + offset, end: row.end + offset })
      let next = current
      if (command.analysis) {
        const extra = command.analysis
        if (extra.silence.length || extra.staticRegions.length || extra.loudness.length) {
          const outside = <T extends Interval>(row: T) => overlap(row, span) <= 0
          next = touch({
            ...next,
            analysis: {
              silence: [...next.analysis.silence.filter(outside), ...extra.silence.map(shift)],
              staticRegions: [
                ...next.analysis.staticRegions.filter(outside),
                ...extra.staticRegions.map(shift)
              ],
              loudness: [...next.analysis.loudness.filter(outside), ...extra.loudness.map(shift)]
            }
          })
        }
      }
      if (command.words?.length) {
        const inRange = next.transcript.words.filter((word) => overlap(word, span) > 0)
        const incoming = command.words.map((word) => ({
          ...word,
          id: word.id || uid('w'),
          start: word.start + offset,
          end: word.end + offset
        }))
        if (takeWordsNeedReplace(inRange, incoming)) {
          const words = [
            ...next.transcript.words.filter((word) => overlap(word, span) <= 0),
            ...incoming
          ]
          next = applyCommand(next, { type: 'setTranscript', words })
        }
      }
      if (command.whispered && hasProviderSpeakers(command.whispered)) {
        next = applyCommand(next, {
          type: 'applyDiarization',
          assignments: assignmentsFromCues(command.whispered).map((row) => ({
            ...row,
            start: row.start + offset,
            end: row.end + offset
          }))
        })
      }
      if (next === current) return current
      if (command.analysis && !command.words?.length) {
        return applyCommand(next, { type: 'rebuildIntelligence' })
      }
      return next
    }
    case 'setAssetProxy': {
      const asset = current.assets[command.assetId]
      if (!asset) return current
      const proxyPath = command.proxyPath || undefined
      if (asset.proxyPath === proxyPath) return current
      return touch({
        ...current,
        assets: {
          ...current.assets,
          [command.assetId]: { ...asset, proxyPath }
        }
      })
    }
    case 'setAssetLooks': {
      const asset = current.assets[command.assetId]
      if (!asset) return current
      const proxyPath = command.proxyPath === undefined ? asset.proxyPath : command.proxyPath || undefined
      const waveform = command.waveform ?? asset.waveform
      const thumbnails = command.thumbnails === undefined ? asset.thumbnails : command.thumbnails
      if (asset.proxyPath === proxyPath && asset.waveform === waveform && asset.thumbnails === thumbnails) {
        return current
      }
      return touch({
        ...current,
        assets: {
          ...current.assets,
          [command.assetId]: { ...asset, proxyPath, waveform, thumbnails }
        }
      })
    }
    case 'setAnalysis': {
      const analysis = {
        silence: command.silence ?? current.analysis.silence,
        staticRegions: command.staticRegions ?? current.analysis.staticRegions,
        loudness: command.loudness ?? current.analysis.loudness
      }
      if (
        analysis.silence === current.analysis.silence &&
        analysis.staticRegions === current.analysis.staticRegions &&
        analysis.loudness === current.analysis.loudness
      ) {
        return current
      }
      return applyCommand(touch({ ...current, analysis }), { type: 'rebuildIntelligence' })
    }
    default:
      return current
  }
}

export function primarySegments(project: Project): Clip[] {
  return asVideoClips(normalizeProject(project))
}

export function programLength(project: Project): number {
  return programLengthOf(normalizeProject(project))
}

export { segmentId }
