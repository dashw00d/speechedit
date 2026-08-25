import { describe, expect, test } from 'bun:test'
import { createDemoProject } from './demo'
import { copyQuoteFromContext, quoteFromSelection } from './quote'
import { useEditor } from '../store'

describe('copy quote', () => {
  test('a selection becomes speaker, time, and words', () => {
    const demo = createDemoProject()
    const ids = demo.transcript.words.filter((word) => word.start >= 0.42 && word.end <= 1.08).map((word) => word.id)
    expect(quoteFromSelection(demo, ids)).toBe('Ryan (0:00): So today')
  })

  test('later words use the program clock', () => {
    const demo = createDemoProject()
    const first = demo.transcript.words.find((word) => word.text === 'First')
    expect(first).toBeTruthy()
    expect(quoteFromSelection(demo, [first!.id])).toBe("Ryan (0:16): First")
  })

  test('empty selection asks to pick words', () => {
    const demo = createDemoProject()
    useEditor.getState().loadProject(demo, { clean: true })
    const result = copyQuoteFromContext()
    expect(result.copied).toBe(false)
    expect(result.toast).toMatch(/Select words/)
    expect(quoteFromSelection(demo, [])).toBeNull()
  })
})
