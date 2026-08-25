import type { Asset, Project, Track } from '../types'

function overlayAssetIds(tracks: Track[]): Set<string> {
  const ids = new Set<string>()
  for (const track of tracks) {
    if (track.id === 'v1' || track.id === 'a1') continue
    for (const clip of track.clips) {
      if (clip.assetId) ids.add(clip.assetId)
    }
  }
  return ids
}

export function isPrimaryTake(project: Pick<Project, 'assets' | 'tracks'>, asset: Asset): boolean {
  if (asset.sourceOffset != null) return true
  if (!asset.path || asset.kind === 'image') return false
  return !overlayAssetIds(project.tracks).has(asset.id)
}

export function primaryTakes(project: Pick<Project, 'assets' | 'tracks'>): Asset[] {
  return Object.values(project.assets)
    .filter((asset) => isPrimaryTake(project, asset))
    .sort((a, b) => (a.sourceOffset ?? 0) - (b.sourceOffset ?? 0))
}

export function sourceOffsetOf(asset: Asset | undefined): number {
  return asset?.sourceOffset ?? 0
}

export function primaryAssetAt(
  project: Pick<Project, 'assets' | 'tracks'>,
  sourceTime: number
): Asset | undefined {
  const takes = primaryTakes(project)
  if (!takes.length) return undefined
  for (let i = takes.length - 1; i >= 0; i--) {
    if (sourceTime + 0.0005 >= sourceOffsetOf(takes[i])) return takes[i]
  }
  return takes[0]
}

export function takeBoundaryMarks(project: Pick<Project, 'assets' | 'tracks' | 'sourceDuration'>): number[] {
  return primaryTakes(project)
    .map((take) => sourceOffsetOf(take))
    .filter((mark) => mark > 0.04 && mark < (project.sourceDuration || 0) - 0.04)
}

export function unifySourceTime(localTime: number, asset: Asset | undefined): number {
  return Math.max(0, localTime) + sourceOffsetOf(asset)
}

export function localSourceTime(sourceTime: number, asset: Asset | undefined): number {
  return Math.max(0, sourceTime - sourceOffsetOf(asset))
}

export function ensurePrimaryOffsets<T extends Pick<Project, 'assets' | 'tracks'>>(project: T): T['assets'] {
  const listed = Object.values(project.assets ?? {})
  if (listed.some((asset) => asset.sourceOffset != null)) return project.assets
  const overlay = overlayAssetIds(project.tracks ?? [])
  const main =
    listed.find((asset) => asset.path && asset.kind !== 'image' && !overlay.has(asset.id)) ??
    listed.find((asset) => asset.path)
  if (!main) return project.assets
  return { ...project.assets, [main.id]: { ...main, sourceOffset: 0 } }
}

function resampleLooks(values: number[], count: number): number[] {
  if (count <= 0) return []
  if (!values.length) return Array.from({ length: count }, () => 0)
  if (values.length === count) return values
  return Array.from({ length: count }, (_, i) => {
    const at = (i / count) * values.length
    return values[Math.min(values.length - 1, Math.floor(at))] ?? 0
  })
}

export function stitchPrimaryWaveform(project: Project): number[] {
  const takes = primaryTakes(project)
  if (takes.length <= 1) return takes[0]?.waveform ?? []
  const total = Math.max(project.sourceDuration, takes.reduce((sum, take) => sum + take.duration, 0), 0.01)
  const out: number[] = []
  for (const take of takes) {
    const want = Math.max(8, Math.round((Math.max(0.01, take.duration) / total) * 1800))
    out.push(...resampleLooks(take.waveform ?? [], want))
  }
  return out
}

export function stitchPrimaryThumbs(project: Project): string[] {
  const takes = primaryTakes(project)
  if (takes.length <= 1) return takes[0]?.thumbnails ?? []
  return takes.flatMap((take) => take.thumbnails ?? [])
}
