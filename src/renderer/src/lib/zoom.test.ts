import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createDemoProject } from './demo'
import { useEditor, usePlayback } from '../store'
import { applyZoomFromContext, DEFAULT_ZOOM_SCALE, FALLBACK_ZOOM_DURATION, zoomPlacement } from './zoom'

describe('zoom placement', () => {
  test('playhead is a 3s punch-in when nothing is selected', () => {
    const placed = zoomPlacement(createDemoProject(), 12, [], null)
    expect(placed).toEqual({
      start: 12,
      duration: FALLBACK_ZOOM_DURATION,
      scale: DEFAULT_ZOOM_SCALE,
      basis: 'playhead'
    })
  })

  test('selected words cover that span when it is long enough', () => {
    const project = createDemoProject()
    const words = project.transcript.words.filter((word) => word.start >= 0.42 && word.end <= 6.5)
    const placed = zoomPlacement(
      project,
      0,
      words.map((word) => word.id),
      null
    )
    expect(placed.basis).toBe('words')
    expect(placed.duration).toBeGreaterThan(2)
    expect(placed.scale).toBe(DEFAULT_ZOOM_SCALE)
  })

  test('a selected chapter covers the scene', () => {
    const placed = zoomPlacement(createDemoProject(), 0, [], 'sc_demo')
    expect(placed.basis).toBe('scene')
    expect(placed.start).toBeCloseTo(23.7, 1)
    expect(placed.duration).toBeCloseTo(6.5, 1)
  })

  test('a retake heading does not steal the punch-in', () => {
    const placed = zoomPlacement(createDemoProject(), 8, [], 'sc_false')
    expect(placed.basis).toBe('playhead')
    expect(placed.start).toBe(8)
    expect(placed.duration).toBe(3)
  })

  test('playhead inside a silent demo covers that walkthrough', () => {
    const placed = zoomPlacement(createDemoProject(), 26, [], null)
    expect(placed.basis).toBe('scene')
    expect(placed.start).toBeCloseTo(23.7, 1)
    expect(placed.duration).toBeCloseTo(6.5, 1)
  })

  test('selectScene word highlight still zooms the chapter, not a word island', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    useEditor.getState().selectScene('sc_intro')
    const editor = useEditor.getState()
    const placed = zoomPlacement(
      editor.project,
      0,
      editor.selectedWordIds,
      editor.selectedSceneId
    )
    expect(placed.basis).toBe('scene')
    expect(placed.duration).toBeCloseTo(6.08, 1)
  })

  test('applyZoomFromContext drops a zoom clip and selects it', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    useEditor.getState().selectScene('sc_demo')
    usePlayback.getState().seekProgram(0)
    const { placement, toast } = applyZoomFromContext()
    expect(placement.basis).toBe('scene')
    expect(toast).toMatch(/chapter/)
    const project = useEditor.getState().project
    const zoom = project.tracks.flatMap((track) => track.clips).find((clip) => clip.text === 'ZOOM' && clip.start > 20)
    expect(zoom?.transform.scale).toBe(DEFAULT_ZOOM_SCALE)
    expect(zoom?.duration).toBeCloseTo(placement.duration, 1)
    expect(useEditor.getState().selectedClipId).toBe(zoom?.id)
  })

  test('the same addZoom command still works from a playhead placement', () => {
    const placed = zoomPlacement(createDemoProject(), 8, [], null)
    const next = applyCommand(createDemoProject(), {
      type: 'addZoom',
      start: placed.start,
      duration: placed.duration,
      scale: placed.scale
    })
    const zoom = next.tracks.flatMap((track) => track.clips).find((clip) => clip.text === 'ZOOM' && clip.start === 8)
    expect(zoom?.duration).toBe(3)
    expect(zoom?.transform.scale).toBe(DEFAULT_ZOOM_SCALE)
  })
})
