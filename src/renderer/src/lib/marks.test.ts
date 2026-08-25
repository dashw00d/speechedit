import { describe, expect, test } from 'bun:test'
import { applyCommand, programLength } from './commands'
import { suggestTask } from './contextActions'
import { createDemoProject } from './demo'
import {
  clearMarksFromContext,
  CUT_MARKED_TOAST,
  cutMarksFromContext,
  describeClearMarks,
  markClipFromContext,
  MARK_CLIP_TOAST,
  tightenMarksFromContext
} from './marks'
import { useEditor, usePlayback } from '../store'

describe('clear marks', () => {
  test('names the next Find hit when a hunt is still open', () => {
    expect(describeClearMarks('the', { nextHit: true })).toBe('Next “the” — Hear it, or Mark clip.')
    expect(describeClearMarks('the')).toBe('That was the last “the”. Find another line, or you are done.')
    expect(describeClearMarks()).toMatch(/Find the next clip, then Mark clip/)
  })

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
    expect(result.toast).toBe(CUT_MARKED_TOAST)
    expect(result.toast).toMatch(/Mark the next stretch/)
    const project = useEditor.getState().project
    expect(project.markIn).toBeNull()
    expect(project.markOut).toBeNull()
    expect(useEditor.getState().selectedWordIds).toEqual([])
    expect(project.transcript.words.filter((word) => !word.deleted).length).toBeLessThan(before)
    expect(usePlayback.getState().playing).toBe(true)
    expect(suggestTask(project).showMarkedExport).toBe(false)
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
    expect(usePlayback.getState().loopFrom).toBeCloseTo(project.markIn!, 2)
    expect(usePlayback.getState().playing).toBe(true)
  })

  test('tighten marked shortens pauses and keeps the marks', () => {
    const demo = createDemoProject()
    const marked = applyCommand(demo, { type: 'setMarks', markIn: 0, markOut: 22 })
    useEditor.getState().loadProject(marked, { clean: true })
    const before = useEditor.getState().project
    const result = tightenMarksFromContext()
    expect(result.tightened).toBe(true)
    expect(result.toast).toMatch(/Saved/)
    expect(result.toast).toMatch(/Cut marked or Export marked range/)
    const project = useEditor.getState().project
    expect(project.markIn).toBe(0)
    expect(project.markOut).toBeCloseTo(22 - (programLength(before) - programLength(project)), 2)
    expect(project.markOut).toBeLessThan(22)
    expect(project.cuts.length).toBeGreaterThan(before.cuts.length)
    expect(usePlayback.getState().playing).toBe(true)
  })

  test('tighten marked on a single pause points at Cut marked', () => {
    const demo = createDemoProject()
    const marked = applyCommand(demo, { type: 'setMarks', markIn: 6.6, markOut: 15.9 })
    useEditor.getState().loadProject(marked, { clean: true })
    const result = tightenMarksFromContext()
    expect(result.tightened).toBe(false)
    expect(result.toast).toMatch(/Cut marked removes it/)
  })

  test('says so when nothing is marked', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    expect(clearMarksFromContext().cleared).toBe(false)
    expect(clearMarksFromContext().toast).toMatch(/No marks/)
    expect(cutMarksFromContext().cut).toBe(false)
    expect(cutMarksFromContext().toast).toMatch(/Mark In and Out/)
    expect(tightenMarksFromContext().tightened).toBe(false)
    expect(tightenMarksFromContext().toast).toMatch(/Mark In and Out/)
  })
})
