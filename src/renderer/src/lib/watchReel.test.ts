import { describe, expect, test } from 'bun:test'
import { createDemoProject } from './demo'
import { useEditor, usePlayback } from '../store'
import { clampReviewRate, REVIEW_RATES } from './reviewRate'
import { watchEditedReel } from './watchReel'

describe('review rate and watch', () => {
  test('1.5× is a real rate, junk falls back to 1×', () => {
    expect(REVIEW_RATES).toContain(1.5)
    expect(clampReviewRate(1.5)).toBe(1.5)
    expect(clampReviewRate(3)).toBe(1)
    expect(clampReviewRate(0.5)).toBe(0.5)
  })

  test('setReviewRate keeps 1.5×', () => {
    usePlayback.getState().setReviewRate(1.5)
    expect(usePlayback.getState().reviewRate).toBe(1.5)
    usePlayback.getState().setReviewRate(1)
    expect(usePlayback.getState().reviewRate).toBe(1)
  })

  test('watch after edits bumps 1× to a 1.5× skim', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    usePlayback.getState().setReviewRate(1)
    const result = watchEditedReel({ skim: true })
    expect(result.rate).toBe(1.5)
    expect(result.toast).toMatch(/1\.5×/)
    expect(usePlayback.getState().playing).toBe(true)
    expect(usePlayback.getState().reviewRate).toBe(1.5)
  })

  test('watch keeps a rate the user already picked', () => {
    usePlayback.getState().setReviewRate(2)
    const result = watchEditedReel({ skim: true })
    expect(result.rate).toBe(2)
    expect(result.toast).toMatch(/2×/)
  })

  test('watch without skim leaves 1× alone', () => {
    usePlayback.getState().setReviewRate(1)
    const result = watchEditedReel({ skim: false })
    expect(result.rate).toBe(1)
    expect(result.toast).toMatch(/start/)
  })
})
