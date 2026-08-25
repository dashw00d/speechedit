import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createDemoProject } from './demo'
import { snapTime, sourceToProgramOf } from './resolver'
import { coveringAppliedSuggestion, PARAGRAPH_GAP, paragraphIds } from './transcriptEdit'
import type { Word } from '../types'

function w(id: string, text: string, start: number, end: number): Word {
  return { id, text, start, end, speaker: 's', deleted: false }
}

describe('paragraph select', () => {
  test('splits paragraphs when the gap is over 1.2s', () => {
    const words = [
      w('a', 'Hi', 0, 0.3),
      w('b', 'there.', 0.4, 0.8),
      w('c', 'Next', 0.8 + PARAGRAPH_GAP + 0.4, 2.6),
      w('d', 'line.', 2.7, 3.1)
    ]
    expect(paragraphIds(words, 0)).toEqual(['a', 'b'])
    expect(paragraphIds(words, 1)).toEqual(['a', 'b'])
    expect(paragraphIds(words, 2)).toEqual(['c', 'd'])
    expect(paragraphIds(words, 3)).toEqual(['c', 'd'])
  })

  test('keeps a 1.2s gap inside the same paragraph', () => {
    const words = [w('a', 'Stay', 0, 1), w('b', 'together.', 2.2, 2.8)]
    expect(words[1].start - words[0].end).toBeCloseTo(PARAGRAPH_GAP, 5)
    expect(paragraphIds(words, 0)).toEqual(['a', 'b'])
    expect(paragraphIds(words, 1)).toEqual(['a', 'b'])
  })
})

describe('snapTime word edges', () => {
  test('snaps program time to a word start and end', () => {
    const project = createDemoProject()
    const word = project.transcript.words[0]
    const start = sourceToProgramOf(project, word.start)
    const end = sourceToProgramOf(project, word.end)
    expect(snapTime(project, start + 0.05)).toBeCloseTo(start, 3)
    expect(snapTime(project, end - 0.05)).toBeCloseTo(end, 3)
  })

  test('snaps to word edges after silence is cut', () => {
    const cut = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    const first = cut.transcript.words.find((word) => word.text === 'First')
    expect(first).toBeTruthy()
    const start = sourceToProgramOf(cut, first!.start)
    expect(snapTime(cut, start + 0.08)).toBeCloseTo(start, 2)
    expect(snapTime(cut, start + 0.4)).not.toBeCloseTo(start, 2)
  })
})

describe('covering applied suggestion', () => {
  test('prefers the applied suggestion that covers a span', () => {
    const cut = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    const silence = cut.suggestions.find((s) => s.type === 'silence' && s.applied)
    expect(silence).toBeTruthy()
    const hit = coveringAppliedSuggestion(cut, silence!.start + 0.2, silence!.start + 0.5)
    expect(hit?.id).toBe(silence!.id)
  })
})
