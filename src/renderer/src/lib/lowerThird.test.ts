import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createDemoProject } from './demo'
import { useEditor, usePlayback } from '../store'
import {
  addSceneLowerThirdsFromContext,
  applyLowerThirdFromContext,
  describeLowerThird,
  hasLowerThird,
  isLowerThirdCard,
  LOWER_THIRD_PLACEHOLDER,
  lowerThirdPlacement,
  nameForLowerThird
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

  test('applyLowerThirdFromContext lands the speaker name and points at Fill', () => {
    const demo = createDemoProject()
    useEditor.getState().loadProject(demo, { clean: true })
    usePlayback.getState().seekProgram(20)
    const who = nameForLowerThird(demo, 20, [])
    expect(who).toBe('Ryan')
    const { toast, placement } = applyLowerThirdFromContext()
    expect(placement.at).toBe('playhead')
    expect(placement.start).toBe(20)
    expect(toast).toBe(describeLowerThird(placement, who))
    expect(toast).toMatch(/Fill/)
    expect(usePlayback.getState().programTime).toBeCloseTo(20.15)
    const editor = useEditor.getState()
    const clip = editor.project.tracks.flatMap((track) => track.clips).find((row) => row.id === editor.selectedClipId)
    expect(clip?.text).toBe('Ryan')
    expect(clip?.style?.position).toBe('lower')
    expect(editor.inspectorTab).toBe('caption')
    expect(isLowerThirdCard(clip)).toBe(true)
    expect(hasLowerThird(editor.project)).toBe(true)
  })

  test('a selected chapter covers that beat, not a 3s guess', () => {
    const demo = createDemoProject()
    const walk = demo.scenes.find((row) => row.title === 'Walk the editor')!
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectScene(walk.id)
    usePlayback.getState().seekProgram(0)
    const { toast, placement } = applyLowerThirdFromContext()
    expect(placement.at).toBe('scene')
    expect(placement.start).toBeCloseTo(walk.start, 2)
    expect(placement.duration).toBeCloseTo(walk.end - walk.start, 2)
    expect(toast).toMatch(/this chapter/)
    expect(toast).toMatch(/Fill/)
    const clip = useEditor
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((row) => row.id === useEditor.getState().selectedClipId)
    expect(clip?.duration).toBeCloseTo(walk.end - walk.start, 2)
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
    expect(result.toast).toMatch(/Type this name/)
    expect(result.toast).toMatch(/Enter/)
    expect(result.toast).toMatch(/Fill/)
    const editor = useEditor.getState()
    expect(hasSceneLowerThirds(editor.project)).toBe(true)
    expect(editor.selectedClipId).toBeTruthy()
    const card = editor.project.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.text?.includes('Thesis'))
    expect(card).toBeTruthy()
    const head = usePlayback.getState().programTime
    expect(head).toBeGreaterThanOrEqual(card!.start)
    expect(head).toBeLessThan(card!.start + card!.duration)
    expect(addSceneLowerThirdsFromContext().added).toBe(false)
  })

  test('rewriting a chapter name does not ask for Chapter names again', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    addSceneLowerThirdsFromContext()
    const card = useEditor
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((clip) => clip.text?.includes('Thesis'))
    expect(card).toBeTruthy()
    useEditor.getState().dispatch({ type: 'setText', clipId: card!.id, text: 'Sprint 14' })
    expect(hasSceneLowerThirds(useEditor.getState().project)).toBe(true)
    expect(addSceneLowerThirdsFromContext()).toEqual({
      toast: 'Chapter names are already on the tape.',
      added: false
    })
  })
})
