import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createDemoProject } from './demo'
import { useEditor, usePlayback } from '../store'
import {
  addSceneLowerThirdsFromContext,
  applyLowerThirdFromContext,
  hasLowerThird,
  isLowerThirdCard,
  LOWER_THIRD_PLACEHOLDER,
  lowerThirdPlacement
} from './lowerThird'
import { hasSceneLowerThirds } from './captions'
import { applyTitleFromContext, hasOpeningTitle } from './title'

describe('lower third', () => {
  test('the studio demo has no name on screen yet', () => {
    const demo = createDemoProject()
    expect(hasLowerThird(demo)).toBe(false)
    expect(lowerThirdPlacement(demo, 20)).toEqual({ start: 20, duration: 3, at: 'playhead' })
  })

  test('after an opening title at the head, the first name follows the card', () => {
    const titled = applyCommand(createDemoProject(), {
      type: 'addTitle',
      start: 0,
      duration: 3,
      text: 'Sprint 14',
      preset: 'title'
    })
    expect(hasOpeningTitle(titled)).toBe(true)
    expect(lowerThirdPlacement(titled, 0)).toEqual({ start: 3, duration: 3, at: 'after-title' })
    expect(lowerThirdPlacement(titled, 20)).toEqual({ start: 20, duration: 3, at: 'playhead' })
  })

  test('a lower third at 0 is not mistaken for an opening title', () => {
    const named = applyCommand(createDemoProject(), {
      type: 'addTitle',
      start: 0,
      duration: 3,
      text: 'Name',
      preset: 'lower-third'
    })
    expect(hasLowerThird(named)).toBe(true)
    expect(hasOpeningTitle(named)).toBe(false)
  })

  test('applyLowerThirdFromContext lands a Name card and selects it', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    usePlayback.getState().seekProgram(20)
    const { toast, placement } = applyLowerThirdFromContext()
    expect(placement.at).toBe('playhead')
    expect(placement.start).toBe(20)
    expect(toast).toMatch(/Type/)
    const editor = useEditor.getState()
    const clip = editor.project.tracks.flatMap((track) => track.clips).find((row) => row.id === editor.selectedClipId)
    expect(clip?.text).toBe(LOWER_THIRD_PLACEHOLDER)
    expect(clip?.style?.position).toBe('lower')
    expect(editor.inspectorTab).toBe('caption')
    expect(isLowerThirdCard(clip)).toBe(true)
    expect(hasLowerThird(editor.project)).toBe(true)
  })

  test('after a title at 0 with the playhead on the card, the name follows it', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    usePlayback.getState().seekProgram(0)
    applyTitleFromContext()
    const { placement } = applyLowerThirdFromContext()
    expect(placement).toEqual({ start: 3, duration: 3, at: 'after-title' })
  })

  test('addSceneLowerThirdsFromContext puts a name on every chapter', () => {
    const demo = createDemoProject()
    expect(hasSceneLowerThirds(demo)).toBe(false)
    useEditor.getState().loadProject(demo, { clean: true })
    usePlayback.getState().seekProgram(0)
    const result = addSceneLowerThirdsFromContext()
    expect(result.added).toBe(true)
    expect(result.toast).toMatch(/Apply style/)
    const editor = useEditor.getState()
    expect(hasSceneLowerThirds(editor.project)).toBe(true)
    const selected = editor.project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === editor.selectedClipId)
    expect(selected?.text).toMatch(/Thesis/)
    expect(editor.inspectorTab).toBe('caption')
    expect(addSceneLowerThirdsFromContext().added).toBe(false)
  })
})
