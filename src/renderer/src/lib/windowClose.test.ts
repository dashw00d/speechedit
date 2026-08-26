import { describe, expect, test } from 'bun:test'
import { shouldPreventWindowClose } from './windowClose'

describe('window close policy', () => {
  test('desktop always closes because recovery is written before unload', () => {
    expect(shouldPreventWindowClose(true, true)).toBe(false)
    expect(shouldPreventWindowClose(false, true)).toBe(false)
  })

  test('the browser still warns before abandoning dirty work', () => {
    expect(shouldPreventWindowClose(true, false)).toBe(true)
    expect(shouldPreventWindowClose(false, false)).toBe(false)
  })
})
