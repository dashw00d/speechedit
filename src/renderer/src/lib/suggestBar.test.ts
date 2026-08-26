import { describe, expect, test } from 'bun:test'
import { planSuggestBar, suggestBarJob } from './suggestBar'

describe('suggest bar plan', () => {
  test('a fresh tape only keeps clean-path actions on the row', () => {
    const job = suggestBarJob({
      marked: false,
      selecting: false,
      leftover: false,
      retake: true,
      preClean: true
    })
    expect(job).toBe('retake')
    const { now, more } = planSuggestBar(job, [
      'collapse-retakes',
      'review',
      'cut-fillers',
      'add-broll',
      'add-music',
      'copy-frame',
      'apply-style',
      'remove-scene',
      'merge-next'
    ])
    expect(now).toEqual(['collapse-retakes', 'review'])
    expect(now).not.toContain('add-broll')
    expect(now).not.toContain('copy-frame')
    expect(now).not.toContain('remove-scene')
    expect(more).toContain('add-broll')
    expect(more).toContain('copy-frame')
    expect(more).toContain('remove-scene')
    expect(more).toContain('cut-fillers')
  })

  test('pre-clean without retakes shows fillers, not decorate', () => {
    const job = suggestBarJob({
      marked: false,
      selecting: false,
      leftover: false,
      retake: false,
      preClean: true
    })
    expect(job).toBe('clean')
    const { now, more } = planSuggestBar(job, ['cut-fillers', 'review', 'add-title', 'copy-notes'])
    expect(now).toEqual(['review', 'cut-fillers'])
    expect(more).toEqual(['add-title', 'copy-notes'])
  })

  test('Hear leftover is first on a fresh tape that still has leftovers', () => {
    const job = suggestBarJob({
      marked: false,
      selecting: false,
      leftover: true,
      leftoverDecide: false,
      retake: true,
      preClean: true
    })
    expect(job).toBe('leftover')
    const { now, more } = planSuggestBar(job, [
      'hear-leftover',
      'cut-leftover',
      'collapse-retakes',
      'review',
      'cut-fillers'
    ])
    expect(now).toEqual(['hear-leftover'])
    expect(more).toContain('collapse-retakes')
    expect(more).toContain('cut-fillers')
    expect(now).not.toContain('cut-leftover')
  })

  test('hearing a leftover takes the row even before Clean', () => {
    const job = suggestBarJob({
      marked: false,
      selecting: false,
      leftover: true,
      leftoverDecide: true,
      retake: true,
      preClean: true
    })
    expect(job).toBe('leftover-decide')
    const { now, more } = planSuggestBar(job, [
      'hear-leftover',
      'cut-leftover',
      'keep-leftover',
      'collapse-retakes',
      'review'
    ])
    expect(now).toEqual(['cut-leftover', 'keep-leftover'])
    expect(more).toContain('hear-leftover')
    expect(more).toContain('collapse-retakes')
  })

  test('a leftover is Hear leftover until you are on one', () => {
    const job = suggestBarJob({
      marked: false,
      selecting: false,
      leftover: true,
      leftoverDecide: false,
      retake: true,
      preClean: false
    })
    expect(job).toBe('leftover')
    const { now, more } = planSuggestBar(job, [
      'hear-leftover',
      'watch',
      'export',
      'add-zoom',
      'copy-notes'
    ])
    expect(now).toEqual(['hear-leftover'])
    expect(more).toContain('watch')
    expect(more).toContain('add-zoom')
    expect(now).not.toContain('cut-leftover')
  })

  test('after Hear leftover the row is only that leftover’s decide actions', () => {
    const job = suggestBarJob({
      marked: false,
      selecting: false,
      leftover: true,
      leftoverDecide: true,
      retake: true,
      preClean: false
    })
    expect(job).toBe('leftover-decide')
    const { now, more } = planSuggestBar(job, [
      'hear-leftover',
      'silent-demo',
      'speed-4x',
      'cut-leftover',
      'keep-leftover',
      'watch',
      'add-zoom'
    ])
    expect(now).toEqual(['silent-demo', 'speed-4x', 'cut-leftover', 'keep-leftover'])
    expect(more).toContain('hear-leftover')
    expect(more).toContain('watch')
    expect(now).not.toContain('hear-leftover')
  })

  test('a heading or words take the row so chapter actions are not always-on', () => {
    const job = suggestBarJob({
      marked: false,
      selecting: true,
      leftover: true,
      retake: false,
      preClean: false
    })
    expect(job).toBe('selection')
    const { now, more } = planSuggestBar(job, [
      'copy-quote',
      'copy-frame',
      'mark-clip',
      'add-note',
      'add-zoom',
      'add-redaction',
      'remove-scene',
      'merge-next',
      'hear-leftover',
      'add-broll'
    ])
    expect(now).toEqual(['copy-quote', 'add-zoom'])
    const parked = planSuggestBar(job, ['protect-pause', 'copy-quote', 'copy-frame'])
    expect(parked.now).toEqual(['protect-pause', 'copy-quote'])
    expect(parked.more).toContain('copy-frame')
    expect(more).toContain('hear-leftover')
    expect(more).toContain('add-broll')
  })

  test('the finish row is Watch and Export, not Protect pause', () => {
    const job = suggestBarJob({
      marked: false,
      selecting: false,
      leftover: false,
      retake: false,
      preClean: false
    })
    expect(job).toBe('finish')
    const { now, more } = planSuggestBar(job, [
      'watch',
      'export',
      'copy-notes',
      'copy-chapters',
      'add-title',
      'add-lower-third',
      'chapter-names',
      'caption-remaining',
      'protect-pause',
      'review'
    ])
    expect(now).toEqual(['watch', 'export'])
    expect(more).toContain('copy-notes')
    expect(more).toContain('add-title')
    expect(more).toContain('review')
    expect(more).toContain('protect-pause')
    const afterCaptions = planSuggestBar(job, [
      'watch',
      'export',
      'normalize',
      'export-srt',
      'copy-notes',
      'copy-chapters',
      'add-title',
      'review'
    ])
    expect(afterCaptions.now).toEqual(['watch', 'export'])
    expect(afterCaptions.more).toEqual(['review', 'add-title', 'copy-notes', 'copy-chapters', 'normalize', 'export-srt'])
  })

  test('marked range replaces the decorate pile', () => {
    const job = suggestBarJob({
      marked: true,
      selecting: true,
      leftover: false,
      retake: false,
      preClean: false
    })
    expect(job).toBe('marked')
    const { now } = planSuggestBar(job, ['cut-marked', 'clear-marks', 'copy-quote', 'export'])
    expect(now).toEqual(['cut-marked', 'clear-marks'])
  })
})
