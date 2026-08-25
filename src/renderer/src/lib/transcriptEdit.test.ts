import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createDemoProject } from './demo'
import { snapTime, sourceToProgramOf } from './resolver'
import {
  allWordsMatchingPhrase,
  coveringAppliedSuggestion,
  extendSelection,
  livePreviousSentence,
  PARAGRAPH_GAP,
  isParagraphSelection,
  paragraphIds,
  restartBeforeWord,
  shrinkSelection
} from './transcriptEdit'
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

  test('a full paragraph selection is not a stray word range', () => {
    const words = [
      w('a', 'Hi', 0, 0.3),
      w('b', 'there.', 0.4, 0.8),
      w('c', 'Next', 0.8 + PARAGRAPH_GAP + 0.4, 2.6)
    ]
    expect(isParagraphSelection(words, ['a', 'b'])).toBe(true)
    expect(isParagraphSelection(words, ['a'])).toBe(false)
    expect(isParagraphSelection(words, ['a', 'c'])).toBe(false)
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

describe('grow and shrink selection', () => {
  test('] adds the next word and [ drops the last', () => {
    const words = [w('a', 'one', 0, 0.2), w('b', 'two', 0.3, 0.5), w('c', 'three', 0.6, 0.8)]
    expect(extendSelection(words, ['a'], 1)).toEqual(['a', 'b'])
    expect(shrinkSelection(words, ['a', 'b', 'c'])).toEqual(['a', 'b'])
    expect(shrinkSelection(words, ['a'])).toEqual(['a'])
  })
})

describe('phrase search', () => {
  test('allWordsMatchingPhrase finds every occurrence', () => {
    const words = [
      w('a', 'cut', 0, 0.2),
      w('b', 'speech', 0.3, 0.6),
      w('c', 'like', 0.7, 0.9),
      w('d', 'text', 1, 1.2),
      w('e', 'cut', 2, 2.2),
      w('f', 'again', 2.3, 2.6)
    ]
    expect(allWordsMatchingPhrase(words, 'cut')).toEqual(['a', 'e'])
    expect(allWordsMatchingPhrase(words, 'cut speech')).toEqual(['a', 'b'])
    expect(allWordsMatchingPhrase(words, 'missing')).toEqual([])
  })
})

describe('false-start previous sentence', () => {
  test('restartBeforeWord is the short live line before a restart', () => {
    const project = createDemoProject()
    const thats = project.transcript.words.find((w) => w.text === "That's")!
    const restart = restartBeforeWord(project.transcript.words, thats.id)
    expect(restart).toBeTruthy()
    expect(restart!.end - restart!.start).toBeLessThan(3)
    expect(restart!.start).toBeCloseTo(30.2, 1)
  })

  test('a long previous chapter is not a restart chip', () => {
    const project = createDemoProject()
    const first = project.transcript.words.find((w) => w.text === 'First')!
    expect(livePreviousSentence(project.transcript.words, first.id)).toBeTruthy()
    expect(restartBeforeWord(project.transcript.words, first.id)).toBeNull()
  })

  test('a dropped previous take is not a live restart', () => {
    const project = createDemoProject()
    const thats = project.transcript.words.find((w) => w.text === "That's")!
    const collapsed = applyCommand(project, { type: 'collapseRetakes' })
    expect(livePreviousSentence(collapsed.transcript.words, thats.id)).toBeNull()
    expect(restartBeforeWord(collapsed.transcript.words, thats.id)).toBeNull()
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
