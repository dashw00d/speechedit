import type { EditSuggestion, EditorialScene, Project, Word } from '../types'
import { allWordsMatchingPhrase } from './transcriptEdit'

export type TranscriptFindHit =
  | { kind: 'words'; ids: string[]; matchGroups: number }
  | { kind: 'scene'; scene: EditorialScene }
  | { kind: 'suggestion'; suggestion: EditSuggestion }

export function findInTranscript(project: Project, words: Word[], query: string): TranscriptFindHit | null {
  const trimmed = query.trim()
  if (!trimmed) return null

  const ids = allWordsMatchingPhrase(words, trimmed)
  if (ids.length) {
    const tokens = trimmed.split(/\s+/).filter(Boolean)
    const matchGroups =
      tokens.length > 1
        ? (() => {
            const keys = words.map((w) => w.text.toLowerCase().replace(/[.,!?]/g, ''))
            let count = 0
            for (let i = 0; i <= keys.length - tokens.length; i++) {
              if (tokens.every((token, k) => keys[i + k] === token.toLowerCase().replace(/[.,!?]/g, ''))) count++
            }
            return count
          })()
        : ids.length
    return { kind: 'words', ids, matchGroups }
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
