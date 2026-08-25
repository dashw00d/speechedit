import { describe, expect, test } from 'bun:test'
import { createDemoProject } from './demo'
import { describeStill, stillAt, stillCaption, stillFilename } from './still'
import { useEditor, usePlayback } from '../store'
import { sourceToProgramOf } from './resolver'

describe('copy frame', () => {
  test('a word selection parks the frame on those words', () => {
    const demo = createDemoProject()
    const ids = demo.transcript.words.filter((word) => word.start >= 16.2 && word.end <= 17.22).map((word) => word.id)
    const at = stillAt(demo, 2, ids, null)
    expect(at.basis).toBe('words')
    expect(at.programTime).toBeCloseTo(sourceToProgramOf(demo, 16.2), 2)
  })

  test('a chapter parks the frame at the start of that step', () => {
    const demo = createDemoProject()
    const at = stillAt(demo, 2, [], 'sc_import')
    expect(at.basis).toBe('scene')
    expect(at.programTime).toBeCloseTo(sourceToProgramOf(demo, 16.2), 2)
  })

  test('no selection uses the playhead', () => {
    const demo = createDemoProject()
    const at = stillAt(demo, 8, [], null)
    expect(at.basis).toBe('playhead')
    expect(at.programTime).toBe(8)
  })

  test('the toast names the picture, not a ticket', () => {
    expect(describeStill(true, true)).toMatch(/picture and the line/)
    expect(describeStill(true, true)).toMatch(/Paste it/)
    expect(describeStill(true, false, 'Silent product walkthrough')).toMatch(/card with the line — Silent product walkthrough/)
    expect(describeStill(false, true)).toMatch(/Downloaded the picture and the line/)
    expect(describeStill(false, false, 'Silent product walkthrough')).toMatch(/Drop the PNG/)
  })

  test('copyStillFromContext seeks to the parked words', async () => {
    const demo = createDemoProject()
    const ids = demo.transcript.words.filter((word) => word.start >= 16.2 && word.end <= 17.22).map((word) => word.id)
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectWords(ids)
    usePlayback.getState().seekProgram(1)
    const { copyStillFromContext } = await import('./still')
    const result = await copyStillFromContext()
    expect(usePlayback.getState().programTime).toBeCloseTo(sourceToProgramOf(demo, 16.2), 2)
    expect(result.at.basis).toBe('words')
  })

  test('a word selection becomes the still caption', () => {
    const demo = createDemoProject()
    const ids = demo.transcript.words.filter((word) => word.start >= 0.42 && word.end <= 1.08).map((word) => word.id)
    expect(stillCaption(demo, 0, ids)).toBe('Ryan (0:00): So today')
  })

  test('a silent chapter captions the step, not the reel name', () => {
    const demo = createDemoProject()
    const at = stillAt(demo, 2, [], 'sc_demo')
    expect(stillCaption(demo, at.programTime, [], 'sc_demo')).toBe(
      'Silent product walkthrough · 0:23'
    )
  })

  test('a talking chapter names the step and the line', () => {
    const demo = createDemoProject()
    const at = stillAt(demo, 2, [], 'sc_import')
    expect(stillCaption(demo, at.programTime, [], 'sc_import')).toMatch(/^Walk the editor — Ryan \(0:16\): First/)
  })

  test('the playhead falls back to the sentence under it', () => {
    const demo = createDemoProject()
    expect(stillCaption(demo, 2.6, [])).toMatch(/^Ryan \(0:00\): So today/)
    expect(stillCaption(demo, 2.6, [])).toMatch(/transcript\.$/)
  })

  test('the filename uses the reel name and clock', () => {
    expect(stillFilename(createDemoProject(), 16.2)).toBe('Studio demo 0-16.png')
    expect(stillFilename(createDemoProject(), 23.7, 'Silent product walkthrough')).toBe(
      'Studio demo Silent product walkthrough 0-23.png'
    )
  })

  test('an empty reel still has a name and clock', () => {
    const demo = createDemoProject()
    useEditor.getState().loadProject({ ...demo, transcript: { ...demo.transcript, words: [] } }, { clean: true })
    expect(stillCaption(useEditor.getState().project, 8, [])).toMatch(/Studio demo · 0:08/)
  })
})
