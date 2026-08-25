import { useEditor } from '../store'
import { sourceToProgramOf } from './resolver'
import { formatYoutubeClock } from './time'
import { sentenceIds } from './transcriptEdit'
import type { Project } from '../types'

/** A find hit or one word becomes the spoken line. A painted span across sentences stays. */
export function quoteWordIds(project: Project, selectedWordIds: string[]): string[] {
  if (!selectedWordIds.length) return []
  const words = project.transcript.words
  const first = words.findIndex((word) => word.id === selectedWordIds[0])
  if (first < 0) return selectedWordIds
  const line = sentenceIds(words, first)
  if (!line.length) return selectedWordIds
  if (selectedWordIds.every((id) => line.includes(id))) return line
  return selectedWordIds
}

export function describeQuoteCopy(quote: string): string {
  const who = quote.split(': ')[0]?.trim()
  const named = who ? ` — ${who}` : ''
  return `Copied the line${named}. Paste it, or Mark clip.`
}

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
  const ids = quoteWordIds(editor.project, editor.selectedWordIds)
  const quote = quoteFromSelection(editor.project, ids)
  if (!quote) return { copied: false, toast: 'Select words, then Copy quote.', quote: null }
  if (ids.length !== editor.selectedWordIds.length) editor.selectWords(ids)
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(quote).catch(() => undefined)
    return { copied: true, toast: describeQuoteCopy(quote), quote }
  }
  return { copied: false, toast: 'Could not copy. Select the words and try again.', quote }
}
