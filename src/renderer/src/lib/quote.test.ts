import { describe, expect, test } from 'bun:test'
import { createDemoProject } from './demo'
import { copyQuoteFromContext, describeQuoteCopy, quoteFromSelection, quoteWordIds } from './quote'
import { useEditor } from '../store'

function stubClipboard() {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async () => undefined } }
  })
}

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

  test('toast names the speaker clock, not a split time', () => {
    expect(describeQuoteCopy("Ryan (0:16): First I'll import")).toBe(
      'Copied the line — Ryan (0:16). Paste it, or Mark clip.'
    )
  })

  test('a painted span across sentences stays painted', () => {
    const demo = createDemoProject()
    const so = demo.transcript.words.find((word) => word.text === 'So')!
    const first = demo.transcript.words.find((word) => word.text === 'First')!
    expect(quoteWordIds(demo, [so.id, first.id])).toEqual([so.id, first.id])
  })

  test('a find hit expands to the spoken line', () => {
    stubClipboard()
    const demo = createDemoProject()
    const hit = demo.transcript.words.find((word) => word.text === 'import')!
    const ids = quoteWordIds(demo, [hit.id])
    expect(quoteFromSelection(demo, ids)).toMatch(/Ryan \(0:16\): First I'll import the recording,/)
    expect(quoteFromSelection(demo, ids)).toMatch(/filler words\./)
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectWords([hit.id])
    const result = copyQuoteFromContext()
    expect(result.copied).toBe(true)
    expect(result.quote).toMatch(/First I'll import/)
    expect(result.toast).toBe(describeQuoteCopy(result.quote!))
    expect(result.toast).toBe('Copied the line — Ryan (0:16). Paste it, or Mark clip.')
    expect(useEditor.getState().selectedWordIds.length).toBe(ids.length)
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
