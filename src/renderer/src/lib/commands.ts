import {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_TRANSFORM,
  emptyClipFields,
  type Clip,
  type Command,
  type Cut,
  type Project,
  type SegmentStyle,
  type SuggestionType,
  type TagKind,
  type Track,
  type TrackType,
  type Transform
} from '../types'
import { buildSuggestions, cutMinusProtected, suggestionsFromSilence } from './analysis'
import { inferScenesLocal, retakeRanges } from './sceneAnalysis'
import { previousSentenceRange, sentenceRange } from './transcriptEdit'
import {
  clamp,
  mergeIntervals,
  overlap,
  projectKept,
  shiftProgramClips,
  sourceToProgram
} from './edl'
import { normalizeProject } from './normalize'
import {
  asVideoClips,
  programLengthOf,
  programToSourceOf,
  resolveSegments,
  segmentId,
  sourceToProgramOf
} from './resolver'
import { uid } from './time'

function touch(project: Project): Project {
  return normalizeProject({ ...project, updatedAt: Date.now() })
}

function overlayTracks(project: Project): Track[] {
  return project.tracks.filter((t) => t.type === 'overlay' || t.type === 'caption')
}

export function isPrimaryLane(track: Track): boolean {
  return track.type === 'video' || track.id === 'a1'
}

function shiftOverlays(project: Project, afterProgram: number, delta: number): Track[] {
  return project.tracks.map((track) => {
    if (isPrimaryLane(track)) return track
    return { ...track, clips: shiftProgramClips(track.clips, afterProgram, delta) }
  })
}

function markWords(project: Project, start: number, end: number, deleted: boolean): Project {
  return {
    ...project,
    transcript: {
      ...project.transcript,
      words: project.transcript.words.map((word) =>
        overlap(word, { start, end }) > 0 ? { ...word, deleted } : word
      )
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
  source: Cut['source']
): Project {
  const lo = clamp(Math.min(start, end), 0, project.sourceDuration || end)
  const hi = clamp(Math.max(start, end), 0, project.sourceDuration || end)
  if (hi - lo < 0.03) return project

  const before = projectKept(project)
  const removed = before.reduce((sum, span) => sum + overlap(span, { start: lo, end: hi }), 0)
  const programStart = sourceToProgram(lo, before)

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
    tracks: shiftOverlays(next, programStart, -removed),
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
  const before = projectKept(project)
  const programStart = sourceToProgram(lo, before)

  let next: Project = {
    ...project,
    cuts: subtractFromCuts(project.cuts, lo, hi),
    transcript: {
      ...project.transcript,
      words: project.transcript.words.map((word) =>
        overlap(word, { start: lo, end: hi }) > 0 ? { ...word, deleted: false } : word
      )
    },
    suggestions: project.suggestions.map((s) =>
      overlap(s, { start: lo, end: hi }) > s.end - s.start - 0.05 ? { ...s, applied: false } : s
    )
  }

  const after = projectKept(next)
  const added = after.reduce((sum, span) => sum + overlap(span, { start: lo, end: hi }), 0)
  next = { ...next, tracks: shiftOverlays(next, programStart, added) }
  return touch(next)
}

function toggleWords(project: Project, wordIds: string[]): Project {
  const selected = project.transcript.words.filter((w) => wordIds.includes(w.id))
  if (!selected.length) return project
  const start = Math.min(...selected.map((w) => w.start))
  const end = Math.max(...selected.map((w) => w.end))
  const shouldDelete = selected.some((w) => !w.deleted)
  return shouldDelete
    ? deleteSourceRange(project, start, end, 'transcript')
    : restoreSourceRange(project, start, end)
}

function findClip(project: Project, clipId: string): { track: Track; clip: Clip } | undefined {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip) return { track, clip }
  }
  return undefined
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
  if (suggestion.action === 'review') return project
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
  const pieces = cutMinusProtected(suggestion, project.tags ?? [])
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
    const pieces = cutMinusProtected(gap, acc.tags ?? [])
    return pieces.reduce((next, piece) => deleteSourceRange(next, piece.start, piece.end, 'silence'), acc)
  }, project)
}

const TAG_LABELS: Record<TagKind, string> = {
  keep: 'Keep · auto-edit skips this',
  demo: 'Demo · silent walkthrough',
  note: 'Note'
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
  return touch({
    ...project,
    tags: [...existing.filter((t) => !mergeable.some((m) => m.id === t.id)), tag]
  })
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
  const clip: Clip = {
    id: uid('clip'),
    trackId: track.id,
    start,
    duration,
    inPoint: 0,
    outPoint: duration,
    transform: { ...DEFAULT_TRANSFORM },
    volume: 1,
    muted: false,
    speed: 1,
    text,
    style: { ...DEFAULT_CAPTION_STYLE },
    ...emptyClipFields(),
    ...extra
  }
  return touch({
    ...project,
    tracks: project.tracks.map((t) => (t.id === track.id ? { ...t, clips: [...t.clips, clip] } : t))
  })
}

export function applyCommand(project: Project, command: Command): Project {
  const current = normalizeProject(project)
  switch (command.type) {
    case 'deleteRange':
      return deleteSourceRange(current, command.start, command.end, command.source ?? 'manual')
    case 'restoreRange':
      return restoreSourceRange(current, command.start, command.end)
    case 'toggleWords':
      return toggleWords(current, command.wordIds)
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
    case 'rippleDelete':
      return deleteSourceRange(current, command.start, command.end, 'manual')
    case 'rippleDeleteMarks': {
      if (current.markIn == null || current.markOut == null) return current
      const start = Math.min(current.markIn, current.markOut)
      const end = Math.max(current.markIn, current.markOut)
      return applyCommand(
        { ...current, markIn: null, markOut: null },
        {
          type: 'deleteRange',
          start: programToSourceOf(current, start),
          end: programToSourceOf(current, end),
          source: 'manual'
        }
      )
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
          if (track.type !== 'overlay' && track.type !== 'caption') return track
          const clips: Clip[] = []
          for (const clip of track.clips) {
            const end = clip.start + clip.duration
            if (program > clip.start + 0.05 && program < end - 0.05) {
              const leftDur = program - clip.start
              clips.push({ ...clip, duration: leftDur, outPoint: clip.inPoint + leftDur })
              clips.push({
                ...clip,
                id: uid('clip'),
                start: program,
                duration: end - program,
                inPoint: clip.inPoint + leftDur
              })
            } else {
              clips.push(clip)
            }
          }
          return { ...track, clips }
        })
      })
    }
    case 'moveClip': {
      const found = findClip(current, command.clipId)
      if (!found) return current
      const destTrack = command.trackId ?? found.clip.trackId
      const moved: Clip = {
        ...found.clip,
        start: Math.max(0, command.start),
        trackId: destTrack
      }
      return touch({
        ...current,
        tracks: current.tracks.map((track) => {
          const without = track.clips.filter((c) => c.id !== command.clipId)
          if (track.id !== destTrack) return { ...track, clips: without }
          return { ...track, clips: [...without, moved] }
        })
      })
    }
    case 'trimClip':
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
    case 'trimPrimary': {
      const seg = resolveSegments(current).find((s) => s.id === command.segmentId)
      if (!seg) return current
      if (command.edge === 'in') {
        const next = clamp(command.sourceTime, seg.inPoint, seg.outPoint - 0.05)
        return deleteSourceRange(current, seg.inPoint, next, 'manual')
      }
      const next = clamp(command.sourceTime, seg.inPoint + 0.05, seg.outPoint)
      return deleteSourceRange(current, next, seg.outPoint, 'manual')
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
      return upsertStyle({ ...current, splits }, command.start, command.end, {
        speed: clamp(command.speed, 0.25, 8)
      })
    }
    case 'setText':
      return mapClip(current, command.clipId, (clip) => ({ ...clip, text: command.text }))
    case 'setCaptionStyle':
      return mapClip(current, command.clipId, (clip) => ({
        ...clip,
        style: { ...DEFAULT_CAPTION_STYLE, ...clip.style, ...command.style }
      }))
    case 'addCaption':
      return newGraphic(current, 'caption', command.start, command.duration, command.text)
    case 'addOverlay':
      return newGraphic(current, 'overlay', command.start, command.duration, command.text)
    case 'addZoom':
      return newGraphic(current, 'overlay', command.start, command.duration, 'ZOOM', {
        transform: { ...DEFAULT_TRANSFORM, scale: command.scale }
      })
    case 'addBroll': {
      const withAsset = {
        ...current,
        assets: { ...current.assets, [command.asset.id]: command.asset }
      }
      return newGraphic(withAsset, 'overlay', command.start, command.duration, command.asset.name, {
        assetId: command.asset.id
      })
    }
    case 'addAudio': {
      let next = current.tracks.some((t) => t.type === 'audio' && t.id !== 'a1')
        ? current
        : applyCommand(current, { type: 'addTrack', trackType: 'audio', name: 'A2 Music' })
      const track = next.tracks.find((t) => t.type === 'audio' && t.id !== 'a1')
      if (!track) return current
      const clip: Clip = {
        id: uid('clip'),
        trackId: track.id,
        assetId: command.asset.id,
        start: command.start,
        duration: command.duration,
        inPoint: 0,
        outPoint: command.duration,
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
    case 'setCutMargin': {
      const margin = clamp(command.margin, 0, 0.45)
      const raw = current.analysis?.silence ?? []
      const silence = (raw.length ? suggestionsFromSilence(raw, margin, current.analysis.staticRegions) : []).filter(
        (s) => !current.cuts.some((cut) => overlap(cut, s) > (s.end - s.start) * 0.8)
      )
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
    case 'removeClip':
      return touch({
        ...current,
        tracks: current.tracks.map((track) => ({
          ...track,
          clips: track.clips.filter((c) => c.id !== command.clipId)
        }))
      })
    case 'applySuggestion':
      return applySuggestion(current, command.suggestionId)
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
      const colors = ['#C4452D', '#2F6F8F', '#3d7a52', '#8a5a32', '#6b4c9a', '#b4532a']
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
    case 'rebuildSuggestions': {
      const applied = current.suggestions.filter((s) => s.applied)
      const fresh = buildSuggestions({
        duration: current.sourceDuration,
        silence: current.analysis.silence,
        sceneHits: current.analysis.staticRegions,
        loudnessWindows: current.analysis.loudness,
        words: current.transcript.words,
        margin: current.cutMargin
      }).filter(
        (s) => !applied.some((a) => overlap(a, s) > (s.end - s.start) * 0.6)
      )
      return touch({ ...current, suggestions: [...applied, ...fresh] })
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
      return touch({ ...current, scenes: command.scenes })
    case 'mergeIntelligence': {
      const incoming = command.suggestions ?? []
      const keep = current.suggestions.filter(
        (s) =>
          s.applied ||
          s.type !== 'model' ||
          incoming.some((n) => overlap(n, s) > (s.end - s.start) * 0.6)
      )
      const fresh = incoming.filter(
        (s) =>
          !keep.some((k) => k.type === 'model' && overlap(k, s) > (s.end - s.start) * 0.6)
      )
      return touch({
        ...current,
        scenes: command.scenes ?? current.scenes,
        suggestions: [...keep, ...fresh]
      })
    }
    case 'revertAt': {
      const span = { start: command.start, end: command.end }
      const hit = current.suggestions
        .filter((s) => s.applied && s.action !== 'normalize' && overlap(s, span) > 0.02)
        .sort((a, b) => {
          const cover = (s: typeof a) => overlap(s, span) / Math.max(0.01, s.end - s.start)
          return cover(b) - cover(a)
        })[0]
      if (hit) return revertSuggestion(current, hit.id)
      return restoreSourceRange(current, command.start, command.end)
    }
    case 'inferScenes': {
      const draft = inferScenesLocal(current)
      return applyCommand(current, {
        type: 'mergeIntelligence',
        scenes: draft.scenes,
        suggestions: draft.suggestions
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
      const leftovers = next.suggestions.filter((s) => s.type === 'repeat' && !s.applied)
      next = leftovers.reduce((acc, suggestion) => applySuggestion(acc, suggestion.id), next)
      return touch(next)
    }
    case 'applyModelSuggestions':
      return current.suggestions
        .filter((s) => s.type === 'model' && !s.applied && !s.blockedBy && s.action === 'cut')
        .reduce((acc, suggestion) => applySuggestion(acc, suggestion.id), current)
    case 'setTrackFlag':
      return touch({
        ...current,
        tracks: current.tracks.map((track) =>
          track.id === command.trackId ? { ...track, ...command.patch } : track
        )
      })
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
