import { describe, expect, test } from 'bun:test'
import { formatThemeViolations, lintTheme } from './themeGuard'

describe('theme guard', () => {
  test('chrome styles only use semantic theme tokens', () => {
    const hits = lintTheme()
    expect(hits, formatThemeViolations(hits)).toEqual([])
  })
})
