import type { Project } from '../types'
import { programLength } from './commands'
import { formatClock } from './time'

export interface AgentContext {
  name: string
  fps: number
  sourceDuration: number
  programDuration: number
  liveWords: number
  cuts: number
  openSuggestions: number
  appliedSuggestions: number
  tags: { id: string; kind: string; start: number; end: number; label: string }[]
  scenes: { id: string; start: number; end: number; title: string; kind: string; takeOf?: string; summary: string }[]
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
  transcript: string
  words: { id: string; start: number; end: number; text: string; speaker: string; deleted: boolean }[]
  overlays: { id: string; start: number; duration: number; text?: string; track: string }[]
}

export function buildAgentContext(project: Project): AgentContext {
  const words = project.transcript.words.map((w) => ({
    id: w.id,
    start: Number(w.start.toFixed(3)),
    end: Number(w.end.toFixed(3)),
    text: w.text,
    speaker: w.speaker,
    deleted: w.deleted
  }))
  const transcript = words
    .map((w, i) => {
      const prev = words[i - 1]
      const gap = prev && w.start - prev.end > 0.45 ? ` [${(w.start - prev.end).toFixed(1)}s] ` : ' '
      const mark = w.deleted ? `~~${w.text}~~` : w.text
      return `${i === 0 ? '' : gap}${mark}`
    })
    .join('')
    .trim()
  return {
    name: project.name,
    fps: project.fps,
    sourceDuration: project.sourceDuration,
    programDuration: programLength(project),
    liveWords: words.filter((w) => !w.deleted).length,
    cuts: project.cuts.length,
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

export function renderAgentBrief(project: Project): string {
  const ctx = buildAgentContext(project)
  const sceneLines = ctx.scenes
    .map(
      (s) =>
        `- ${s.title} (${formatClock(s.start)}–${formatClock(s.end)}) ${s.kind}${s.takeOf ? ` retake of ${s.takeOf}` : ''}: ${s.summary}`
    )
    .join('\n')
  const tagLines = ctx.tags
    .map((t) => `- ${t.kind} ${formatClock(t.start)}–${formatClock(t.end)} ${t.label}`)
    .join('\n')
  const open = ctx.suggestions
    .filter((s) => !s.applied)
    .map((s) => {
      const guard = s.blockedBy ? ctx.tags.find((t) => t.id === s.blockedBy) : undefined
      const stamp = guard ? ` [blocked by ${guard.label || guard.kind}]` : ''
      return `- ${s.id} ${s.type} ${s.action} ${formatClock(s.start)}–${formatClock(s.end)} ${s.label}${stamp}`
    })
    .join('\n')
  return [
    `Reel: ${ctx.name}`,
    `Source ${formatClock(ctx.sourceDuration)} → program ${formatClock(ctx.programDuration)} · ${ctx.liveWords} live words · ${ctx.cuts} cuts`,
    `Guards:\n${tagLines || '- none'}`,
    `Scenes:\n${sceneLines || '- none yet'}`,
    `Open suggestions:\n${open || '- none'}`,
    `Transcript (~~cut~~, [gaps]):\n${ctx.transcript}`
  ].join('\n\n')
}
