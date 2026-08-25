import { describe, expect, test } from 'bun:test'
import { createDemoProject, createEmptyProject } from './demo'
import { SIDECARS, sidecarById, videoExportCopy } from './exportActions'

describe('export sheet helpers', () => {
  test('common sidecars are ready on the demo and produce a body', () => {
    const demo = createDemoProject()
    const common = SIDECARS.filter((item) => item.group === 'common')
    expect(common.map((item) => item.id)).toEqual(['srt', 'vtt', 'md', 'txt', 'chapters'])
    for (const item of common) {
      expect(item.ready(demo)).toBe(true)
      expect(item.body(demo).length).toBeGreaterThan(20)
    }
    expect(sidecarById('srt').body(demo)).toMatch(/-->/)
    expect(videoExportCopy(demo).ready).toBe(false)
    expect(videoExportCopy(demo).summary).toMatch(/No media file/)
  })

  test('empty reel disables captions and video', () => {
    const empty = createEmptyProject()
    expect(sidecarById('srt').ready(empty)).toBe(false)
    expect(sidecarById('otio').ready(empty)).toBe(false)
    expect(videoExportCopy(empty).summary).toMatch(/Open a recording/)
  })
})
