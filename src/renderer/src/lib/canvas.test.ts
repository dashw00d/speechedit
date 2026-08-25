import { describe, expect, test } from 'bun:test'
import { createDemoProject } from './demo'
import { coverCropOrigin } from './exportGraph'
import { isVerticalFrame, setFrameFromContext, VERTICAL_FRAME, YOUTUBE_FRAME } from './canvas'
import { useEditor, usePlayback } from '../store'

describe('vertical 9:16 frame', () => {
  test('a tall canvas centers the cover crop so a 16:9 face is not left-aligned', () => {
    const origin = coverCropOrigin({ width: 1080, height: 1920 }, { scale: 1, x: 0, y: 0 })
    expect(origin.x).toBe('(iw-1080)/2+0')
    expect(origin.y).toBe('(ih-1920)/2+0')
    const panned = coverCropOrigin({ width: 1080, height: 1920 }, { scale: 1, x: 80, y: -40 })
    expect(panned.x).toBe('(iw-1080)/2+80')
    expect(panned.y).toBe('(ih-1920)/2+-40')
  })

  test('a wide canvas keeps the existing zoom crop math', () => {
    const origin = coverCropOrigin({ width: 1920, height: 1080 }, { scale: 1.45, x: 0, y: 0 })
    expect(origin.x).toBe(Math.round(1920 / 2 - Math.round(1920 * 1.45) / 2))
  })

  test('setFrameFromContext switches the canvas and turns Safe on for 9:16', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    expect(isVerticalFrame(useEditor.getState().project)).toBe(false)
    const vertical = setFrameFromContext('vertical')
    expect(vertical.toast).toMatch(/9:16/)
    expect(vertical.toast).toMatch(/Left, Center, or Right/)
    const editor = useEditor.getState()
    expect(editor.project.width).toBe(VERTICAL_FRAME.width)
    expect(editor.project.height).toBe(VERTICAL_FRAME.height)
    expect(editor.showSafeZone).toBe(true)
    expect(isVerticalFrame(editor.project)).toBe(true)
    expect(setFrameFromContext('youtube').toast).toMatch(/16:9/)
    expect(useEditor.getState().project).toMatchObject(YOUTUBE_FRAME)
  })

  test('9:16 with marks loops the clip so you see it tall', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    useEditor.getState().dispatch({ type: 'setMarks', markIn: 0.42, markOut: 6.5 })
    setFrameFromContext('vertical')
    expect(usePlayback.getState().loopFrom).toBeCloseTo(0.42, 2)
    expect(usePlayback.getState().playing).toBe(true)
  })
})
