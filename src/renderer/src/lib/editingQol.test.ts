import { describe, expect, test } from 'bun:test'
import { applyCommand, programLength } from './commands'
import { createDemoProject } from './demo'
import { transcriptChoices } from './contextActions'
import { wordSelectionRanges } from './transcriptEdit'
import { useEditor } from '../store'

describe('predictable transcript editing', () => {
  test('separate word selections preserve every intervening word', () => {
    const project = createDemoProject()
    const words = project.transcript.words
    const ids = [words[1].id, words[8].id, words[12].id]
    const next = applyCommand(project, { type: 'toggleWords', wordIds: ids })
    expect(next.transcript.words.filter((word) => word.deleted).map((word) => word.id)).toEqual(ids)
    expect(wordSelectionRanges(words, ids)).toHaveLength(3)
    const duration = ids.reduce((sum, id) => { const word = words.find((item) => item.id === id)!; return sum + word.end - word.start }, 0)
    expect(programLength(project) - programLength(next)).toBeCloseTo(duration, 2)
  })

  test('All fillers removes fillers without cutting the speech between them', () => {
    const project = createDemoProject()
    const filler = project.transcript.words.find((word) => word.text === 'um')!
    const choice = transcriptChoices(project, [filler.id]).choices.find((item) => item.id === 'all-fillers')!
    expect(choice.command.type).toBe('toggleWords')
    if (choice.command.type !== 'toggleWords') throw new Error('Expected word selection')
    const next = applyCommand(project, choice.command)
    expect(next.transcript.words.filter((word) => word.deleted).map((word) => word.id)).toEqual(choice.command.wordIds)
    expect(next.transcript.words.filter((word) => !word.deleted).length).toBeGreaterThan(50)
  })

  test('Restore words restores only selected words from a larger cut', () => {
    const project = createDemoProject()
    const words = project.transcript.words.slice(0, 6)
    const cut = applyCommand(project, { type: 'toggleWords', wordIds: words.map((word) => word.id) })
    const ids = [words[1].id, words[4].id]
    const restore = transcriptChoices(cut, ids).choices[0]
    expect(restore.id).toBe('put-back')
    const next = applyCommand(cut, restore.command)
    for (const word of words) expect(next.transcript.words.find((item) => item.id === word.id)?.deleted).toBe(!ids.includes(word.id))
  })

  test('a batch of separate cuts is one undoable edit and redo restores it', () => {
    const editor = useEditor.getState()
    const project = createDemoProject()
    editor.loadProject(project, { clean: true })
    const before = useEditor.getState().project
    const ids = [project.transcript.words[1].id, project.transcript.words[8].id]
    editor.dispatch({ type: 'toggleWords', wordIds: ids })
    const edited = useEditor.getState().project
    expect(useEditor.getState().past).toHaveLength(1)
    editor.undo()
    expect(useEditor.getState().project).toEqual(before)
    editor.redo()
    expect(useEditor.getState().project).toEqual(edited)
  })

  test('leave-gaps mode preserves timing for separate cuts', () => {
    const project = createDemoProject()
    const ids = [project.transcript.words[1].id, project.transcript.words[8].id]
    const next = applyCommand(project, { type: 'toggleWords', wordIds: ids, lift: true })
    expect(programLength(next)).toBeCloseTo(programLength(project), 2)
    expect(next.transcript.words.filter((word) => word.deleted).map((word) => word.id)).toEqual(ids)
  })

  test('selection summary measures selected portions, excluding intervening speech', () => {
    const project = createDemoProject()
    const ids = [project.transcript.words[0].id, project.transcript.words[20].id]
    const ranges = wordSelectionRanges(project.transcript.words, ids)
    expect(ranges).toHaveLength(2)
    const total = ranges.reduce((sum, range) => sum + range.end - range.start, 0)
    expect(transcriptChoices(project, ids).summary).toContain(total.toFixed(1))
  })
})
