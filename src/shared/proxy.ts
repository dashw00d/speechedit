/** Preview plays a proxy when one exists. Export always uses the camera original. */

export const PROXY_MAX_EDGE = 960
/** Short GOP so HTML seeks can skip Auto-Edit holes instead of landing on a distant keyframe. */
export const PROXY_GOP = 15
/** Remake a cached proxy when its keyframe interval is longer than this. */
export const PROXY_GOP_STALE = 32

export function proxyVideoArgs(fps?: number): string[] {
  const gop = Math.max(8, Math.round(fps && fps > 1 ? Math.min(PROXY_GOP, fps / 2) : PROXY_GOP))
  return [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-g',
    String(gop),
    '-keyint_min',
    String(gop),
    '-sc_threshold',
    '0'
  ]
}

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

/** Largest packet gap between `K` flags from a short ffprobe packet dump. */
export function estimateGopFromFlags(flags: string[]): number {
  const keys = flags.flatMap((flag, i) => (/K/i.test(flag) ? [i] : []))
  if (!flags.length) return 0
  if (keys.length < 2) {
    const only = keys[0] ?? 0
    return Math.max(flags.length - only, only || flags.length)
  }
  let max = 1
  for (let i = 1; i < keys.length; i++) max = Math.max(max, keys[i]! - keys[i - 1]!)
  return max
}

export function proxyGopSeekable(gop: number): boolean {
  return gop > 0 && gop <= PROXY_GOP_STALE
}

export function playbackPath(
  asset: { path: string; proxyPath?: string },
  opts?: { proxyExists?: boolean }
): string {
  if (asset.proxyPath && opts?.proxyExists !== false) return asset.proxyPath
  return asset.path
}
