import { expect, test } from 'bun:test'
import { focusForWords, parseReviewFragment, resolveReviewFocus, reviewFragment, reviewPlaybackRange } from './reviewLinks'
import type { ReviewSnapshot } from '../../../shared/review'

const words = [{ id: 'zero', text: 'Oh', start: 0, end: 0, deleted: false }, { id: 'a', text: 'Hello', start: 6, end: 6.5, deleted: false }, { id: 'b', text: 'friend', start: 6.5, end: 7, deleted: false }]
const snapshot: ReviewSnapshot = { projectId: 'p', name: 'Video', sourceDuration: 10, words, assets: [], scenes: [], cuts: [], protected: [] }
test('passage fragment preserves legacy keys and round-trips questions without query strings', () => {
  expect(parseReviewFragment('#secret')).toEqual({ key: 'secret' })
  const focus = focusForWords(words, ['a', 'b'], 'Is “hello” right? & # café')!
  const fragment = reviewFragment('secret', focus)
  expect(parseReviewFragment(`#${fragment}`)).toEqual({ key: 'secret', focus })
  expect(resolveReviewFocus(snapshot, focus)?.words.map(w => w.id)).toEqual(['a', 'b'])
  expect(focus.start).toBe(6); expect(focus.end).toBe(7)
})
test('bad ranges cannot seek outside the recording; zero-duration words remain addressable', () => {
  for (const range of ['start=NaN&end=2', 'start=-1&end=2', 'start=4&end=3', 'start=0&end=Infinity', 'start=0']) expect(parseReviewFragment(`#key&${range}`).focus).toBeUndefined()
  expect(resolveReviewFocus(snapshot, { start: 15, end: 20 })).toBeUndefined()
  expect(focusForWords(words, ['missing'])).toBeUndefined()
  expect(focusForWords(words, ['a', 'missing'])).toBeUndefined()
  expect(resolveReviewFocus(snapshot, focusForWords(words, ['zero']))?.words).toEqual([words[0]])
})
test('source-only passage links work without a transcript and playback stays bounded', () => {
  expect(resolveReviewFocus({ ...snapshot, words: [] }, { start: 6, end: 7 })?.focus).toEqual({ start: 6, end: 7 })
  expect(reviewPlaybackRange({ start: 0, end: 0 }, 10)).toEqual({ start: 0, end: 2 })
  expect(reviewPlaybackRange({ start: 9, end: 10 }, 10)).toEqual({ start: 8, end: 10 })
  expect(reviewPlaybackRange({ start: 5, end: 300 }, 500)).toEqual({ start: 4, end: 19 })
})
