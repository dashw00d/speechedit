import { describe, expect, test } from 'bun:test'
import { suggestionsFromLoudness, suggestionsFromSilence, suggestionsFromStatic } from './analysis'
import { createDemoProject } from './demo'
import { buildEditBlocks, editBlockCounts, filterEditBlocks } from './timelineEdits'
import { autoHideEmptyStackTrack, findRevealableStackTrack, trackLaneName } from './timelineTracks'

describe('timeline edits filters', () => {
  test('filters blocks by kind when the lane is crowded', () => {
    const blocks = buildEditBlocks(createDemoProject())
    expect(blocks.length).toBeGreaterThan(8)
    const counts = editBlockCounts(blocks)
    expect(counts.all).toBe(blocks.length)
    expect(counts.scenes).toBeGreaterThan(0)
    expect(filterEditBlocks(blocks, 'guards').every((b) => ['keep', 'demo'].includes(b.kind))).toBe(true)
    expect(filterEditBlocks(blocks, 'notes').every((b) => b.kind === 'note')).toBe(true)
    expect(filterEditBlocks(blocks, 'pending').every((b) => b.kind.includes('pending') || b.kind.includes('blocked'))).toBe(
      true
    )
    expect(blocks.some((b) => b.label === 'Demo')).toBe(true)
    expect(blocks.some((b) => b.label === 'Take 1' || b.label === 'Thesis')).toBe(true)
    expect(blocks.some((b) => b.label === 'Retake')).toBe(true)
    const stillProject = {
      ...createDemoProject(),
      suggestions: suggestionsFromSilence([{ start: 2, end: 8 }], 0.12, [{ start: 1.8, end: 8.2 }])
    }
    expect(buildEditBlocks(stillProject).some((b) => b.label === 'Still')).toBe(true)
    const staticProject = {
      ...createDemoProject(),
      suggestions: suggestionsFromStatic([{ start: 2, end: 6 }])
    }
    expect(buildEditBlocks(staticProject).some((b) => b.label === 'Static')).toBe(true)
    const hotProject = {
      ...createDemoProject(),
      suggestions: suggestionsFromLoudness([{ start: 2, end: 4, lufs: -8 }], 10).filter((s) => s.action === 'volume')
    }
    expect(buildEditBlocks(hotProject).some((b) => b.label === 'Hot')).toBe(true)
    const withKeep = buildEditBlocks({
      ...createDemoProject(),
      tags: [{ id: 'keep1', start: 0.4, end: 1.2, kind: 'keep' }]
    })
    expect(withKeep.some((b) => b.label === 'Protected')).toBe(true)
    expect(withKeep.some((b) => b.detail.includes('Auto Edit skips this'))).toBe(true)
    expect(blocks.every((b) => b.detail !== `${b.label} · blocked by a guard`)).toBe(true)
  })
})

describe('timeline stack tracks', () => {
  test('blank overlay/caption tracks start hidden until revealed or filled', () => {
    const project = createDemoProject()
    const hidden = findRevealableStackTrack(
      [
        { id: 'v2', type: 'overlay', name: 'V2', locked: false, muted: false, hidden: true, clips: [] },
        { id: 'v3', type: 'caption', name: 'V3', locked: false, muted: false, hidden: true, clips: [] }
      ],
      'overlay'
    )
    expect(hidden?.id).toBe('v2')
    const emptied = autoHideEmptyStackTrack({
      id: 'v2',
      type: 'overlay',
      name: 'V2 Overlay',
      locked: false,
      muted: false,
      hidden: false,
      clips: []
    })
    expect(emptied.hidden).toBe(true)
    expect(project.tracks.find((t) => t.id === 'v2')?.hidden).toBe(false)
  })

  test('lane names drop V1/A1 prefixes', () => {
    expect(trackLaneName({ name: 'V3 Captions' })).toBe('Captions')
    expect(trackLaneName({ name: 'A1 Voice' })).toBe('Voice')
    expect(trackLaneName({ name: 'Music bed' })).toBe('Music bed')
  })
})
