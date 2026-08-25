import { describe, expect, test } from 'bun:test'
import { leftoverItems } from './analysis'
import { createDemoProject } from './demo'
import { leftoverSpeedFromContext, leftoverSpeedTarget } from './leftoverSpeed'
import { useEditor } from '../store'

describe('leftover speed from context', () => {
  test('demo leftover activity is the first wait to speed', () => {
    const demo = createDemoProject()
    const activity = leftoverItems(demo, 'activity')[0]
    expect(activity).toBeTruthy()
    expect(leftoverSpeedTarget(demo, null)?.id).toBe(activity!.id)
  })

  test('a selected breath still speeds the first wait', () => {
    const demo = createDemoProject()
    const activity = leftoverItems(demo, 'activity')[0]
    const breath = leftoverItems(demo, 'breath')[0]
    expect(activity && breath).toBeTruthy()
    expect(leftoverSpeedTarget(demo, breath!.id)?.id).toBe(activity!.id)
  })

  test('speeds the demo click-through and points at the next leftover', () => {
    const demo = createDemoProject()
    useEditor.getState().loadProject(demo, { clean: true })
    const before = leftoverItems(useEditor.getState().project, 'activity').length
    expect(before).toBeGreaterThan(0)
    const result = leftoverSpeedFromContext()
    expect(result.sped).toBe(true)
    expect(result.toast).toMatch(/Sped the wait 4×/)
    expect(leftoverItems(useEditor.getState().project, 'activity')).toHaveLength(before - 1)
    expect(useEditor.getState().project.styles.some((style) => style.speed === 4)).toBe(true)
  })
})
