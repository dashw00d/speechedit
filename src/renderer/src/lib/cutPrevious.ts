import { currentWord } from './edl'
import { programToSourceOf, sourceToProgramOf } from './resolver'
import { livePreviousSentence, previousSentenceRange, restartBeforeWord } from './transcriptEdit'
import { useEditor, usePlayback } from '../store'

function savedLabel(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(1)} seconds`
  return `${Math.round(seconds)} seconds`
}

export function describeCutPrevious(saved: number, restart: boolean): string {
  const time = savedLabel(saved)
  if (restart) return `Cut the restart — saved ${time}. Hear the join.`
  return `Cut the previous sentence — saved ${time}. Hear the join.`
}

/** Cut the line before the caret. A short live line is a restart; `,` still cuts a long chapter. */
export function cutPreviousFromContext(): { toast: string; cut: boolean; restart: boolean } {
  const editor = useEditor.getState()
  const source = programToSourceOf(editor.project, usePlayback.getState().programTime)
  const caret =
    editor.selectedWordIds[0] ??
    currentWord(editor.project.transcript.words, source)?.id
  if (!caret) return { toast: 'Park on the restart line, then Cut previous.', cut: false, restart: false }
  const words = editor.project.transcript.words
  const restart = restartBeforeWord(words, caret)
  const span = restart ?? previousSentenceRange(words, caret)
  if (!span || !livePreviousSentence(words, caret)) {
    return { toast: 'Nothing live to cut before this line.', cut: false, restart: false }
  }
  editor.dispatch({ type: 'cutPreviousSentence', wordId: caret })
  const next = useEditor.getState().project
  const join = sourceToProgramOf(next, span.start)
  usePlayback.getState().playLoop(Math.max(0, join - 0.6), join + 1.4)
  return { toast: describeCutPrevious(span.end - span.start, Boolean(restart)), cut: true, restart: Boolean(restart) }
}
