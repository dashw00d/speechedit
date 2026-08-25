import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createDemoProject } from './demo'
import { applyCaptionStyleToAllFromContext } from './captionStyle'
import { addSceneLowerThirdsFromContext } from './lowerThird'
import { useEditor } from '../store'

describe('caption style all', () => {
  test('needs a selected title with siblings', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    expect(applyCaptionStyleToAllFromContext()).toEqual({
      toast: 'Select a title or caption first.',
      applied: false
    })
  })

  test('copies the selected look onto every title', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    addSceneLowerThirdsFromContext()
    const editor = useEditor.getState()
    const clipId = editor.selectedClipId
    expect(clipId).toBeTruthy()
    editor.dispatch({ type: 'setCaptionStyle', clipId: clipId!, style: { fill: '#ff00aa' } })
    const result = applyCaptionStyleToAllFromContext()
    expect(result.applied).toBe(true)
    expect(result.toast).toMatch(/every title/)
    const texts = useEditor
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .filter((clip) => clip.text)
    expect(texts.length).toBeGreaterThan(1)
    expect(texts.every((clip) => clip.style?.fill === '#ff00aa')).toBe(true)
  })

  test('the command still paints every text clip', () => {
    const titled = applyCommand(createDemoProject(), { type: 'addLowerThirds' })
    const styled = applyCommand(titled, { type: 'setCaptionStyleAll', style: { fill: '#112233' } })
    const texts = styled.tracks.flatMap((track) => track.clips).filter((clip) => clip.text)
    expect(texts.every((clip) => clip.style?.fill === '#112233')).toBe(true)
  })
})
