export type ParsedByteRange = { start: number; end: number } | 'unsatisfiable' | null

/** Parse the single byte range Chromium uses for HTML media seeking. */
export function parseByteRange(header: string | null, size: number): ParsedByteRange {
  if (!header) return null
  if (!(size > 0)) return 'unsatisfiable'
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match || (!match[1] && !match[2])) return 'unsatisfiable'

  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return 'unsatisfiable'
  }
  return { start, end: Math.min(size - 1, requestedEnd) }
}
