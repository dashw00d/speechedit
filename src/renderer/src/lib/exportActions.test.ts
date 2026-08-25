import { describe, expect, test } from 'bun:test'
import { createDemoProject, createEmptyProject } from './demo'
import {
  copyToastForSidecar,
  fileToastForSidecar,
  hasExportableCaptions,
  hasYouTubeChapters,
  projectHasPicture,
  SIDECARS,
  sidecarAlsoSaves,
  sidecarById,
  exportPrimaryCopy,
  videoExportCopy,
  youtubeChapterCount
} from './exportActions'

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
    expect(sidecarById('chapters').body(demo)).toMatch(/^0:00 Thesis$/m)
    expect(sidecarById('chapters').ext).toBe('.chapters.txt')
    expect(sidecarById('md').body(demo)).toMatch(/^## Ryan$/m)
    expect(copyToastForSidecar('md')).toMatch(/Chapter headings/)
    expect(copyToastForSidecar('md')).toMatch(/Slack or Notion/)
    expect(
      copyToastForSidecar('md', {
        ...demo,
        tags: [...demo.tags, { id: 'n1', start: 2.9, end: 3.2, kind: 'note', label: 'check the price' }]
      })
    ).toMatch(/mark you typed/)
    expect(copyToastForSidecar('chapters', demo)).toMatch(/Copied \d+ YouTube chapters/)
    expect(copyToastForSidecar('chapters', demo)).toMatch(/description/)
    expect(hasYouTubeChapters(demo)).toBe(true)
    expect(youtubeChapterCount(demo)).toBeGreaterThanOrEqual(2)
    expect(copyToastForSidecar('srt')).toMatch(/Upload the SRT/)
    expect(sidecarAlsoSaves('srt')).toBe(true)
    expect(sidecarAlsoSaves('md')).toBe(false)
    expect(fileToastForSidecar('srt', 'demo.srt')).toMatch(/Upload it next to the MP4/)
    expect(fileToastForSidecar('md', 'Studio demo.md')).toMatch(/Slack or Notion/)
    expect(hasExportableCaptions(demo)).toBe(true)
    expect(videoExportCopy(demo).ready).toBe(false)
    expect(videoExportCopy(demo).summary).toMatch(/No media file/)
    expect(projectHasPicture(demo)).toBe(false)
    const primary = exportPrimaryCopy(demo, { audioOnly: true }, false)
    expect(primary.kind).toBe('pack')
    expect(primary.label).toBe('Download the words')
    expect(exportPrimaryCopy(createEmptyProject(), { audioOnly: true }, false).kind).toBe('blocked')
  })

  test('a video asset means the reel has picture', () => {
    const demo = createDemoProject()
    const asset = Object.values(demo.assets)[0]!
    expect(
      projectHasPicture({
        ...demo,
        assets: { ...demo.assets, [asset.id]: { ...asset, kind: 'video', name: 'studio-demo.mp4' } }
      })
    ).toBe(true)
  })

  test('empty reel disables captions and video', () => {
    const empty = createEmptyProject()
    expect(sidecarById('srt').ready(empty)).toBe(false)
    expect(hasExportableCaptions(empty)).toBe(false)
    expect(sidecarById('otio').ready(empty)).toBe(false)
    expect(videoExportCopy(empty).summary).toMatch(/Open a recording/)
    expect(hasYouTubeChapters(empty)).toBe(false)
  })
})
