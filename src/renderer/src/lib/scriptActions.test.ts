import { describe, expect, test } from 'bun:test'
import { createDemoProject } from './demo'
import { cutParagraphFromContext, describeCutParagraph, selectParagraphFromContext } from './scriptActions'
import { isParagraphSelection, paragraphIds, wordRange } from './transcriptEdit'
import { useEditor, usePlayback } from '../store'

describe('remove paragraph', () => {
  test('cuts the selected paragraph and hears the join', () => {
    const demo = createDemoProject()
    const ids = paragraphIds(demo.transcript.words, 0)
    const span = wordRange(demo.transcript.words, ids)!
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectWords(ids)
    expect(isParagraphSelection(demo.transcript.words, ids)).toBe(true)
    const result = cutParagraphFromContext()
    expect(result.cut).toBe(true)
    expect(result.toast).toBe(describeCutParagraph(span.end - span.start))
    expect(result.toast).toMatch(/Hear the join/)
    const gone = useEditor.getState().project.transcript.words.filter(
      (word) => word.start >= span.start && word.end <= span.end
    )
    expect(gone.every((word) => word.deleted)).toBe(true)
    expect(useEditor.getState().selectedWordIds).toEqual([])
    expect(usePlayback.getState().playing).toBe(true)
  })

  test('without a paragraph asks to press A first', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    useEditor.getState().selectWords([])
    const result = cutParagraphFromContext()
    expect(result.cut).toBe(false)
    expect(result.toast).toMatch(/Press A/)
  })

  test('A hears the paragraph and names Remove paragraph', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    usePlayback.getState().seekProgram(0.7)
    const result = selectParagraphFromContext()
    expect(result.count).toBeGreaterThan(2)
    expect(result.toast).toMatch(/Remove paragraph/)
    expect(usePlayback.getState().playing).toBe(true)
  })
})
