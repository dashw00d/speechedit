import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createDemoProject } from './demo'
import { applyRedactionFromContext, FALLBACK_REDACT_DURATION, redactionPlacement } from './redaction'
import { useEditor, usePlayback } from '../store'

describe('redaction placement', () => {
  test('playhead is a 4s blur when nothing is selected', () => {
    const placed = redactionPlacement(createDemoProject(), 12, [], null)
    expect(placed).toEqual({ start: 12, duration: FALLBACK_REDACT_DURATION, basis: 'playhead' })
  })

  test('selected words cover that span', () => {
    const project = createDemoProject()
    const words = project.transcript.words.filter((word) => word.start >= 0.42 && word.end <= 6.5)
    const placed = redactionPlacement(
      project,
      0,
      words.map((word) => word.id),
      null
    )
    expect(placed.basis).toBe('words')
    expect(placed.duration).toBeGreaterThan(2)
  })

  test('a selected chapter covers the scene', () => {
    const placed = redactionPlacement(createDemoProject(), 0, [], 'sc_demo')
    expect(placed.basis).toBe('scene')
    expect(placed.start).toBeCloseTo(23.7, 1)
    expect(placed.duration).toBeCloseTo(6.5, 1)
  })

  test('applyRedactionFromContext drops a blur clip and selects it', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    useEditor.getState().selectScene('sc_demo')
    usePlayback.getState().seekProgram(0)
    const { placement, toast } = applyRedactionFromContext()
    expect(placement.basis).toBe('scene')
    expect(toast).toMatch(/Drag the box/)
    const project = useEditor.getState().project
    const blur = project.tracks.flatMap((track) => track.clips).find((clip) => clip.effect === 'blur' && clip.start > 20)
    expect(blur?.duration).toBeCloseTo(placement.duration, 1)
    expect(useEditor.getState().selectedClipId).toBe(blur?.id)
  })

  test('the same addRedaction command still works from a playhead placement', () => {
    const next = applyCommand(createDemoProject(), {
      type: 'addRedaction',
      start: 8,
      duration: FALLBACK_REDACT_DURATION
    })
    const blur = next.tracks.flatMap((track) => track.clips).find((clip) => clip.effect === 'blur' && clip.start === 8)
    expect(blur?.duration).toBe(4)
  })
})
