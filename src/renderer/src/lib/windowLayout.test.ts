import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
  windowFitsWorkArea,
  workspacePaneFromHotkey
} from '../../../shared/windowLayout'

describe('small-laptop window', () => {
  test('a 1280×720 Windows work area can contain the app after the taskbar', () => {
    expect(WINDOW_MIN_WIDTH).toBeLessThanOrEqual(1280)
    expect(WINDOW_MIN_HEIGHT).toBeLessThanOrEqual(720 - 40)
    expect(windowFitsWorkArea(1280, 720 - 48)).toBe(true)
    expect(windowFitsWorkArea(1366, 768 - 48)).toBe(true)
    expect(windowFitsWorkArea(1280, 500)).toBe(false)
  })

  test('the previous 1100×720 floor would not fit a 720p work area', () => {
    expect(720).toBeGreaterThan(720 - 48)
    expect(WINDOW_MIN_HEIGHT).toBeLessThan(720)
  })

  test('Alt+1…4 map to the collapsed workspace panes', () => {
    expect(workspacePaneFromHotkey({ key: '1', code: 'Digit1', altKey: true })).toBe('preview')
    expect(workspacePaneFromHotkey({ key: '2', code: 'Digit2', altKey: true })).toBe('review')
    expect(workspacePaneFromHotkey({ key: '3', code: 'Digit3', altKey: true })).toBe('script')
    expect(workspacePaneFromHotkey({ key: '4', code: 'Digit4', altKey: true })).toBe('timeline')
    expect(workspacePaneFromHotkey({ key: '1', code: 'Digit1', altKey: false })).toBeNull()
  })

  test('styles let transport controls wrap and shrink chrome on laptop viewports', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
    expect(css.match(/\.transport \{([^}]+)\}/)?.[1]).toContain('flex-wrap: wrap')
    expect(css.match(/\.transport-context:empty \{([^}]+)\}/)?.[1]).toContain('display: none')
    expect(css).toContain('@media (max-width: 1366px)')
    expect(css).toContain('@media (max-height: 768px)')
    expect(css).toContain('--layout-timeline-max-height: 220px')
  })
})
