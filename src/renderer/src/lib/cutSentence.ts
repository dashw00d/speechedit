import { currentWord } from './edl'
import { programToSourceOf, sourceToProgramOf } from './resolver'
import { liveSentenceRange } from './transcriptEdit'
import { useEditor, usePlayback } from '../store'

function savedLabel(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(1)} seconds`
  return `${Math.round(seconds)} seconds`
}

export function describeCutSentence(saved: number): string {
  return `Cut this sentence — saved ${savedLabel(saved)}. Hear the join.`
}

/** Cut the spoken line around the caret and play the join. */
export function cutThisFromContext(): { toast: string; cut: boolean } {
  const editor = useEditor.getState()
  const source = programToSourceOf(editor.project, usePlayback.getState().programTime)
  const caret =
    editor.selectedWordIds[0] ??
    currentWord(editor.project.transcript.words, source)?.id
  if (!caret) return { toast: 'Park on the line, then Cut this sentence.', cut: false }
  const words = editor.project.transcript.words
  const span = liveSentenceRange(words, caret)
  if (!span) return { toast: 'That sentence is already cut.', cut: false }
  editor.dispatch({ type: 'cutSentence', wordId: caret })
  const next = useEditor.getState().project
  const join = sourceToProgramOf(next, span.start)
  usePlayback.getState().playLoop(Math.max(0, join - 0.6), join + 1.4)
  return { toast: describeCutSentence(span.end - span.start), cut: true }
}
