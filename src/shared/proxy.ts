/** Preview plays a proxy when one exists. Export always uses the camera original. */

export const PROXY_MAX_EDGE = 960

export function needsProxy(info: {
  hasVideo?: boolean
  width?: number
  height?: number
  duration?: number
}): boolean {
  if (!info.hasVideo) return false
  const width = info.width ?? 0
  const height = info.height ?? 0
  const duration = info.duration ?? 0
  return width >= 1280 || height >= 720 || duration >= 60
}

export function playbackPath(asset: { path: string; proxyPath?: string }): string {
  return asset.proxyPath || asset.path
}
