import { describe, expect, test } from 'bun:test'
import { createDemoProject } from './demo'
import { stillCaption, stillFilename } from './still'
import { useEditor } from '../store'

describe('copy frame', () => {
  test('a word selection becomes the still caption', () => {
    const demo = createDemoProject()
    const ids = demo.transcript.words.filter((word) => word.start >= 0.42 && word.end <= 1.08).map((word) => word.id)
    expect(stillCaption(demo, 0, ids)).toBe('Ryan (0:00): So today')
  })

  test('the playhead falls back to the sentence under it', () => {
    const demo = createDemoProject()
    expect(stillCaption(demo, 2.6, [])).toMatch(/^Ryan \(0:00\): So today/)
    expect(stillCaption(demo, 2.6, [])).toMatch(/transcript\.$/)
  })

  test('the filename uses the reel name and clock', () => {
    expect(stillFilename(createDemoProject(), 16.2)).toBe('Studio demo 0-16.png')
  })

  test('an empty reel still has a name and clock', () => {
    const demo = createDemoProject()
    useEditor.getState().loadProject({ ...demo, transcript: { ...demo.transcript, words: [] } }, { clean: true })
    expect(stillCaption(useEditor.getState().project, 8, [])).toMatch(/Studio demo · 0:08/)
  })
})
