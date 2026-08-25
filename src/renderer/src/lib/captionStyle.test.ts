import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createDemoProject } from './demo'
import {
  applyCaptionStyleToAllFromContext,
  canApplyCaptionStyleAll,
  captionLookOf,
  describeStyleAll,
  nextTextClip,
  textClipsOf
} from './captionStyle'
import { addSceneLowerThirdsFromContext } from './lowerThird'
import { applyTitleFromContext } from './title'
import { isZoomClip } from './zoom'
import { useEditor, usePlayback } from '../store'

describe('caption style all', () => {
  test('after chapter names, the first card is the look even with no selection', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    addSceneLowerThirdsFromContext()
    useEditor.setState({ selectedClipId: null })
    expect(canApplyCaptionStyleAll(useEditor.getState().project, null)).toBe(true)
    const first = textClipsOf(useEditor.getState().project)[0]!
    useEditor.getState().selectClip(first.id)
    useEditor.getState().dispatch({
      type: 'setCaptionStyle',
      clipId: first.id,
      style: { fill: '#00aa88' }
    })
    const result = applyCaptionStyleToAllFromContext()
    expect(result.applied).toBe(true)
    const texts = textClipsOf(useEditor.getState().project)
    const next = nextTextClip(useEditor.getState().project, first.id)
    expect(result.toast).toBe(describeStyleAll(texts.length, next?.text))
    expect(result.toast).toMatch(/Export/)
    expect(texts.every((clip) => clip.style?.fill === '#00aa88')).toBe(true)
    expect(useEditor.getState().selectedClipId).toBeNull()
    expect(usePlayback.getState().playing).toBe(true)
    expect(usePlayback.getState().loopFrom).toBeCloseTo(next!.start, 2)
  })

  test('copies fill, stroke, and size but keeps each card’s seat', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    applyTitleFromContext()
    addSceneLowerThirdsFromContext()
    const title = textClipsOf(useEditor.getState().project).find((clip) => clip.style?.position === 'center')!
    const name = textClipsOf(useEditor.getState().project).find((clip) => clip.style?.position === 'lower')!
    expect(title).toBeTruthy()
    expect(name).toBeTruthy()
    useEditor.getState().selectClip(title.id)
    useEditor.getState().dispatch({
      type: 'setCaptionStyle',
      clipId: title.id,
      style: { fill: '#ff00aa', stroke: '#110000', fontSize: 72, position: 'center', align: 'center' }
    })
    expect(captionLookOf(useEditor.getState().project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === title.id)!)).toEqual({
      fill: '#ff00aa',
      stroke: '#110000',
      fontSize: 72
    })
    const result = applyCaptionStyleToAllFromContext()
    expect(result.applied).toBe(true)
    const texts = textClipsOf(useEditor.getState().project)
    expect(texts.every((clip) => clip.style?.fill === '#ff00aa')).toBe(true)
    expect(texts.every((clip) => clip.style?.fontSize === 72)).toBe(true)
    expect(texts.some((clip) => clip.style?.position === 'lower')).toBe(true)
    expect(texts.some((clip) => clip.style?.position === 'center')).toBe(true)
  })

  test('the command still paints every text clip', () => {
    const titled = applyCommand(createDemoProject(), { type: 'addLowerThirds' })
    const styled = applyCommand(titled, { type: 'setCaptionStyleAll', style: { fill: '#112233' } })
    const texts = textClipsOf(styled)
    expect(texts.every((clip) => clip.style?.fill === '#112233')).toBe(true)
  })

  test('a zoom punch-in is not a title to restyle', () => {
    const zoomed = applyCommand(createDemoProject(), {
      type: 'addZoom',
      start: 8,
      duration: 3,
      scale: 1.45
    })
    const painted = applyCommand(zoomed, { type: 'setCaptionStyleAll', style: { fill: '#ffcc00', position: 'center' } })
    const zoom = painted.tracks.flatMap((track) => track.clips).find((clip) => isZoomClip(clip))
    expect(textClipsOf(painted).some((clip) => clip.text === 'ZOOM')).toBe(false)
    expect(zoom?.style?.fill).not.toBe('#ffcc00')
    expect(zoom?.style?.position).not.toBe('center')
  })

  test('a redaction is not a title to restyle', () => {
    const redacted = applyCommand(createDemoProject(), {
      type: 'addRedaction',
      start: 8,
      duration: 4
    })
    expect(textClipsOf(redacted).some((clip) => clip.text === 'REDACT')).toBe(false)
  })
})
