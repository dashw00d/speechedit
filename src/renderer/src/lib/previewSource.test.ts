import { describe, expect, test } from 'bun:test'
import { settlePreviewSource, type PreviewSourceChoice } from './previewSource'

const original: PreviewSourceChoice = {
  assetId: 'take-a',
  originalPath: 'C:/reel/take-a.mp4',
  sourcePath: 'C:/reel/take-a.mp4'
}

const proxy: PreviewSourceChoice = {
  ...original,
  sourcePath: 'C:/cache/take-a.proxy.mp4'
}

describe('stable preview source', () => {
  test('does not replace an audible camera file when its proxy finishes mid-play', () => {
    expect(settlePreviewSource(original, proxy, true)).toBe(original)
  })

  test('adopts the completed proxy as soon as playback stops', () => {
    expect(settlePreviewSource(original, proxy, false)).toBe(proxy)
  })

  test('still changes to a different take while playing', () => {
    const nextTake = {
      assetId: 'take-b',
      originalPath: 'C:/reel/take-b.mp4',
      sourcePath: 'C:/cache/take-b.proxy.mp4'
    }
    expect(settlePreviewSource(original, nextTake, true)).toBe(nextTake)
  })

  test('falls back from a broken proxy to the original while playing', () => {
    expect(settlePreviewSource(proxy, original, true)).toBe(original)
  })

  test('switches immediately when the same asset is relinked', () => {
    const relinked = {
      assetId: 'take-a',
      originalPath: 'D:/restored/take-a.mp4',
      sourcePath: 'D:/restored/take-a.mp4'
    }
    expect(settlePreviewSource(original, relinked, true)).toBe(relinked)
  })
})
