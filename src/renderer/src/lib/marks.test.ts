import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { suggestTask } from './contextActions'
import { createDemoProject } from './demo'
import { clearMarksFromContext, cutMarksFromContext, markClipFromContext, MARK_CLIP_TOAST } from './marks'
import { useEditor } from '../store'

describe('clear marks', () => {
  test('drops In–Out and points at the next hunt', () => {
    const marked = applyCommand(createDemoProject(), { type: 'setMarks', markIn: 32.1, markOut: 35.4 })
    useEditor.getState().loadProject(marked, { clean: true })
    expect(suggestTask(useEditor.getState().project).showMarkedExport).toBe(true)
    const result = clearMarksFromContext()
    expect(result.cleared).toBe(true)
    expect(result.toast).toMatch(/Find the next clip, then Mark clip/)
    const project = useEditor.getState().project
    expect(project.markIn).toBeNull()
    expect(project.markOut).toBeNull()
    expect(suggestTask(project).showMarkedExport).toBe(false)
  })

  test('cut marked removes the span and closes the gap', () => {
    const demo = createDemoProject()
    const marked = applyCommand(demo, { type: 'setMarks', markIn: 32.1, markOut: 35.4 })
    useEditor.getState().loadProject(marked, { clean: true })
    const before = useEditor.getState().project.transcript.words.filter((word) => !word.deleted).length
    const result = cutMarksFromContext()
    expect(result.cut).toBe(true)
    expect(result.toast).toMatch(/closed the gap/)
    const project = useEditor.getState().project
    expect(project.transcript.words.filter((word) => !word.deleted).length).toBeLessThan(before)
  })

  test('markClipFromContext sets In–Out on the selected words', () => {
    const demo = createDemoProject()
    const word = demo.transcript.words.find((row) => row.text === 'build')!
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectWords([word.id])
    const result = markClipFromContext()
    expect(result.marked).toBe(true)
    expect(result.toast).toBe(MARK_CLIP_TOAST)
    const project = useEditor.getState().project
    expect(project.markIn).toBeCloseTo(word.start, 2)
    expect(project.markOut).toBeCloseTo(word.end, 2)
    expect(suggestTask(project).showMarkedExport).toBe(true)
  })

  test('markClipFromContext can mark the selected chapter', () => {
    const demo = createDemoProject()
    const thesis = demo.scenes.find((row) => row.title === 'Thesis')!
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectScene(thesis.id)
    expect(markClipFromContext().marked).toBe(true)
    const project = useEditor.getState().project
    expect(project.markOut! - project.markIn!).toBeCloseTo(thesis.end - thesis.start, 1)
  })

  test('says so when nothing is marked', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    expect(clearMarksFromContext().cleared).toBe(false)
    expect(clearMarksFromContext().toast).toMatch(/No marks/)
    expect(cutMarksFromContext().cut).toBe(false)
    expect(cutMarksFromContext().toast).toMatch(/Mark In and Out/)
  })
})
