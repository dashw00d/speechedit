import type { EditSuggestion, Project, RangeTag } from '../types'
import { leftoverKind } from './analysis'
import { sourceToProgramOf } from './resolver'

export type EditBlockKind =
  | 'keep'
  | 'demo'
  | 'note'
  | 'suggestion-applied'
  | 'suggestion-pending'
  | 'suggestion-blocked'
  | 'scene'

export type EditBlockFilter = 'all' | 'applied' | 'pending' | 'scenes' | 'guards' | 'notes'

export interface EditBlock {
  id: string
  kind: EditBlockKind
  start: number
  end: number
  label: string
  detail: string
  suggestionId?: string
  tagId?: string
  sceneId?: string
  suggestionType?: EditSuggestion['type']
  safe?: boolean
}

function suggestionDetail(s: EditSuggestion): string {
  if (s.applied) return `${s.label} · applied · click to review`
  if (s.blockedBy) return `${s.label} · protected — Auto Edit skips this`
  if (s.safe) return `${s.label} · safe to apply`
  return `${s.label} · needs review`
}

function suggestionLaneLabel(s: EditSuggestion): string {
  if (s.applied) return 'Cut'
  const leftover = leftoverKind(s)
  if (leftover === 'activity') return 'Activity'
  if (leftover === 'still') return 'Still'
  if (leftover === 'breath') return 'Breath'
  if (leftover === 'static') return 'Static'
  if (leftover === 'low-motion') return 'Talking'
  if (leftover === 'loud') return 'Hot'
  if (s.type === 'silence') return 'Pause'
  if (s.type === 'filler') return 'Filler'
  if (s.type === 'repeat') return 'Retake'
  if (s.type === 'loud') return 'Loud'
  return s.type
}

function sceneLaneLabel(scene: { title: string; kind: string; takeIndex?: number }): string {
  if (scene.takeIndex) return `Take ${scene.takeIndex}`
  if (scene.kind === 'demo') return 'Demo'
  if (scene.kind === 'retake') return 'Retake'
  const word = scene.title.trim().split(/\s+/)[0]
  return word || 'Scene'
}

function tagDetail(tag: RangeTag): string {
  if (tag.kind === 'keep') return tag.label || 'Protected · Auto Edit skips this'
  if (tag.kind === 'demo') return tag.label || 'Silent demo · Auto Edit keeps this pause'
  if (tag.kind === 'hook') return tag.label || 'Hook · opening beat'
  if (tag.kind === 'cta') return tag.label || 'CTA · ask or next step'
  return tag.label || 'Note'
}

export function filterEditBlocks(blocks: EditBlock[], filter: EditBlockFilter): EditBlock[] {
  if (filter === 'all') return blocks
  if (filter === 'applied') return blocks.filter((b) => b.kind === 'suggestion-applied')
  if (filter === 'pending') {
    return blocks.filter((b) => b.kind === 'suggestion-pending' || b.kind === 'suggestion-blocked')
  }
  if (filter === 'scenes') return blocks.filter((b) => b.kind === 'scene')
  if (filter === 'notes') return blocks.filter((b) => b.kind === 'note')
  return blocks.filter((b) => b.kind === 'keep' || b.kind === 'demo')
}

export function editBlockCounts(blocks: EditBlock[]): Record<EditBlockFilter, number> {
  return {
    all: blocks.length,
    applied: filterEditBlocks(blocks, 'applied').length,
    pending: filterEditBlocks(blocks, 'pending').length,
    scenes: filterEditBlocks(blocks, 'scenes').length,
    guards: filterEditBlocks(blocks, 'guards').length,
    notes: filterEditBlocks(blocks, 'notes').length
  }
}

export function buildEditBlocks(project: Project): EditBlock[] {
  const blocks: EditBlock[] = []

  for (const tag of project.tags) {
    const start = sourceToProgramOf(project, tag.start)
    const end = sourceToProgramOf(project, tag.end)
    if (end <= start) continue
    blocks.push({
      id: `tag-${tag.id}`,
      kind: tag.kind === 'keep' ? 'keep' : tag.kind === 'demo' ? 'demo' : 'note',
      start,
      end,
      label:
        tag.kind === 'keep'
          ? 'Protected'
          : tag.kind === 'demo'
            ? 'Demo'
            : tag.kind === 'hook'
              ? 'Hook'
              : tag.kind === 'cta'
                ? 'CTA'
                : 'Note',
      detail: tagDetail(tag),
      tagId: tag.id
    })
  }

  for (const s of project.suggestions) {
    if (s.action === 'normalize' || s.type === 'pace') continue
    const start = sourceToProgramOf(project, s.start)
    const end = sourceToProgramOf(project, s.end)
    if (end <= start) continue
    blocks.push({
      id: `sug-${s.id}`,
      kind: s.applied ? 'suggestion-applied' : s.blockedBy ? 'suggestion-blocked' : 'suggestion-pending',
      start,
      end,
      label: suggestionLaneLabel(s),
      detail: suggestionDetail(s),
      suggestionId: s.id,
      suggestionType: s.type,
      safe: s.safe && !s.blockedBy
    })
  }

  for (const scene of project.scenes ?? []) {
    const start = sourceToProgramOf(project, scene.start)
    blocks.push({
      id: `scene-${scene.id}`,
      kind: 'scene',
      start,
      end: start + 0.02,
      label: sceneLaneLabel(scene),
      detail: `${scene.title}${scene.summary ? ` · ${scene.summary}` : ''}`,
      sceneId: scene.id
    })
  }

  return blocks.sort((a, b) => a.start - b.start || a.end - b.end)
}
