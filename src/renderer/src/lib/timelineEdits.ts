import type { EditSuggestion, Project, RangeTag } from '../types'
import { sourceToProgramOf } from './resolver'

export type EditBlockKind =
  | 'keep'
  | 'demo'
  | 'note'
  | 'suggestion-applied'
  | 'suggestion-pending'
  | 'suggestion-blocked'
  | 'scene'

export type EditBlockFilter = 'all' | 'applied' | 'pending' | 'scenes' | 'guards'

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
  if (s.blockedBy) return `${s.label} · blocked by a guard`
  if (s.safe) return `${s.label} · safe to apply`
  return `${s.label} · needs review`
}

function tagDetail(tag: RangeTag): string {
  if (tag.kind === 'keep') return tag.label || 'Protected · Auto Edit skips this'
  if (tag.kind === 'demo') return tag.label || 'Silent demo · Auto Edit keeps this pause'
  return tag.label || 'Note'
}

export function filterEditBlocks(blocks: EditBlock[], filter: EditBlockFilter): EditBlock[] {
  if (filter === 'all') return blocks
  if (filter === 'applied') return blocks.filter((b) => b.kind === 'suggestion-applied')
  if (filter === 'pending') {
    return blocks.filter((b) => b.kind === 'suggestion-pending' || b.kind === 'suggestion-blocked')
  }
  if (filter === 'scenes') return blocks.filter((b) => b.kind === 'scene')
  return blocks.filter((b) => b.kind === 'keep' || b.kind === 'demo' || b.kind === 'note')
}

export function editBlockCounts(blocks: EditBlock[]): Record<EditBlockFilter, number> {
  return {
    all: blocks.length,
    applied: filterEditBlocks(blocks, 'applied').length,
    pending: filterEditBlocks(blocks, 'pending').length,
    scenes: filterEditBlocks(blocks, 'scenes').length,
    guards: filterEditBlocks(blocks, 'guards').length
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
      label: tag.kind === 'keep' ? 'Keep' : tag.kind === 'demo' ? 'Demo' : 'Note',
      detail: tagDetail(tag),
      tagId: tag.id
    })
  }

  for (const s of project.suggestions) {
    if (s.action === 'normalize' || s.action === 'review') continue
    const start = sourceToProgramOf(project, s.start)
    const end = sourceToProgramOf(project, s.end)
    if (end <= start) continue
    blocks.push({
      id: `sug-${s.id}`,
      kind: s.applied ? 'suggestion-applied' : s.blockedBy ? 'suggestion-blocked' : 'suggestion-pending',
      start,
      end,
      label: s.applied ? 'Cut' : s.type === 'silence' ? 'Pause' : s.type === 'filler' ? 'Filler' : s.type,
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
      label: scene.takeIndex ? `T${scene.takeIndex}` : scene.kind,
      detail: `${scene.title}${scene.summary ? ` · ${scene.summary}` : ''}`,
      sceneId: scene.id
    })
  }

  return blocks.sort((a, b) => a.start - b.start || a.end - b.end)
}
