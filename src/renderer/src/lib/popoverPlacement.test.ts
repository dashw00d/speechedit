import { describe, expect, test } from 'bun:test'
import { placePopoverInBounds, type RectLike } from './popoverPlacement'

function rect(left: number, top: number, width: number, height: number): RectLike {
  return { left, top, right: left + width, bottom: top + height, width, height }
}

describe('bounded transcript popover placement', () => {
  const viewport = rect(100, 200, 400, 300)

  test('centers below an ordinary word', () => {
    expect(placePopoverInBounds(viewport, rect(280, 300, 40, 20), rect(0, 0, 180, 44))).toEqual({
      left: 210,
      top: 326,
      maxWidth: 384,
      maxHeight: 284,
      visible: true
    })
  })

  test('clamps inside the left and right edges', () => {
    expect(placePopoverInBounds(viewport, rect(102, 300, 20, 20), rect(0, 0, 220, 44)).left).toBe(108)
    expect(placePopoverInBounds(viewport, rect(480, 300, 20, 20), rect(0, 0, 220, 44)).left).toBe(272)
  })

  test('flips above near the visible bottom', () => {
    expect(placePopoverInBounds(viewport, rect(280, 470, 40, 20), rect(0, 0, 180, 44)).top).toBe(420)
  })

  test('caps an oversized popover within the visible scroll section', () => {
    const placed = placePopoverInBounds(viewport, rect(280, 340, 40, 20), rect(0, 0, 800, 600))
    expect(placed.maxWidth).toBe(384)
    expect(placed.maxHeight).toBe(284)
    expect(placed.left).toBe(108)
    expect(placed.top).toBe(208)
  })

  test('hides when the selected word has scrolled out of view', () => {
    expect(placePopoverInBounds(viewport, rect(280, 520, 40, 20), rect(0, 0, 180, 44)).visible).toBe(false)
  })
})
