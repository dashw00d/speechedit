import { describe, expect, test } from 'bun:test'
import { createDemoProject } from './demo'
import { cutPreviousFromContext, describeCutPrevious } from './cutPrevious'
import { restartBeforeWord } from './transcriptEdit'
import { useEditor, usePlayback } from '../store'

describe('cut previous sentence', () => {
  test('on a restart, the bar cut hears the join and names the save', () => {
    const demo = createDemoProject()
    const thats = demo.transcript.words.find((word) => word.text === "That's")!
    const restart = restartBeforeWord(demo.transcript.words, thats.id)!
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectWords([thats.id])
    const result = cutPreviousFromContext()
    expect(result.cut).toBe(true)
    expect(result.restart).toBe(true)
    expect(result.toast).toBe(describeCutPrevious(restart.end - restart.start, true))
    expect(result.toast).toMatch(/Hear the join/)
    const gone = useEditor.getState().project.transcript.words.filter(
      (word) => word.start >= restart.start && word.end <= restart.end
    )
    expect(gone.every((word) => word.deleted)).toBe(true)
    expect(usePlayback.getState().playing).toBe(true)
  })

  test('an empty caret asks to park on the restart', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    useEditor.getState().selectWords([])
    usePlayback.getState().seekProgram(0)
    const result = cutPreviousFromContext()
    expect(result.cut).toBe(false)
    expect(result.toast).toMatch(/Park on the restart/)
  })
})
