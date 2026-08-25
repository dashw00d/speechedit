import { describe, expect, test } from 'bun:test'
import { createDemoProject } from './demo'
import { cutThisFromContext, describeCutSentence } from './cutSentence'
import { liveSentenceRange } from './transcriptEdit'
import { useEditor, usePlayback } from '../store'

describe('cut this sentence', () => {
  test('cuts the spoken line around the caret and hears the join', () => {
    const demo = createDemoProject()
    const importWord = demo.transcript.words.find((word) => word.text === 'import')!
    const span = liveSentenceRange(demo.transcript.words, importWord.id)!
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectWords([importWord.id])
    const result = cutThisFromContext()
    expect(result.cut).toBe(true)
    expect(result.toast).toBe(describeCutSentence(span.end - span.start))
    expect(result.toast).toMatch(/Hear the join/)
    const gone = useEditor.getState().project.transcript.words.filter(
      (word) => word.start >= span.start && word.end <= span.end
    )
    expect(gone.every((word) => word.deleted)).toBe(true)
    expect(usePlayback.getState().playing).toBe(true)
  })

  test('an empty caret asks to park on the line', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    useEditor.getState().selectWords([])
    usePlayback.getState().seekProgram(0)
    const result = cutThisFromContext()
    expect(result.cut).toBe(false)
    expect(result.toast).toMatch(/Park on the line/)
  })
})
