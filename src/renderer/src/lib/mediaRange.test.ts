import { describe, expect, test } from 'bun:test'
import { parseByteRange } from '../../../shared/mediaRange'

describe('local media byte ranges', () => {
  test('no Range header serves the whole file', () => {
    expect(parseByteRange(null, 1000)).toBeNull()
  })

  test('open and bounded ranges are clamped to the file', () => {
    expect(parseByteRange('bytes=100-', 1000)).toEqual({ start: 100, end: 999 })
    expect(parseByteRange('bytes=100-299', 1000)).toEqual({ start: 100, end: 299 })
    expect(parseByteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
  })

  test('suffix ranges and invalid requests are explicit', () => {
    expect(parseByteRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 })
    expect(parseByteRange('bytes=1000-', 1000)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=300-100', 1000)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=0-10,20-30', 1000)).toBe('unsatisfiable')
  })
})
