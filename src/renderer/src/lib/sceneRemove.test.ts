import { describe, expect, test } from 'bun:test'
import { applyCommand, programLength } from './commands'
import { createDemoProject } from './demo'
import { toastForEdit } from './contextActions'
import { describeSceneRemove, removeSceneFromContext, sceneForSpan } from './sceneRemove'
import { useEditor } from '../store'

describe('remove a chapter', () => {
  test('deleteRange on a chapter is not a pause toast', () => {
    const demo = createDemoProject()
    const thesis = demo.scenes.find((row) => row.title === 'Thesis')!
    expect(sceneForSpan(demo, thesis.start, thesis.end)?.id).toBe(thesis.id)
    expect(
      toastForEdit(demo, { type: 'deleteRange', start: thesis.start, end: thesis.end, source: 'transcript' })
    ).toBe(describeSceneRemove(thesis))
    expect(toastForEdit(demo, { type: 'deleteRange', start: 6.58, end: 16.02, source: 'transcript' })).toMatch(
      /pause/
    )
  })

  test('removeSceneFromContext cuts the whole chapter and hears the next one', () => {
    const demo = createDemoProject()
    const thesis = demo.scenes.find((row) => row.title === 'Thesis')!
    const walk = demo.scenes.find((row) => row.title === 'Walk the editor')!
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectScene(thesis.id)
    const before = programLength(useEditor.getState().project)
    const result = removeSceneFromContext()
    expect(result.removed).toBe(true)
    expect(result.toast).toMatch(/chapter/)
    const editor = useEditor.getState()
    expect(programLength(editor.project)).toBeLessThan(before - 1)
    expect(editor.selectedSceneId).toBe(walk.id)
    expect(editor.project.transcript.words.filter((word) => word.start < thesis.end).every((word) => word.deleted)).toBe(
      true
    )
  })

  test('removeSceneFromContext puts a dropped chapter back', () => {
    const demo = createDemoProject()
    const close = demo.scenes.find((row) => row.title === 'Close')!
    const cut = applyCommand(demo, { type: 'deleteRange', start: close.start, end: close.end, source: 'transcript' })
    useEditor.getState().loadProject(cut, { clean: true })
    useEditor.getState().selectScene(close.id)
    const result = removeSceneFromContext()
    expect(result.removed).toBe(false)
    expect(result.toast).toMatch(/Put the chapter back/)
    expect(useEditor.getState().project.transcript.words.filter((word) => word.start >= close.start).some((word) => !word.deleted)).toBe(
      true
    )
  })
})
