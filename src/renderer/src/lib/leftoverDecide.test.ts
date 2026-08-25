import { describe, expect, test } from 'bun:test'
import { leftoverItems } from './analysis'
import { createDemoProject } from './demo'
import {
  leftoverActiveTarget,
  leftoverCutFromContext,
  leftoverCutTarget,
  leftoverHearFromContext,
  leftoverHearLabel,
  leftoverHearTarget,
  leftoverAllows,
  leftoverIsBreath,
  leftoverKeepFromContext
} from './leftoverDecide'
import { useEditor } from '../store'

describe('leftover cut and keep from context', () => {
  test('hear leftover loops the first quiet click-through', () => {
    const demo = createDemoProject()
    const activity = leftoverItems(demo, 'activity')[0]
    expect(leftoverHearTarget(demo, null)?.id).toBe(activity!.id)
    useEditor.getState().loadProject(demo, { clean: true })
    const result = leftoverHearFromContext()
    expect(result.heard).toBe(true)
    expect(result.toast).toMatch(/Hearing this leftover/)
    expect(useEditor.getState().selectedSuggestionId).toBe(activity!.id)
    expect(leftoverActiveTarget(demo, null)).toBeNull()
    expect(leftoverActiveTarget(useEditor.getState().project, activity!.id)?.id).toBe(activity!.id)
  })

  test('demo leftover activity is the first fidget to cut', () => {
    const demo = createDemoProject()
    const activity = leftoverItems(demo, 'activity')[0]
    expect(activity).toBeTruthy()
    expect(leftoverCutTarget(demo, null)?.id).toBe(activity!.id)
  })

  test('cuts the demo click-through and closes the gap', () => {
    const demo = createDemoProject()
    useEditor.getState().loadProject(demo, { clean: true })
    const before = leftoverItems(useEditor.getState().project, 'activity').length
    const result = leftoverCutFromContext()
    expect(result.cut).toBe(true)
    expect(result.toast).toMatch(/Cut the leftover/)
    expect(leftoverItems(useEditor.getState().project, 'activity')).toHaveLength(before - 1)
    expect(useEditor.getState().project.cuts.some((cut) => cut.start < 23.6 && cut.end > 22.5)).toBe(true)
  })

  test('keeps the demo click-through so Auto Edit will skip it', () => {
    const demo = createDemoProject()
    useEditor.getState().loadProject(demo, { clean: true })
    const before = leftoverItems(useEditor.getState().project, 'activity').length
    const result = leftoverKeepFromContext()
    expect(result.kept).toBe(true)
    expect(result.toast).toMatch(/Protected/)
    expect(leftoverItems(useEditor.getState().project, 'activity')).toHaveLength(before - 1)
    expect(useEditor.getState().project.tags.some((tag) => tag.kind === 'keep' && tag.start < 23 && tag.end > 23)).toBe(
      true
    )
  })

  test('after the last picture leftover the next leftover is a breath you can Cut or Keep', () => {
    const demo = createDemoProject()
    const breath = leftoverItems(demo, 'breath')[0]
    expect(breath).toBeTruthy()
    expect(leftoverAllows(breath!, 'cut')).toBe(true)
    expect(leftoverAllows(breath!, 'keep')).toBe(true)
    expect(leftoverAllows(breath!, 'demo')).toBe(false)
    useEditor.getState().loadProject(demo, { clean: true })
    const handed = leftoverCutFromContext()
    expect(handed.toast).toMatch(/next breath/)
    expect(leftoverActiveTarget(useEditor.getState().project, useEditor.getState().selectedSuggestionId)?.id).toBe(
      breath!.id
    )
    expect(leftoverIsBreath(leftoverActiveTarget(useEditor.getState().project, useEditor.getState().selectedSuggestionId))).toBe(
      true
    )
    const heard = leftoverHearFromContext()
    expect(heard.toast).toMatch(/Hearing this breath/)
    expect(heard.toast).toMatch(/hisses/)
    expect(leftoverHearLabel(leftoverItems(useEditor.getState().project, 'breath').length)).toBe('Hear breath')
    const result = leftoverCutFromContext()
    expect(result.cut).toBe(true)
    expect(leftoverItems(useEditor.getState().project, 'breath')).toHaveLength(0)
    expect(leftoverHearTarget(useEditor.getState().project, null)).toBeNull()
    expect(useEditor.getState().selectedSuggestionId).toBeNull()
    expect(result.toast).toMatch(/is next/)
    expect(result.toast).toMatch(/Clean \d+ pauses|Apply \d+ safe/)
  })
})
