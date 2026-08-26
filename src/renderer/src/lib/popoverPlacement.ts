export interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface PopoverPlacement {
  left: number
  top: number
  maxWidth: number
  maxHeight: number
  visible: boolean
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/** Position a viewport-fixed popover wholly inside its visible scroll boundary. */
export function placePopoverInBounds(
  boundary: RectLike,
  anchor: RectLike,
  popover: Pick<RectLike, 'width' | 'height'>,
  options: { gap?: number; inset?: number } = {}
): PopoverPlacement {
  const gap = options.gap ?? 6
  const inset = options.inset ?? 8
  const maxWidth = Math.max(0, boundary.width - inset * 2)
  const maxHeight = Math.max(0, boundary.height - inset * 2)
  const width = Math.min(popover.width, maxWidth)
  const height = Math.min(popover.height, maxHeight)
  const minLeft = boundary.left + inset
  const maxLeft = boundary.right - inset - width
  const minTop = boundary.top + inset
  const maxTop = boundary.bottom - inset - height
  const visible =
    maxWidth > 0 &&
    maxHeight > 0 &&
    anchor.right > boundary.left &&
    anchor.left < boundary.right &&
    anchor.bottom > boundary.top &&
    anchor.top < boundary.bottom

  const left = clamp(anchor.left + anchor.width / 2 - width / 2, minLeft, maxLeft)
  const belowTop = anchor.bottom + gap
  const aboveTop = anchor.top - gap - height
  const fitsBelow = belowTop <= maxTop
  const fitsAbove = aboveTop >= minTop
  let top: number

  if (fitsBelow) top = belowTop
  else if (fitsAbove) top = aboveTop
  else {
    const belowSpace = boundary.bottom - inset - anchor.bottom - gap
    const aboveSpace = anchor.top - gap - boundary.top - inset
    top = clamp(aboveSpace > belowSpace ? aboveTop : belowTop, minTop, maxTop)
  }

  return { left, top, maxWidth, maxHeight, visible }
}
