/** Camera display rotation — coded pixels vs what the user sees. */

export type QuarterTurn = 0 | 90 | 180 | 270

export function quarterTurn(degrees: number | undefined | null): QuarterTurn {
  if (degrees == null || !Number.isFinite(Number(degrees))) return 0
  const n = ((Math.round(Number(degrees) / 90) * 90) % 360 + 360) % 360
  return n === 90 || n === 180 || n === 270 ? n : 0
}

export function displaySize(
  width: number | undefined,
  height: number | undefined,
  rotation?: number
): { width?: number; height?: number } {
  if (!width || !height) return { width, height }
  const r = quarterTurn(rotation)
  if (r === 90 || r === 270) return { width: height, height: width }
  return { width, height }
}

export type ProgramOrientation = 'landscape' | 'portrait' | 'square'

/** Preview stage and export job share this canvas. */
export function programFrame(
  width?: number,
  height?: number
): { width: number; height: number; orientation: ProgramOrientation } {
  const w = Math.max(2, Math.round(width || 1920))
  const h = Math.max(2, Math.round(height || 1080))
  return {
    width: w,
    height: h,
    orientation: w === h ? 'square' : w > h ? 'landscape' : 'portrait'
  }
}

export function transposeFilters(rotation?: number): string[] {
  const r = quarterTurn(rotation)
  if (r === 90) return ['transpose=1']
  if (r === 270) return ['transpose=2']
  if (r === 180) return ['hflip', 'vflip']
  return []
}

export function parseStreamRotation(stream: {
  tags?: Record<string, string | undefined>
  side_data_list?: Array<{ side_data_type?: string; rotation?: number | string }>
}): QuarterTurn {
  for (const side of stream.side_data_list ?? []) {
    if (side.rotation == null || side.rotation === '') continue
    return quarterTurn(Number(side.rotation))
  }
  const tag = stream.tags?.rotate ?? stream.tags?.ROTATE
  if (tag != null && tag !== '' && Number.isFinite(Number(tag))) return quarterTurn(Number(tag))
  return 0
}
