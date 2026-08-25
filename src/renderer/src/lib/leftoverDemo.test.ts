import { describe, expect, test } from 'bun:test'
import { leftoverItems } from './analysis'
import { createDemoProject } from './demo'
import { leftoverDemoFromContext, leftoverDemoTarget } from './leftoverDemo'
import { useEditor } from '../store'

describe('leftover silent demo from context', () => {
  test('demo leftover activity is the first walkthrough to keep', () => {
    const demo = createDemoProject()
    const activity = leftoverItems(demo, 'activity')[0]
    expect(activity).toBeTruthy()
    expect(leftoverDemoTarget(demo, null)?.id).toBe(activity!.id)
  })

  test('keeps the demo click-through as a silent demo', () => {
    const demo = createDemoProject()
    useEditor.getState().loadProject(demo, { clean: true })
    const before = leftoverItems(useEditor.getState().project, 'activity').length
    const result = leftoverDemoFromContext()
    expect(result.kept).toBe(true)
    expect(result.toast).toMatch(/Silent demo/)
    expect(leftoverItems(useEditor.getState().project, 'activity')).toHaveLength(before - 1)
    expect(useEditor.getState().project.tags.some((tag) => tag.kind === 'demo')).toBe(true)
  })
})
