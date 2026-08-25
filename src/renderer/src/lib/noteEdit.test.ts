import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createDemoProject } from './demo'
import {
  addNoteFromContext,
  describeNoteHop,
  describeNoteSaved,
  noteContextActions,
  noteSpan,
  removeNoteFromContext,
  startNoteEdit
} from './noteEdit'
import { useEditor, usePlayback } from '../store'

describe('note edit', () => {
  test('dropping a note at the playhead lets you type it', () => {
    const demo = createDemoProject()
    useEditor.getState().loadProject(demo, { clean: true })
    const result = addNoteFromContext()
    expect(result.toast).toMatch(/Type/)
    expect(result.tagId).toBeTruthy()
    const note = useEditor.getState().project.tags.find((tag) => tag.id === result.tagId)
    expect(note?.kind).toBe('note')
    expect(note?.label).toBe('Note')
    expect(startNoteEdit(result.tagId).started).toBe(true)
    const named = applyCommand(useEditor.getState().project, {
      type: 'setTagLabel',
      tagId: result.tagId!,
      label: 'check the price'
    })
    expect(named.tags.find((tag) => tag.id === result.tagId)?.label).toBe('check the price')
  })

  test('Note on a heading does not cover the whole chapter', () => {
    const demo = createDemoProject()
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectScene('sc_intro')
    usePlayback.getState().seekProgram(3)
    const result = addNoteFromContext()
    const note = useEditor.getState().project.tags.find((tag) => tag.id === result.tagId)
    expect(note?.end).toBeLessThan(4)
    expect((note?.end ?? 0) - (note?.start ?? 0)).toBeLessThan(2)
  })

  test('a second drop on the same beat edits the note instead of stacking', () => {
    const demo = createDemoProject()
    useEditor.getState().loadProject(demo, { clean: true })
    const first = addNoteFromContext()
    const second = addNoteFromContext()
    expect(second.tagId).toBe(first.tagId)
    expect(useEditor.getState().project.tags.filter((tag) => tag.kind === 'note')).toHaveLength(1)
  })

  test('a heading highlight parks the note on the playhead, not the whole chapter', () => {
    const demo = createDemoProject()
    const thesis = demo.scenes.find((scene) => scene.id === 'sc_intro')!
    const implied = demo.transcript.words
      .filter((word) => word.start >= thesis.start && word.end <= thesis.end)
      .map((word) => word.id)
    expect(implied.length).toBeGreaterThan(3)
    const span = noteSpan(demo, 3, implied, 'sc_intro')
    expect(span.end - span.start).toBeLessThan(2)
    expect(span.start).toBeGreaterThanOrEqual(2.5)
    expect(span.end).toBeLessThanOrEqual(4)
  })

  test('a silent heading parks a short note on the chapter, not the next talk', () => {
    const demo = createDemoProject()
    const silent = demo.scenes.find((scene) => scene.id === 'sc_demo')!
    const span = noteSpan(demo, silent.start, [], 'sc_demo')
    expect(span.start).toBeCloseTo(silent.start, 2)
    expect(span.end).toBeLessThanOrEqual(silent.start + 1.05)
    expect(span.end).toBeLessThan(silent.end)
  })

  test('a painted line keeps its own span', () => {
    const demo = createDemoProject()
    const words = demo.transcript.words.filter((word) => word.start >= 2 && word.end <= 4)
    const span = noteSpan(
      demo,
      0,
      words.map((word) => word.id),
      null
    )
    expect(span.start).toBe(words[0].start)
    expect(span.end).toBe(words[words.length - 1].end)
  })

  test('saved copy names the next hop', () => {
    expect(describeNoteSaved('hook')).toMatch(/N hops back here/)
    expect(describeNoteSaved('hook')).toMatch(/Mark clip/)
    expect(describeNoteSaved('ask later')).toMatch(/Ask marked/)
    expect(describeNoteSaved('check the price')).toMatch(/Copy notes/)
    expect(describeNoteSaved('Note')).toBeNull()
    expect(describeNoteSaved('   ')).toBeNull()
    expect(describeNoteHop('hook', 1)).toMatch(/Mark clip/)
    expect(describeNoteHop('hook', 2)).toMatch(/next mark/)
  })

  test('right-click actions type or remove', () => {
    expect(noteContextActions().map((row) => row.id)).toEqual(['type', 'remove'])
    const demo = createDemoProject()
    const tagged = applyCommand(demo, { type: 'addTag', start: 1, end: 2, kind: 'note', label: 'Note' })
    const id = tagged.tags.find((tag) => tag.kind === 'note')!.id
    useEditor.getState().loadProject(tagged, { clean: true })
    expect(removeNoteFromContext(id)).toEqual({ toast: 'Note removed.', removed: true })
    expect(useEditor.getState().project.tags.some((tag) => tag.id === id)).toBe(false)
  })
})
