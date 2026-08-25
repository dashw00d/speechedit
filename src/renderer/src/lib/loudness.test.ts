import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createDemoProject } from './demo'
import { NORMALIZE_OFF_TOAST, NORMALIZE_ON_TOAST, setNormalizeFromContext, toggleNormalizeFromContext } from './loudness'
import { useEditor } from '../store'

describe('master normalize', () => {
  test('the studio demo starts quiet and Clean arms -16 LUFS', () => {
    const demo = createDemoProject()
    expect(demo.audioMaster.normalize).toBe(false)
    expect(applyCommand(demo, { type: 'applySafeSuggestions' }).audioMaster.normalize).toBe(true)
  })

  test('toggleNormalizeFromContext turns the master on, then off', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    const on = toggleNormalizeFromContext()
    expect(on.on).toBe(true)
    expect(on.toast).toBe(NORMALIZE_ON_TOAST)
    expect(useEditor.getState().project.audioMaster.normalize).toBe(true)
    const off = toggleNormalizeFromContext()
    expect(off.on).toBe(false)
    expect(off.toast).toBe(NORMALIZE_OFF_TOAST)
    expect(useEditor.getState().project.audioMaster.normalize).toBe(false)
  })

  test('setNormalizeFromContext can arm without toggling', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    expect(setNormalizeFromContext(true).on).toBe(true)
    expect(setNormalizeFromContext(true).on).toBe(true)
    expect(useEditor.getState().project.audioMaster.normalize).toBe(true)
  })
})
