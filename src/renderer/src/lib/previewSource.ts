export interface PreviewSourceChoice {
  assetId?: string
  originalPath: string
  sourcePath: string
}

/**
 * Keep a playing media element on its current camera file when a background
 * proxy finishes. Replacing `src` mid-play reloads Chromium's media pipeline
 * and can drop audible playback. Other changes (a new take, relink, or proxy
 * failure) still switch immediately because the current source is no longer
 * usable for that asset.
 */
export function settlePreviewSource(
  current: PreviewSourceChoice,
  next: PreviewSourceChoice,
  playing: boolean
): PreviewSourceChoice {
  if (
    playing &&
    current.assetId === next.assetId &&
    current.originalPath === next.originalPath &&
    current.sourcePath === current.originalPath &&
    next.sourcePath !== next.originalPath
  ) {
    return current
  }

  if (
    current.assetId === next.assetId &&
    current.originalPath === next.originalPath &&
    current.sourcePath === next.sourcePath
  ) {
    return current
  }

  return next
}
