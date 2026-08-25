import type { Project } from '../types'
import { programLength } from './commands'
import { programToSourceOf, sourceToProgramOf } from './resolver'
import { formatClock } from './time'

export interface EditorSession {
  selectedWordIds: string[]
  selectedClipId: string | null
  selectedSuggestionId: string | null
  programTime: number
}

export const EMPTY_SESSION: EditorSession = {
  selectedWordIds: [],
  selectedClipId: null,
  selectedSuggestionId: null,
  programTime: 0
}

export interface AgentContext {
  name: string
  fps: number
  sourceDuration: number
  programDuration: number
  liveWords: number
  cuts: {
    id: string
    start: number
    end: number
    source: string
    programStart: number
    programEnd: number
  }[]
  speakers: { id: string; name: string }[]
  openSuggestions: number
  appliedSuggestions: number
  tags: { id: string; kind: string; start: number; end: number; label: string }[]
  scenes: {
    id: string
    start: number
    end: number
    title: string
    kind: string
    takeOf?: string
    takeIndex?: number
    summary: string
  }[]
  suggestions: {
    id: string
    type: string
    action: string
    start: number
    end: number
    label: string
    safe: boolean
    applied: boolean
    blockedBy?: string
  }[]
  marks: { markIn: number | null; markOut: number | null; sourceIn: number | null; sourceOut: number | null }
  playhead: { program: number; source: number }
  selection: {
    wordIds: string[]
    words: { id: string; text: string; start: number; end: number; speaker: string; deleted: boolean }[]
    clipId: string | null
    clip: { id: string; start: number; duration: number; text?: string; track: string } | null
    suggestionId: string | null
  }
  transcript: string
  words: { id: string; start: number; end: number; text: string; speaker: string; speakerName: string; deleted: boolean }[]
  overlays: { id: string; start: number; duration: number; text?: string; track: string }[]
}

function speakerName(project: Project, id: string): string {
  return project.transcript.speakers.find((s) => s.id === id)?.name ?? id
}

function resolveClip(project: Project, clipId: string | null) {
  if (!clipId) return null
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip) {
      return { id: clip.id, start: clip.start, duration: clip.duration, text: clip.text, track: track.name }
    }
  }
  return null
}

export function compactSnapshot(project: Project) {
  return {
    id: project.id,
    name: project.name,
    fps: project.fps,
    width: project.width,
    height: project.height,
    sourceDuration: project.sourceDuration,
    programDuration: programLength(project),
    assets: Object.values(project.assets).map((asset) => ({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      duration: asset.duration,
      path: asset.path
    })),
    tracks: project.tracks.map((track) => ({
      id: track.id,
      type: track.type,
      name: track.name,
      clips: track.clips.map((clip) => ({
        id: clip.id,
        start: clip.start,
        duration: clip.duration,
        text: clip.text,
        assetId: clip.assetId
      }))
    })),
    transcript: {
      speakers: project.transcript.speakers,
      words: project.transcript.words
    },
    cuts: project.cuts,
    splits: project.splits ?? [],
    suggestions: project.suggestions,
    scenes: project.scenes ?? [],
    tags: project.tags ?? [],
    markIn: project.markIn,
    markOut: project.markOut,
    cutMargin: project.cutMargin,
    audioMaster: project.audioMaster
  }
}

export function buildAgentContext(project: Project, session: EditorSession = EMPTY_SESSION): AgentContext {
  const names = new Map(project.transcript.speakers.map((s) => [s.id, s.name]))
  const words = project.transcript.words.map((w) => ({
    id: w.id,
    start: Number(w.start.toFixed(3)),
    end: Number(w.end.toFixed(3)),
    text: w.text,
    speaker: w.speaker,
    speakerName: names.get(w.speaker) ?? w.speaker,
    deleted: w.deleted
  }))
  const selected = words.filter((w) => session.selectedWordIds.includes(w.id))
  const transcript = words
    .map((w, i) => {
      const prev = words[i - 1]
      const gap = prev && w.start - prev.end > 0.45 ? ` [${(w.start - prev.end).toFixed(1)}s] ` : ' '
      const mark = w.deleted ? `~~${w.text}~~` : w.text
      return `${i === 0 ? '' : gap}${mark}`
    })
    .join('')
    .trim()
  const program = session.programTime
  const sourceIn = project.markIn == null ? null : programToSourceOf(project, project.markIn)
  const sourceOut = project.markOut == null ? null : programToSourceOf(project, project.markOut)
  return {
    name: project.name,
    fps: project.fps,
    sourceDuration: project.sourceDuration,
    programDuration: programLength(project),
    liveWords: words.filter((w) => !w.deleted).length,
    cuts: project.cuts.map((cut) => ({
      id: cut.id,
      start: cut.start,
      end: cut.end,
      source: cut.source,
      programStart: sourceToProgramOf(project, cut.start),
      programEnd: sourceToProgramOf(project, cut.end)
    })),
    speakers: project.transcript.speakers.map((s) => ({ id: s.id, name: s.name })),
    openSuggestions: project.suggestions.filter((s) => !s.applied).length,
    appliedSuggestions: project.suggestions.filter((s) => s.applied).length,
    tags: (project.tags ?? []).map((t) => ({
      id: t.id,
      kind: t.kind,
      start: t.start,
      end: t.end,
      label: t.label
    })),
    scenes: (project.scenes ?? []).map((s) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      title: s.title,
      kind: s.kind,
      takeOf: s.takeOf,
      takeIndex: s.takeIndex,
      summary: s.summary
    })),
    suggestions: project.suggestions.map((s) => ({
      id: s.id,
      type: s.type,
      action: s.action,
      start: s.start,
      end: s.end,
      label: s.label,
      safe: s.safe,
      applied: s.applied,
      blockedBy: s.blockedBy
    })),
    marks: {
      markIn: project.markIn,
      markOut: project.markOut,
      sourceIn,
      sourceOut
    },
    playhead: {
      program,
      source: programToSourceOf(project, program)
    },
    selection: {
      wordIds: session.selectedWordIds,
      words: selected,
      clipId: session.selectedClipId,
      clip: resolveClip(project, session.selectedClipId),
      suggestionId: session.selectedSuggestionId
    },
    transcript,
    words,
    overlays: project.tracks
      .filter((t) => t.type === 'overlay' || t.type === 'caption' || (t.type === 'audio' && t.id !== 'a1'))
      .flatMap((t) =>
        t.clips.map((c) => ({
          id: c.id,
          start: c.start,
          duration: c.duration,
          text: c.text,
          track: t.name
        }))
      )
  }
}

export function renderAgentBrief(project: Project, session: EditorSession = EMPTY_SESSION): string {
  const ctx = buildAgentContext(project, session)
  const sceneLines = ctx.scenes
    .map(
      (s) =>
        `- ${s.title} (${formatClock(s.start)}–${formatClock(s.end)}) ${s.kind}${s.takeIndex ? ` take ${s.takeIndex}` : ''}${s.takeOf ? ` retake of ${s.takeOf}` : ''}: ${s.summary}`
    )
    .join('\n')
  const tagLines = ctx.tags
    .map((t) => `- ${t.kind} ${formatClock(t.start)}–${formatClock(t.end)} ${t.label}`)
    .join('\n')
  const open = ctx.suggestions
    .filter((s) => !s.applied)
    .map((s) => {
      const guard = s.blockedBy ? ctx.tags.find((t) => t.id === s.blockedBy) : undefined
      const stamp = guard ? ` [blocked by ${guard.label || guard.kind}]` : s.blockedBy ? ' [protected]' : ''
      return `- ${s.id} ${s.type} ${s.action} ${formatClock(s.start)}–${formatClock(s.end)} ${s.label}${stamp}`
    })
    .join('\n')
  const selected =
    ctx.selection.words.length > 0
      ? ctx.selection.words.map((w) => w.text).join(' ')
      : ctx.selection.clip
        ? `${ctx.selection.clip.track} ${ctx.selection.clip.id}`
        : 'none'
  return [
    `Reel: ${ctx.name}`,
    `Source ${formatClock(ctx.sourceDuration)} → program ${formatClock(ctx.programDuration)} · ${ctx.liveWords} live words · ${ctx.cuts.length} cuts`,
    `Playhead program ${formatClock(ctx.playhead.program)} / source ${formatClock(ctx.playhead.source)}`,
    `I/O source ${ctx.marks.sourceIn == null ? '—' : formatClock(ctx.marks.sourceIn)}–${ctx.marks.sourceOut == null ? '—' : formatClock(ctx.marks.sourceOut)}`,
    `Selected: ${selected}`,
    `Speakers: ${ctx.speakers.map((s) => s.name).join(', ') || 'none'}`,
    `Guards:\n${tagLines || '- none'}`,
    `Scenes:\n${sceneLines || '- none yet'}`,
    `Open suggestions:\n${open || '- none'}`,
    `Transcript (~~cut~~, [gaps]):\n${ctx.transcript}`
  ].join('\n\n')
}
