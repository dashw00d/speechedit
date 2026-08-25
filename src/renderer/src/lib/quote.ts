import { useEditor } from '../store'
import { sourceToProgramOf } from './resolver'
import { formatYoutubeClock } from './time'
import type { Project } from '../types'

export function quoteFromSelection(project: Project, selectedWordIds: string[]): string | null {
  const wanted = new Set(selectedWordIds)
  const picked = project.transcript.words.filter((word) => wanted.has(word.id))
  const live = picked.filter((word) => !word.deleted)
  const words = live.length ? live : picked
  if (!words.length) return null
  const text = words
    .map((word) => word.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null
  const start = sourceToProgramOf(project, words[0]!.start)
  const clock = formatYoutubeClock(start)
  const speakerId = words[0]!.speaker
  const name = project.transcript.speakers.find((row) => row.id === speakerId)?.name?.trim()
  return name ? `${name} (${clock}): ${text}` : `(${clock}): ${text}`
}

export function copyQuoteFromContext(): { copied: boolean; toast: string; quote: string | null } {
  const editor = useEditor.getState()
  const quote = quoteFromSelection(editor.project, editor.selectedWordIds)
  if (!quote) return { copied: false, toast: 'Select words, then Copy quote.', quote: null }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(quote).catch(() => undefined)
    return { copied: true, toast: 'Copied the quote. Paste into Slack or a deck.', quote }
  }
  return { copied: false, toast: 'Could not copy. Select the words and try again.', quote }
}
