import { describe, expect, test } from 'bun:test'
import { TOAST_UNDONE, toastOffersUndo } from './toastActions'

describe('toast undo affordance', () => {
  test('offers undo when the message says so and history exists', () => {
    expect(toastOffersUndo('Removed the pause. Undo to put it back.', true)).toBe(true)
    expect(toastOffersUndo('Removed 3 pauses. 2 decisions need review. Undo to put them back.', true)).toBe(true)
    expect(toastOffersUndo('Dropped 2 false takes. Undo to put them back.', true)).toBe(true)
  })
  test('never offers undo without history or a hint', () => {
    expect(toastOffersUndo('Removed the pause. Undo to put it back.', false)).toBe(false)
    expect(toastOffersUndo(null, true)).toBe(false)
    expect(toastOffersUndo('Transcript ready · 61 words · 6 chapters.', true)).toBe(false)
    expect(toastOffersUndo('Installing local Whisper… Cancel import to skip.', true)).toBe(false)
  })
  test('does not match words that merely contain undo', () => {
    expect(toastOffersUndo('Undocumented behavior', true)).toBe(false)
    expect(toastOffersUndo('The fundamental cut', true)).toBe(false)
  })
  test('undo confirmation names the redo path', () => {
    expect(TOAST_UNDONE).toMatch(/Redo/)
  })
})
