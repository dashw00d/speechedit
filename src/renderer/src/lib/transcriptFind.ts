import type { EditSuggestion, EditorialScene, Project, Word } from '../types'

export type TranscriptFindHit =
  | { kind: 'words'; ids: string[]; matchGroups: number; groups: string[][] }
  | { kind: 'scene'; scene: EditorialScene }
  | { kind: 'suggestion'; suggestion: EditSuggestion }

function normalizeToken(text: string): string {
  return text.toLowerCase().replace(/[“”]/g, '"').replace(/[.,!?]/g, '')
}

/** Non-overlapping phrase hits, in transcript order. */
export function findWordGroups(words: Word[], query: string): string[][] {
  const tokens = normalizeToken(query).split(/\s+/).filter(Boolean)
  if (!tokens.length) return []
  const keys = words.map((w) => normalizeToken(w.text))
  const groups: string[][] = []
  for (let i = 0; i <= keys.length - tokens.length; i++) {
    if (tokens.every((token, k) => keys[i + k] === token)) {
      groups.push(words.slice(i, i + tokens.length).map((w) => w.id))
      i += tokens.length - 1
    }
  }
  if (!groups.length && tokens.length === 1) {
    return words.filter((_, i) => keys[i].includes(tokens[0])).map((w) => [w.id])
  }
  return groups
}

export function findInTranscript(project: Project, words: Word[], query: string): TranscriptFindHit | null {
  const trimmed = query.trim()
  if (!trimmed) return null

  const groups = findWordGroups(words, trimmed)
  if (groups.length) {
    return {
      kind: 'words',
      ids: groups.flat(),
      matchGroups: groups.length,
      groups
    }
  }

  const q = trimmed.toLowerCase()
  const scene = (project.scenes ?? []).find((item) =>
    `${item.title} ${item.summary ?? ''} ${item.kind}`.toLowerCase().includes(q)
  )
  if (scene) return { kind: 'scene', scene }

  const suggestion = project.suggestions.find(
    (item) => !item.applied && `${item.label} ${item.type}`.toLowerCase().includes(q)
  )
  if (suggestion) return { kind: 'suggestion', suggestion }

  return null
}

/** First word in each hit gets the replacement; leftover phrase words go blank (timing stays). */
export function replacePlan(
  words: Word[],
  query: string,
  replacement: string,
  groups?: string[][]
): { wordId: string; text: string }[] {
  const hits = groups ?? findWordGroups(words, query)
  const pairs: { wordId: string; text: string }[] = []
  for (const ids of hits) {
    if (!ids.length) continue
    pairs.push({ wordId: ids[0], text: replacement })
    for (const id of ids.slice(1)) pairs.push({ wordId: id, text: '' })
  }
  return pairs
}
