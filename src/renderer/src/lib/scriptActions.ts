import { programToSourceOf, sourceToProgramOf } from './resolver'
import { caretWord, paragraphIds, wordRange } from './transcriptEdit'
import { formatSpan } from './contextActions'
import { useEditor, usePlayback } from '../store'

export function playInOutOrSelection(): void {
  usePlayback.getState().playSelectionOrMarks()
}

export function bladeAtWord(): void {
  const editor = useEditor.getState()
  const playback = usePlayback.getState()
  const words = editor.project.transcript.words
  const source = programToSourceOf(editor.project, playback.programTime)
  const word = caretWord(words, editor.selectedWordIds, source)
  if (!word) return
  editor.dispatch({ type: 'splitAt', time: word.start })
}

export function selectParagraphAtCaret(): void {
  selectParagraphFromContext()
}

/** Hear the paragraph at the caret, then Delete removes it. */
export function selectParagraphFromContext(): { toast: string; count: number } {
  const editor = useEditor.getState()
  const playback = usePlayback.getState()
  const words = editor.project.transcript.words
  const source = programToSourceOf(editor.project, playback.programTime)
  const word = caretWord(words, editor.selectedWordIds, source)
  if (!word) return { toast: 'Click a word, then A for the paragraph.', count: 0 }
  const index = words.findIndex((w) => w.id === word.id)
  const ids = paragraphIds(words, index)
  editor.selectWords(ids)
  const span = wordRange(words, ids)
  if (span) {
    playback.playLoop(sourceToProgramOf(editor.project, span.start), sourceToProgramOf(editor.project, span.end))
  }
  const dur = span ? Math.max(0, span.end - span.start) : 0
  if (ids.length < 2) {
    return { toast: 'That line is already the whole paragraph. Delete removes it.', count: ids.length }
  }
  return { toast: `Paragraph selected · ${formatSpan(dur)}. Delete removes it.`, count: ids.length }
}
