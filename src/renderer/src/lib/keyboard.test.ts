import { describe, expect, test } from 'bun:test'
import { shouldIgnoreEditorShortcut } from './keyboard'

const workspace = { overlayOpen: false, editingText: false, nativeControl: false }
const textField = { ...workspace, editingText: true }
const key = (value: string, patch = {}) => ({ key: value, keyCode: 0, defaultPrevented: false, isComposing: false, metaKey: false, ctrlKey: false, ...patch })

describe('editor keyboard ownership', () => {
  test('Space, Delete, and Undo work in an unobstructed workspace', () => {
    for (const event of [key(' '), key('Delete'), key('z', { ctrlKey: true })]) {
      expect(shouldIgnoreEditorShortcut(event, workspace)).toBe(false)
    }
  })
  test('typing and native text Undo never edit the project', () => {
    for (const event of [key('s'), key('Delete'), key(' '), key('z', { ctrlKey: true }), key('z', { metaKey: true })]) {
      expect(shouldIgnoreEditorShortcut(event, textField)).toBe(true)
    }
  })
  test('Save and action search remain available from text fields', () => {
    for (const event of [key('s', { ctrlKey: true }), key('s', { metaKey: true }), key('k', { ctrlKey: true })]) {
      expect(shouldIgnoreEditorShortcut(event, textField)).toBe(false)
    }
  })
  test('open dialogs and menus block edits even when the field is not focused', () => {
    for (const event of [key('Delete'), key('z', { ctrlKey: true }), key(' '), key('s')]) {
      expect(shouldIgnoreEditorShortcut(event, { ...workspace, overlayOpen: true })).toBe(true)
    }
  })
  test('Space activates a focused button instead of toggling playback too', () => {
    expect(shouldIgnoreEditorShortcut(key(' '), { ...workspace, nativeControl: true })).toBe(true)
    expect(shouldIgnoreEditorShortcut(key('ArrowRight'), { ...workspace, nativeControl: true })).toBe(true)
  })
  test('IME composition and already-handled events never become edit commands', () => {
    for (const event of [key('s', { isComposing: true }), key('Delete', { keyCode: 229 }), key('Delete', { defaultPrevented: true })]) {
      expect(shouldIgnoreEditorShortcut(event, workspace)).toBe(true)
    }
  })
})
