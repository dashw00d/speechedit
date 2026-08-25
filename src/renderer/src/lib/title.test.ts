import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createDemoProject } from './demo'
import { useEditor, usePlayback } from '../store'
import { applyTitleFromContext, hasOpeningTitle, isTitleCard, titleLabel, titlePlacement } from './title'

describe('opening title', () => {
  test('the studio demo has captions but not a title card at 0', () => {
    expect(hasOpeningTitle(createDemoProject())).toBe(false)
    expect(titlePlacement(createDemoProject(), 12).at).toBe('head')
    expect(titlePlacement(createDemoProject(), 12).start).toBe(0)
    expect(titleLabel(createDemoProject())).toBe('Title')
  })

  test('a second title follows the playhead', () => {
    const titled = applyCommand(createDemoProject(), {
      type: 'addTitle',
      start: 0,
      duration: 3,
      text: 'Sprint 14',
      preset: 'title'
    })
    expect(hasOpeningTitle(titled)).toBe(true)
    expect(titlePlacement(titled, 18)).toEqual({ start: 18, duration: 3, at: 'playhead' })
  })

  test('applyTitleFromContext lands a title at the start and selects it', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    usePlayback.getState().seekProgram(20)
    const { toast, placement } = applyTitleFromContext()
    expect(placement.at).toBe('head')
    expect(toast).toMatch(/Type the subject/)
    const editor = useEditor.getState()
    const clip = editor.project.tracks.flatMap((track) => track.clips).find((row) => row.id === editor.selectedClipId)
    expect(clip?.start).toBe(0)
    expect(clip?.duration).toBe(3)
    expect(clip?.text).toBe('Title')
    expect(editor.inspectorTab).toBe('caption')
    expect(isTitleCard(clip)).toBe(true)
    expect(usePlayback.getState().programTime).toBeCloseTo(0.15)
    expect(usePlayback.getState().playing).toBe(false)
  })
})
