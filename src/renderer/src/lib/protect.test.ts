import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { gapInspectorDetail, suggestionInspectorDetail, toastForEdit } from './contextActions'
import { createDemoProject } from './demo'
import {
  describeProtect,
  longestCutPause,
  protectCutTarget,
  protectFromContext,
  protectParkedCut,
  rangeWasCut
} from './protect'
import { useEditor } from '../store'

describe('protect a cut think-aloud pause', () => {
  test('Clean cuts the long demo pause', () => {
    const cut = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    expect(rangeWasCut(cut, 6.5, 16.2)).toBe(true)
    expect(describeProtect(cut, 6.5, 16.2)).toMatch(/put back/)
    expect(describeProtect(createDemoProject(), 6.5, 16.2)).toBe('Protected. Auto Edit will skip this.')
  })

  test('a cut pause offers Protect that puts the air back and keeps it', () => {
    const cut = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    const detail = gapInspectorDetail(cut, 6.5, 16.2)
    expect(detail?.title).toBe('Cut pause')
    expect(detail?.actions.some((action) => action.id === 'put-back')).toBe(true)
    const protect = detail?.actions.find((action) => action.id === 'keep')
    expect(protect?.label).toBe('Protect')
    expect(protect?.command?.type).toBe('addTag')
    expect(toastForEdit(cut, protect!.command!)).toMatch(/put back/)
    const next = applyCommand(cut, protect!.command!)
    expect(rangeWasCut(next, 6.5, 16.2)).toBe(false)
    expect(next.tags.some((tag) => tag.kind === 'keep' && tag.start <= 6.6 && tag.end >= 16)).toBe(true)
  })

  test('an applied silence suggestion offers the same Protect', () => {
    const cut = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    const silence = cut.suggestions.find((row) => row.type === 'silence' && row.applied && row.start < 10)
    expect(silence).toBeTruthy()
    const detail = suggestionInspectorDetail(cut, silence!.id)
    const protect = detail?.actions.find((action) => action.id === 'keep')
    expect(protect?.label).toBe('Protect')
    const next = applyCommand(cut, protect!.command!)
    expect(next.suggestions.find((row) => row.id === silence!.id)?.applied).toBe(false)
    expect(next.suggestions.find((row) => row.id === silence!.id)?.blockedBy).toBeTruthy()
  })

  test('longest cut pause is the think-aloud Clean took', () => {
    const cut = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    const span = longestCutPause(cut)
    expect(span).toBeTruthy()
    expect(span!.end - span!.start).toBeGreaterThan(8)
    expect(rangeWasCut(cut, span!.start, span!.end)).toBe(true)
  })

  test('protectFromContext puts the longest cut back without a selection', () => {
    const cut = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    useEditor.getState().loadProject(cut, { clean: true })
    useEditor.getState().selectGap(null)
    useEditor.getState().selectWords([])
    useEditor.getState().selectScene(null)
    const result = protectFromContext()
    expect(result.started).toBe(true)
    expect(result.toast).toMatch(/put back/)
    const span = longestCutPause(cut)!
    expect(rangeWasCut(useEditor.getState().project, span.start, span.end)).toBe(false)
    expect(useEditor.getState().project.tags.some((tag) => tag.kind === 'keep' && tag.start <= span.start + 0.1)).toBe(
      true
    )
    const next = protectCutTarget(useEditor.getState().project)
    if (next) expect(next.start).not.toBeCloseTo(span.start, 1)
  })

  test('a parked cut is Protect on the row; a distant longest cut is not', () => {
    const cut = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    useEditor.getState().loadProject(cut, { clean: true })
    useEditor.getState().selectGap(null)
    useEditor.getState().selectWords([])
    useEditor.getState().selectScene(null)
    expect(protectParkedCut(cut)).toBeNull()
    expect(protectCutTarget(cut)).toBeTruthy()
    useEditor.getState().selectGap({ start: 6.5, end: 16.2 })
    const parked = protectParkedCut(useEditor.getState().project)
    expect(parked?.start).toBeCloseTo(6.5, 1)
    expect(parked?.end).toBeCloseTo(16.2, 1)
  })

  test('protectFromContext uses the selected cut pause', () => {
    const cut = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    useEditor.getState().loadProject(cut, { clean: true })
    useEditor.getState().selectGap({ start: 6.5, end: 16.2 })
    const result = protectFromContext()
    expect(result.started).toBe(true)
    expect(result.toast).toMatch(/put back/)
    expect(useEditor.getState().project.tags.some((tag) => tag.kind === 'keep')).toBe(true)
    expect(rangeWasCut(useEditor.getState().project, 6.5, 16.2)).toBe(false)
  })
})
