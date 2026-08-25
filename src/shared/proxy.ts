/** Preview plays a proxy when one exists. Export always uses the camera original. */

export const PROXY_MAX_EDGE = 960

/** Codecs Chromium/Electron often cannot preview. FFmpeg can still export them. */
const PREVIEW_UNSAFE = /^(hevc|h265|hev1|hvc1|prores|dnxhd|dnxhr|cfhd|v210|rawvideo)/i

export function previewUnsafeCodec(codec?: string): boolean {
  return Boolean(codec && PREVIEW_UNSAFE.test(codec.trim()))
}

export function frameRate(frac?: string): number {
  if (!frac || frac === '0/0') return 0
  const [num, den] = frac.split('/').map(Number)
  if (!Number.isFinite(num)) return 0
  if (!den) return num
  return num / den
}

export function isVariableFrameRate(avg?: string, r?: string): boolean {
  const a = frameRate(avg)
  const b = frameRate(r)
  if (a <= 0 || b <= 0) return false
  return Math.abs(a - b) / Math.max(a, b) > 0.03
}

export function needsProxy(info: {
  hasVideo?: boolean
  width?: number
  height?: number
  duration?: number
  codec?: string
  vfr?: boolean
}): boolean {
  if (!info.hasVideo) return false
  if (previewUnsafeCodec(info.codec) || info.vfr) return true
  const width = info.width ?? 0
  const height = info.height ?? 0
  const duration = info.duration ?? 0
  return width >= 1280 || height >= 720 || duration >= 60
}

export function assetNeedsProxy(asset: {
  kind?: string
  width?: number
  height?: number
  duration?: number
  codec?: string
  vfr?: boolean
}): boolean {
  if (asset.kind === 'audio' || asset.kind === 'image') return false
  return needsProxy({
    hasVideo: true,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
    codec: asset.codec,
    vfr: asset.vfr
  })
}

/** Accept a cached proxy only when its duration matches the camera original. */
export function proxyCacheMatchesSource(sourceDuration: number, proxyDuration: number): boolean {
  if (!(sourceDuration > 0) || !(proxyDuration > 0.2)) return false
  return Math.abs(proxyDuration - sourceDuration) <= Math.max(0.5, sourceDuration * 0.05)
}

export function playbackPath(
  asset: { path: string; proxyPath?: string },
  opts?: { proxyExists?: boolean }
): string {
  if (asset.proxyPath && opts?.proxyExists !== false) return asset.proxyPath
  return asset.path
}
