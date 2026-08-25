import { describe, expect, test } from 'bun:test'
import { seekSlop, shouldSeek } from './seek'

describe('paused seek vs playback slop', () => {
  test('paused scrub snaps within one frame; play allows decoder drift', () => {
    expect(seekSlop(false, 30)).toBeCloseTo(1 / 30, 6)
    expect(seekSlop(true, 30)).toBe(0.16)
    expect(shouldSeek(1.0, 1.04, false, 30)).toBe(true)
    expect(shouldSeek(1.0, 1.02, false, 30)).toBe(false)
    expect(shouldSeek(1.0, 1.04, true, 30)).toBe(false)
    expect(shouldSeek(1.0, 1.2, true, 30)).toBe(true)
  })
})
