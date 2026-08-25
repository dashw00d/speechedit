import { programToSourceOf, sourceToProgramOf } from './resolver'
import { caretWord, isParagraphSelection, paragraphIds, wordRange } from './transcriptEdit'
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

/** Hear the paragraph at the caret. Remove paragraph on the bar (or Delete) cuts it. */
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
  return {
    toast: `Paragraph selected · ${formatSpan(dur)}. Remove paragraph on the bar (or Delete) hears the join.`,
    count: ids.length
  }
}

function savedLabel(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(1)} seconds`
  return `${Math.round(seconds)} seconds`
}

export function describeCutParagraph(saved: number): string {
  return `Removed the paragraph — saved ${savedLabel(saved)}. Hear the join.`
}

/** Cut the selected paragraph and play the join. A first if you have not heard it. */
export function cutParagraphFromContext(): { toast: string; cut: boolean } {
  const editor = useEditor.getState()
  const words = editor.project.transcript.words
  const ids = editor.selectedWordIds
  if (!isParagraphSelection(words, ids)) {
    return { toast: 'Press A to hear the paragraph, then Remove paragraph.', cut: false }
  }
  const span = wordRange(words, ids)
  if (!span) return { toast: 'Press A to hear the paragraph, then Remove paragraph.', cut: false }
  editor.dispatch({ type: 'toggleWords', wordIds: ids })
  editor.clearSelection()
  const join = sourceToProgramOf(useEditor.getState().project, span.start)
  usePlayback.getState().playLoop(Math.max(0, join - 0.6), join + 1.4)
  return { toast: describeCutParagraph(span.end - span.start), cut: true }
}
