import { programToSourceOf } from './resolver'
import { caretWord, paragraphIds } from './transcriptEdit'
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
  const editor = useEditor.getState()
  const playback = usePlayback.getState()
  const words = editor.project.transcript.words
  const source = programToSourceOf(editor.project, playback.programTime)
  const word = caretWord(words, editor.selectedWordIds, source)
  if (!word) return
  const index = words.findIndex((w) => w.id === word.id)
  editor.selectWords(paragraphIds(words, index))
}
