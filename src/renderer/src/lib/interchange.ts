import {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_TRANSFORM,
  type Asset,
  type CaptionStyle,
  type Clip,
  type Cut,
  type InsertKind,
  type Interval,
  type ProgramInsert,
  type Project,
  type SegmentStyle,
  type Track
} from '../types'
import { applyCommand } from './commands'
import {
  captionsForExport,
  clipsFromCaptionCues,
  cuesToSrt,
  cuesToVtt,
  parseCaptionCues,
  projectToChapters,
  projectToTranscriptMd,
  projectToTranscriptTxt,
  serialCaptions,
  withCaptionClips
} from './captions'
import { invertIntervals, mergeIntervals, overlap } from './edl'
import { normalizeProject } from './normalize'
import { programLengthOf, resolveSegments, sourcePieces, sourceToProgramOf } from './resolver'
import { localSourceTime, primaryAssetAt, primaryTakes, sourceOffsetOf } from './takes'
import { uid } from './time'

function mediaPathKey(path: string): string {
  return decodeURIComponent(path.replace(/^file:\/\//i, '').replace(/\\/g, '/')).replace(/\/+$/, '').toLowerCase()
}

function takeByPath(project: Project, path?: string) {
  const takes = primaryTakes(project)
  if (!path) return takes[0]
  const key = mediaPathKey(path)
  const name = key.split('/').pop() ?? key
  return (
    Object.values(project.assets).find((asset) => asset.path && mediaPathKey(asset.path) === key) ??
    Object.values(project.assets).find((asset) => asset.path && mediaPathKey(asset.path).endsWith(`/${name}`)) ??
    takes[0]
  )
}

function unifyLocalSpan(project: Project, localStart: number, localEnd: number, path?: string): Interval {
  const offset = sourceOffsetOf(takeByPath(project, path))
  return { start: localStart + offset, end: localEnd + offset }
}

function xmlAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(tag))) out[match[1]] = match[2]
  return out
}

interface TakeResource {
  take: ReturnType<typeof primaryTakes>[number]
  id: string
  producerId: string
  fileId: string
}

function timelineTakes(project: Project) {
  const takes = primaryTakes(project)
  if (takes.length) return takes
  return Object.values(project.assets).filter((asset) => asset.kind !== 'image').slice(0, 1)
}

function takeResources(project: Project): TakeResource[] {
  return timelineTakes(project).map((take, index) => ({
    take,
    id: `r${index + 1}`,
    producerId: index === 0 ? 'src' : `src_${take.id}`,
    fileId: `file${index + 1}`
  }))
}

interface MediaClipRow {
  track: Track
  clip: Clip
  asset: Asset
}

interface OverlayResource {
  asset: Asset
  id: string
  producerId: string
  fileId: string
}

function mediaClipRows(project: Project): MediaClipRow[] {
  return project.tracks.flatMap((track) => {
    if (track.type !== 'overlay' && track.type !== 'audio') return []
    return track.clips.flatMap((clip) => {
      const asset = clip.assetId ? project.assets[clip.assetId] : undefined
      if (!asset?.path) return []
      return [{ track, clip, asset }]
    })
  })
}

function overlayResources(project: Project): OverlayResource[] {
  const seen = new Map<string, OverlayResource>()
  let index = 0
  for (const row of mediaClipRows(project)) {
    if (seen.has(row.asset.id)) continue
    index += 1
    const audio = row.track.type === 'audio' || row.asset.kind === 'audio'
    seen.set(row.asset.id, {
      asset: row.asset,
      id: `ov${index}`,
      producerId: audio ? `bed_${row.asset.id}` : `ov_${row.asset.id}`,
      fileId: `ovfile${index}`
    })
  }
  return [...seen.values()]
}

function resourceForAsset(resources: OverlayResource[], assetId?: string): OverlayResource | undefined {
  return resources.find((row) => row.asset.id === assetId)
}

interface RestoredMediaClip {
  path: string
  name?: string
  start: number
  duration: number
  inPoint?: number
  kind: 'overlay' | 'audio'
}

function restoreMediaClips(project: Project, clips: RestoredMediaClip[]): Project {
  let next = project
  for (const row of clips) {
    if (!row.path || row.duration <= 0.03) continue
    const inPoint = Math.max(0, row.inPoint ?? 0)
    const existing = Object.values(next.assets).find(
      (asset) => asset.path && mediaPathKey(asset.path) === mediaPathKey(row.path)
    )
    const span = inPoint + row.duration
    const asset: Asset = existing
      ? { ...existing, duration: Math.max(existing.duration, span, 0.2) }
      : {
          id: uid('asset'),
          path: row.path,
          name: row.name ?? row.path.split(/[\\/]/).pop() ?? 'clip',
          kind: row.kind === 'audio' ? 'audio' : 'video',
          duration: Math.max(span, 0.2),
          waveform: []
        }
    const already = next.tracks.some((track) =>
      track.clips.some(
        (clip) =>
          clip.assetId === asset.id &&
          Math.abs(clip.start - row.start) < 0.05 &&
          Math.abs(clip.duration - row.duration) < 0.05 &&
          Math.abs(clip.inPoint - inPoint) < 0.05
      )
    )
    if (already) continue
    next = applyCommand(
      next,
      row.kind === 'audio'
        ? { type: 'addAudio', asset, start: row.start, duration: row.duration, inPoint }
        : { type: 'addBroll', asset, start: row.start, duration: row.duration, inPoint }
    )
  }
  return next
}

interface RestoredInsert {
  programStart: number
  duration: number
  kind?: InsertKind
  holdSourceTime?: number
}

function serialInserts(project: Project): RestoredInsert[] {
  return (project.inserts ?? [])
    .filter((row) => row.duration > 0.03)
    .map((row) => ({
      programStart: row.programStart,
      duration: row.duration,
      kind: row.kind,
      holdSourceTime: row.holdSourceTime
    }))
}

function restoreInserts(project: Project, rows: RestoredInsert[]): Project {
  const merged: RestoredInsert[] = []
  for (const row of [...rows]
    .filter((item) => item.duration > 0.03)
    .sort((a, b) => a.programStart - b.programStart || b.duration - a.duration)) {
    const last = merged[merged.length - 1]
    if (last && Math.abs(last.programStart - row.programStart) < 0.08) {
      last.duration = Math.max(last.duration, row.duration)
      last.holdSourceTime ??= row.holdSourceTime
      continue
    }
    merged.push({ ...row })
  }
  const inserts: ProgramInsert[] = merged.map((row) => ({
    id: uid('ins'),
    programStart: row.programStart,
    duration: row.duration,
    kind: row.kind === 'silence' || row.kind === 'hold' ? row.kind : 'black',
    ...(row.holdSourceTime != null ? { holdSourceTime: row.holdSourceTime } : {})
  }))
  return normalizeProject({ ...project, inserts })
}

function isOtioGap(clip: { OTIO_SCHEMA?: string; metadata?: { speechedit?: { kind?: string } } }): boolean {
  return clip.OTIO_SCHEMA === 'Gap.1' || clip.metadata?.speechedit?.kind === 'slug'
}

function resourceForTime(project: Project, resources: TakeResource[], sourceTime: number): TakeResource | undefined {
  const take = primaryAssetAt(project, sourceTime)
  return resources.find((row) => row.take.id === take?.id) ?? resources[0]
}

function localClip(project: Project, resources: TakeResource[], seg: { inPoint: number; outPoint: number; start: number; duration: number }) {
  const resource = resourceForTime(project, resources, seg.inPoint)
  const take = resource?.take
  return {
    resource,
    take,
    localIn: localSourceTime(seg.inPoint, take),
    localOut: localSourceTime(seg.outPoint, take),
    programStart: seg.start,
    programDuration: seg.duration
  }
}

export {
  projectToChapters,
  projectToTranscriptMd,
  projectToTranscriptTxt
}

export function projectToSrt(project: Project): string {
  return cuesToSrt(captionsForExport(normalizeProject(project)))
}

export function projectToVtt(project: Project): string {
  return cuesToVtt(captionsForExport(normalizeProject(project)))
}

export function projectToOtio(project: Project): string {
  const current = normalizeProject(project)
  const resources = takeResources(current)
  const segs = resolveSegments(current)
  const rate = current.fps
  const rational = (seconds: number) => ({
    OTIO_SCHEMA: 'RationalTime.1',
    value: Math.round(seconds * rate),
    rate
  })
  const clips = segs.map((seg) => {
    if (seg.kind === 'slug') {
      return {
        OTIO_SCHEMA: 'Gap.1',
        name: 'Hold',
        source_range: {
          OTIO_SCHEMA: 'TimeRange.1',
          start_time: rational(0),
          duration: rational(seg.duration)
        },
        metadata: {
          speechedit: { kind: 'slug', programStart: seg.start, holdSourceTime: seg.inPoint }
        }
      }
    }
    const clip = localClip(current, resources, seg)
    const take = clip.take
    return {
      OTIO_SCHEMA: 'Clip.1',
      name: `${seg.inPoint.toFixed(2)}-${seg.outPoint.toFixed(2)}`,
      source_range: {
        OTIO_SCHEMA: 'TimeRange.1',
        start_time: rational(clip.localIn),
        duration: rational(clip.localOut - clip.localIn)
      },
      metadata: {
        speechedit: {
          speed: seg.speed,
          fadeIn: seg.fadeIn,
          fadeOut: seg.fadeOut,
          sourceOffset: sourceOffsetOf(take),
          assetId: take?.id,
          path: take?.path
        }
      },
      media_reference: take?.path
        ? {
            OTIO_SCHEMA: 'ExternalReference.1',
            target_url: take.path,
            available_range: {
              OTIO_SCHEMA: 'TimeRange.1',
              start_time: rational(0),
              duration: rational(take.duration)
            }
          }
        : { OTIO_SCHEMA: 'MissingReference.1' }
    }
  })
  const overlays = current.tracks
    .filter((t) => t.type === 'overlay' || t.type === 'caption' || t.type === 'audio')
    .filter((t) => t.id !== 'a1')
    .map((track) => ({
      OTIO_SCHEMA: 'Track.1',
      name: track.name,
      kind: track.type === 'caption' ? 'Subtitle' : track.type === 'audio' ? 'Audio' : 'Video',
      children: track.clips.map((clip) => {
        const asset = clip.assetId ? current.assets[clip.assetId] : undefined
        return {
          OTIO_SCHEMA: 'Clip.1',
          name: clip.text ?? asset?.name ?? clip.id,
          source_range: {
            OTIO_SCHEMA: 'TimeRange.1',
            start_time: rational(asset?.path ? clip.inPoint : 0),
            duration: rational(clip.duration)
          },
          metadata: {
            speechedit: {
              start: clip.start,
              assetId: clip.assetId,
              path: asset?.path,
              text: clip.text,
              style: clip.style,
              kind: track.type,
              inPoint: clip.inPoint
            }
          },
          ...(asset?.path
            ? {
                media_reference: {
                  OTIO_SCHEMA: 'ExternalReference.1',
                  target_url: asset.path,
                  available_range: {
                    OTIO_SCHEMA: 'TimeRange.1',
                    start_time: rational(0),
                    duration: rational(asset.duration)
                  }
                }
              }
            : {})
        }
      })
    }))
  const markers = (current.scenes ?? []).map((scene) => ({
    OTIO_SCHEMA: 'Marker.1',
    name: scene.title,
    marked_range: {
      OTIO_SCHEMA: 'TimeRange.1',
      start_time: rational(sourceToProgramOf(current, scene.start)),
      duration: rational(Math.max(0.1, sourceToProgramOf(current, scene.end) - sourceToProgramOf(current, scene.start)))
    },
    color: scene.kind === 'retake' ? 'RED' : scene.kind === 'demo' ? 'BLUE' : 'GREEN',
    metadata: { speechedit: { kind: scene.kind, summary: scene.summary } }
  }))
  return JSON.stringify(
    {
      OTIO_SCHEMA: 'Timeline.1',
      name: current.name,
      global_start: rational(0),
      markers,
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        children: [
          { OTIO_SCHEMA: 'Track.1', name: 'V1 Picture', kind: 'Video', children: clips },
          { OTIO_SCHEMA: 'Track.1', name: 'A1 Voice', kind: 'Audio', children: clips },
          ...overlays
        ]
      },
      metadata: {
        speechedit: {
          programDuration: programLengthOf(current),
          cuts: current.cuts,
          words: current.transcript.words.length,
          captions: serialCaptions(captionClips(current)),
          styles: current.styles,
          takes: resources.map((row) => ({
            id: row.take.id,
            path: row.take.path,
            sourceOffset: sourceOffsetOf(row.take),
            duration: row.take.duration
          })),
          overlays: mediaClipRows(current).map(({ track, clip, asset }) => ({
            start: clip.start,
            duration: clip.duration,
            inPoint: clip.inPoint,
            path: asset.path,
            name: asset.name,
            kind: track.type === 'audio' ? 'audio' : 'overlay'
          })),
          inserts: serialInserts(current)
        }
      }
    },
    null,
    2
  )
}

function captionClips(project: Project): Clip[] {
  return project.tracks.filter((t) => t.type === 'caption').flatMap((t) => t.clips)
}

export function projectToFcpxml(project: Project): string {
  const current = normalizeProject(project)
  const resources = takeResources(current)
  const overlays = overlayResources(current)
  const segs = resolveSegments(current)
  const fps = current.fps
  const tick = (seconds: number) => `${Math.round(seconds * fps)}/${fps}s`
  const assetXml = [
    ...resources.map(
      (row) =>
        `<asset id="${row.id}" name="${escapeXml(row.take.name)}" src="${escapeXml(row.take.path)}" start="0s" duration="${tick(row.take.duration)}" hasVideo="1" hasAudio="1" />`
    ),
    ...overlays.map(
      (row) =>
        `<asset id="${row.id}" name="${escapeXml(row.asset.name)}" src="${escapeXml(row.asset.path)}" start="0s" duration="${tick(row.asset.duration)}" hasVideo="${row.asset.kind === 'audio' ? '0' : '1'}" hasAudio="1" />`
    )
  ].join('\n    ')
  const titles = current.tracks
    .filter((t) => t.type === 'caption' || t.type === 'overlay')
    .flatMap((t) => t.clips.filter((c) => c.text && !c.assetId))
  const titleXml = (clip: Clip) =>
    `<title name="${escapeXml(clip.text ?? 'Title')}" lane="1" offset="${tick(clip.start)}" duration="${tick(clip.duration)}"><text>${escapeXml(clip.text ?? '')}</text></title>`
  const connectedXml = mediaClipRows(current)
    .map((row) => {
      const resource = resourceForAsset(overlays, row.asset.id)
      if (!resource) return ''
      return `<asset-clip name="${escapeXml(row.asset.name)}" ref="${resource.id}" lane="2" offset="${tick(row.clip.start)}" start="${tick(row.clip.inPoint)}" duration="${tick(row.clip.duration)}" />`
    })
    .filter(Boolean)
    .join('\n            ')
  const firstMedia = segs.findIndex((seg) => seg.kind !== 'slug')
  const clipXml = segs
    .map((seg, i) => {
      if (seg.kind === 'slug') {
        return `<gap name="Hold" offset="${tick(seg.start)}" duration="${tick(seg.duration)}" start="0s" />`
      }
      const clip = localClip(current, resources, seg)
      const children = i === firstMedia ? titles.map(titleXml).join('\n              ') : ''
      const inner = children ? `\n              ${children}\n            ` : ''
      return `<asset-clip name="seg${i + 1}" ref="${clip.resource?.id ?? 'r1'}" offset="${tick(clip.programStart)}" start="${tick(clip.localIn)}" duration="${tick(clip.localOut - clip.localIn)}">${inner}</asset-clip>`
    })
    .concat(connectedXml ? [connectedXml] : [])
    .join('\n            ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    ${assetXml}
    <format id="r0" name="FFVideoFormat${current.height}p${fps}" frameDuration="${1}/${fps}s" width="${current.width}" height="${current.height}" />
  </resources>
  <library>
    <event name="${escapeXml(current.name)}">
      <project name="${escapeXml(current.name)}">
        <sequence format="r0" duration="${tick(programLengthOf(current))}">
          <spine>
            ${clipXml}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function downloadText(filename: string, body: string, mime = 'text/plain'): void {
  const blob = new Blob([body], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function secondsFromRational(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  const rec = value as { value?: number; rate?: number }
  const rate = rec.rate || 30
  return (rec.value ?? 0) / rate
}

function secondsFromStamp(value: string): number {
  const raw = value.trim()
  if (raw.endsWith('s') && raw.includes('/')) {
    const [num, den] = raw.slice(0, -1).split('/').map(Number)
    return den ? num / den : 0
  }
  if (raw.endsWith('s')) return Number(raw.slice(0, -1)) || 0
  const clock = raw.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3])
  return Number(raw) || 0
}

function cutsFromKept(kept: Interval[], duration: number): Cut[] {
  return invertIntervals(mergeIntervals(kept), duration)
    .filter((span) => span.end - span.start > 0.03)
    .map((span) => ({
      id: uid('cut'),
      start: span.start,
      end: span.end,
      source: 'manual' as const
    }))
}

function applyTimeline(
  project: Project,
  cuts: Cut[],
  styles: SegmentStyle[] = project.styles
): Project {
  const duration = project.sourceDuration
  return normalizeProject({
    ...project,
    cuts,
    styles,
    transcript: {
      ...project.transcript,
      words: project.transcript.words.map((word) => ({
        ...word,
        deleted: cuts.some((cut) => overlap(word, cut) > 0)
      }))
    },
    suggestions: project.suggestions.map((s) => ({
      ...s,
      applied: cuts.some((cut) => overlap(cut, s) > (s.end - s.start) * 0.8) ? true : s.applied
    })),
    updatedAt: Date.now(),
    sourceDuration: duration
  })
}

export function projectToAutoEditor(project: Project): string {
  const current = normalizeProject(project)
  const asset = Object.values(current.assets).find((a) => a.path)
  const pieces = sourcePieces(current)
  const chunks = pieces.map((span) => {
    const style = current.styles.find(
      (s) => Math.min(span.end, s.end) - Math.max(span.start, s.start) > 0.05
    )
    return [Number(span.start.toFixed(3)), Number(span.end.toFixed(3)), style?.speed ?? 1]
  })
  return JSON.stringify(
    {
      version: '3',
      source: asset?.path ?? current.name,
      chunks
    },
    null,
    2
  )
}

function mltClock(t: number): string {
  const ms = Math.round((t % 1) * 1000)
  const s = Math.floor(t) % 60
  const m = Math.floor(t / 60) % 60
  const h = Math.floor(t / 3600)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

function mediaPlaylist(
  project: Project,
  resources: OverlayResource[],
  kind: 'overlay' | 'audio'
): { producers: string; playlist: string } {
  const rows = mediaClipRows(project).filter((row) =>
    kind === 'audio' ? row.track.type === 'audio' : row.track.type === 'overlay'
  )
  if (!rows.length) {
    return { producers: '', playlist: '    <blank />\n' }
  }
  const producers = rows
    .map((row) => {
      const resource = resourceForAsset(resources, row.asset.id)
      if (!resource) return ''
      return `  <producer id="${resource.producerId}" in="${mltClock(0)}" out="${mltClock(row.asset.duration)}">
    <property name="resource">${escapeXml(row.asset.path)}</property>
    <property name="speechedit.start">${row.clip.start}</property>
  </producer>`
    })
    .filter(Boolean)
    .join('\n')
  const ordered = [...rows].sort((a, b) => a.clip.start - b.clip.start)
  let cursor = 0
  const entries: string[] = []
  ordered.forEach((row) => {
    const resource = resourceForAsset(resources, row.asset.id)
    if (!resource) return
    if (row.clip.start > cursor + 0.01) {
      entries.push(`    <blank length="${mltClock(row.clip.start - cursor)}" />`)
    }
    entries.push(
      `    <entry producer="${resource.producerId}" in="${mltClock(row.clip.inPoint)}" out="${mltClock(Math.max(row.clip.inPoint, row.clip.inPoint + row.clip.duration - 1 / project.fps))}" />`
    )
    cursor = row.clip.start + row.clip.duration
  })
  return { producers, playlist: `${entries.join('\n')}\n` }
}

function titlePlaylist(project: Project): { producers: string; playlist: string } {
  const titles = project.tracks
    .filter((t) => t.type === 'caption' || t.type === 'overlay')
    .flatMap((t) => t.clips.filter((c) => c.text && !c.assetId))
  if (!titles.length) {
    return { producers: '', playlist: '    <blank />\n' }
  }
  const ordered = [...titles].sort((a, b) => a.start - b.start)
  const producers = ordered
    .map(
      (clip, i) => `  <producer id="title${i}">
    <property name="mlt_service">dynamictext</property>
    <property name="text">${escapeXml(clip.text ?? '')}</property>
    <property name="speechedit.start">${clip.start}</property>
  </producer>`
    )
    .join('\n')
  let cursor = 0
  const entries: string[] = []
  ordered.forEach((clip, i) => {
    if (clip.start > cursor + 0.01) {
      entries.push(`    <blank length="${mltClock(clip.start - cursor)}" />`)
    }
    entries.push(
      `    <entry producer="title${i}" in="${mltClock(0)}" out="${mltClock(Math.max(0.04, clip.duration - 1 / project.fps))}" />`
    )
    cursor = clip.start + clip.duration
  })
  return { producers, playlist: `${entries.join('\n')}\n` }
}

export function projectToMlt(project: Project): string {
  const current = normalizeProject(project)
  const resources = takeResources(current)
  const overlays = overlayResources(current)
  const segs = resolveSegments(current)
  const entries = segs
    .map((seg) => {
      if (seg.kind === 'slug') return `    <blank length="${mltClock(seg.duration)}" />`
      const clip = localClip(current, resources, seg)
      const producer = clip.resource?.producerId ?? 'src'
      return `    <entry producer="${producer}" in="${mltClock(clip.localIn)}" out="${mltClock(Math.max(clip.localIn, clip.localOut - 1 / current.fps))}" />`
    })
    .join('\n')
  const producers = resources
    .map(
      (row) => `  <producer id="${row.producerId}" in="${mltClock(0)}" out="${mltClock(row.take.duration)}">
    <property name="resource">${escapeXml(row.take.path)}</property>
  </producer>`
    )
    .join('\n')
  const titles = titlePlaylist(current)
  const broll = mediaPlaylist(current, overlays, 'overlay')
  const beds = mediaPlaylist(current, overlays, 'audio')
  return `<?xml version="1.0" encoding="utf-8"?>
<mlt LC_NUMERIC="C" version="7.24.0" title="${escapeXml(current.name)}">
  <profile width="${current.width}" height="${current.height}" frame_rate_num="${current.fps}" frame_rate_den="1" />
${producers}
${overlays.length ? overlays.map((row) => `  <producer id="${row.producerId}" in="${mltClock(0)}" out="${mltClock(row.asset.duration)}">
    <property name="resource">${escapeXml(row.asset.path)}</property>
  </producer>`).join('\n') : ''}
${titles.producers}
  <playlist id="video">
${entries}
  </playlist>
  <playlist id="audio">
${entries}
  </playlist>
  <playlist id="titles">
${titles.playlist}  </playlist>
  <playlist id="broll">
${broll.playlist}  </playlist>
  <playlist id="beds">
${beds.playlist}  </playlist>
  <tractor id="tractor0" title="${escapeXml(current.name)}" in="${mltClock(0)}" out="${mltClock(programLengthOf(current))}">
    <track producer="video" />
    <track producer="audio" />
    <track producer="titles" />
    <track producer="broll" />
    <track producer="beds" />
  </tractor>
</mlt>
`
}

/** Shotcut-compatible MLT plus Kdenlive document markers (Auto-Editor `--export kdenlive`). */
export function projectToKdenlive(project: Project): string {
  const mlt = projectToMlt(project)
  return mlt.replace(
    '<mlt LC_NUMERIC="C" version="7.24.0"',
    `<mlt LC_NUMERIC="C" version="7.24.0" producer="tractor0"`
  ).replace(
    '<profile ',
    `<property name="kdenlive:docproperties.version">1.1</property>\n  <property name="kdenlive:docproperties.previewextension">mp4</property>\n  <profile `
  )
}

/** Premiere / Resolve FCP7 XML (Auto-Editor `--export premiere`). */
export function projectToPremiere(project: Project): string {
  const current = normalizeProject(project)
  const resources = takeResources(current)
  const segs = resolveSegments(current)
  const fps = current.fps
  const frames = (seconds: number) => Math.round(seconds * fps)
  const clipItems = segs
    .map((seg, i) => {
      if (seg.kind === 'slug') {
        const start = frames(seg.start)
        const end = frames(seg.start + seg.duration)
        return `          <clipitem id="slug${i + 1}">
            <name>Hold</name>
            <duration>${end - start}</duration>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            <start>${start}</start>
            <end>${end}</end>
            <in>-1</in>
            <out>-1</out>
          </clipitem>`
      }
      const clip = localClip(current, resources, seg)
      const take = clip.take
      const start = frames(clip.programStart)
      const end = frames(clip.programStart + clip.programDuration)
      const inn = frames(clip.localIn)
      const out = frames(clip.localOut)
      const pathurl = take?.path ? `file://${take.path.replace(/\\/g, '/')}` : ''
      return `          <clipitem id="clip${i + 1}">
            <name>seg${i + 1}</name>
            <duration>${out - inn}</duration>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            <start>${start}</start>
            <end>${end}</end>
            <in>${inn}</in>
            <out>${out}</out>
            <file id="${clip.resource?.fileId ?? 'file1'}">
              <name>${escapeXml(take?.name ?? current.name)}</name>
              <pathurl>${escapeXml(pathurl)}</pathurl>
              <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
              <duration>${frames(take?.duration ?? current.sourceDuration)}</duration>
            </file>
          </clipitem>`
    })
    .join('\n')
  const titles = current.tracks
    .filter((t) => t.type === 'caption')
    .flatMap((t) => t.clips)
    .map((clip, i) => {
      const start = frames(clip.start)
      const end = frames(clip.start + clip.duration)
      return `          <generatoritem id="title${i + 1}">
            <name>${escapeXml(clip.text ?? 'Title')}</name>
            <duration>${end - start}</duration>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            <start>${start}</start>
            <end>${end}</end>
            <in>0</in>
            <out>${end - start}</out>
            <effect>
              <effectid>Text</effectid>
              <name>Text</name>
              <parameter>
                <parameterid>str</parameterid>
                <name>Text</name>
                <value>${escapeXml(clip.text ?? '')}</value>
              </parameter>
            </effect>
          </generatoritem>`
    })
    .join('\n')
  const overlays = overlayResources(current)
  const overlayItems = mediaClipRows(current)
    .filter((row) => row.track.type === 'overlay')
    .map((row, i) => {
      const resource = resourceForAsset(overlays, row.asset.id)
      const start = frames(row.clip.start)
      const end = frames(row.clip.start + row.clip.duration)
      const inn = frames(row.clip.inPoint)
      const out = frames(row.clip.inPoint + row.clip.duration)
      const pathurl = `file://${row.asset.path.replace(/\\/g, '/')}`
      return `          <clipitem id="ovclip${i + 1}">
            <name>${escapeXml(row.asset.name)}</name>
            <duration>${out - inn}</duration>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            <start>${start}</start>
            <end>${end}</end>
            <in>${inn}</in>
            <out>${out}</out>
            <file id="${resource?.fileId ?? `ovfile${i + 1}`}">
              <name>${escapeXml(row.asset.name)}</name>
              <pathurl>${escapeXml(pathurl)}</pathurl>
              <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
              <duration>${frames(row.asset.duration)}</duration>
            </file>
          </clipitem>`
    })
    .join('\n')
  const bedItems = mediaClipRows(current)
    .filter((row) => row.track.type === 'audio')
    .map((row, i) => {
      const resource = resourceForAsset(overlays, row.asset.id)
      const start = frames(row.clip.start)
      const end = frames(row.clip.start + row.clip.duration)
      const inn = frames(row.clip.inPoint)
      const out = frames(row.clip.inPoint + row.clip.duration)
      const pathurl = `file://${row.asset.path.replace(/\\/g, '/')}`
      return `          <clipitem id="bedclip${i + 1}">
            <name>${escapeXml(row.asset.name)}</name>
            <duration>${out - inn}</duration>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            <start>${start}</start>
            <end>${end}</end>
            <in>${inn}</in>
            <out>${out}</out>
            <file id="${resource?.fileId ?? `ovfile${i + 1}`}">
              <name>${escapeXml(row.asset.name)}</name>
              <pathurl>${escapeXml(pathurl)}</pathurl>
              <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
              <duration>${frames(row.asset.duration)}</duration>
            </file>
          </clipitem>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="seq0">
    <name>${escapeXml(current.name)}</name>
    <duration>${frames(programLengthOf(current))}</duration>
    <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <width>${current.width}</width>
            <height>${current.height}</height>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
          </samplecharacteristics>
        </format>
        <track>
${clipItems}
        </track>
        <track>
${titles}
        </track>
        <track>
${overlayItems}
        </track>
      </video>
      <audio>
        <track>
${clipItems}
        </track>
        <track>
${bedItems}
        </track>
      </audio>
    </media>
  </sequence>
</xmeml>
`
}

function restoreCaptions(
  project: Project,
  captions: Array<{ start: number; duration: number; text: string; style?: CaptionStyle }>
): Project {
  if (!captions.length) return project
  return withCaptionClips(
    project,
    clipsFromCaptionCues(captions.map((c) => ({ start: c.start, end: c.start + c.duration, text: c.text }))).map(
      (clip, i) => ({
        ...clip,
        style: { ...DEFAULT_CAPTION_STYLE, ...captions[i]?.style }
      })
    )
  )
}

type OtioChild = {
  OTIO_SCHEMA?: string
  source_range?: { start_time?: unknown; duration?: unknown }
  media_reference?: { target_url?: string }
  metadata?: { speechedit?: { path?: string; kind?: string; programStart?: number; holdSourceTime?: number } }
}

function otioVideoChildren(data: {
  tracks?: { children?: Array<{ kind?: string; name?: string; children?: unknown[] }> }
}): OtioChild[] {
  const video = (data.tracks?.children ?? []).find(
    (t) => (t.kind ?? '').toLowerCase() === 'video' || (t.name ?? '').toLowerCase().includes('picture')
  )
  return (video?.children ?? []) as OtioChild[]
}

function insertsFromOtioTrack(children: OtioChild[]): RestoredInsert[] {
  const rows: RestoredInsert[] = []
  let program = 0
  for (const clip of children) {
    const duration = secondsFromRational(clip.source_range?.duration)
    if (isOtioGap(clip) && duration > 0.03) {
      rows.push({
        programStart: clip.metadata?.speechedit?.programStart ?? program,
        duration,
        kind: 'black',
        holdSourceTime: clip.metadata?.speechedit?.holdSourceTime
      })
    }
    program += duration
  }
  return rows
}

function importOtio(project: Project, raw: unknown): Project {
  const data = raw as {
    metadata?: {
      speechedit?: {
        cuts?: Cut[]
        captions?: Array<{ start: number; duration: number; text: string; style?: CaptionStyle }>
        styles?: SegmentStyle[]
        overlays?: RestoredMediaClip[]
        inserts?: RestoredInsert[]
      }
    }
    tracks?: { children?: Array<{ kind?: string; name?: string; children?: unknown[] }> }
  }
  const picture = otioVideoChildren(data)
  let next = project
  if (data.metadata?.speechedit?.cuts?.length) {
    next = applyTimeline(
      project,
      data.metadata.speechedit.cuts.map((c) => ({
        id: c.id || uid('cut'),
        start: c.start,
        end: c.end,
        source: c.source ?? 'manual'
      })),
      data.metadata.speechedit.styles?.length ? data.metadata.speechedit.styles : project.styles
    )
  } else {
    const kept: Interval[] = []
    for (const clip of picture) {
      if (isOtioGap(clip)) continue
      const start = secondsFromRational(clip.source_range?.start_time)
      const duration = secondsFromRational(clip.source_range?.duration)
      const path = clip.metadata?.speechedit?.path ?? clip.media_reference?.target_url
      if (duration > 0.03) kept.push(unifyLocalSpan(project, start, start + duration, path))
    }
    if (kept.length) {
      next = applyTimeline(project, cutsFromKept(kept, project.sourceDuration || kept[kept.length - 1].end))
    }
  }
  const metaCaps = data.metadata?.speechedit?.captions ?? []
  if (metaCaps.length) next = restoreCaptions(next, metaCaps)
  else {
    const graphics: Array<{ start: number; duration: number; text: string }> = []
    for (const track of data.tracks?.children ?? []) {
      const kind = (track.kind ?? '').toLowerCase()
      const name = (track.name ?? '').toLowerCase()
      if (kind !== 'subtitle' && !name.includes('caption') && !name.includes('title')) continue
      for (const clip of (track.children ?? []) as Array<{
        name?: string
        metadata?: { speechedit?: { start?: number; text?: string } }
        source_range?: { duration?: unknown }
      }>) {
        const text = clip.metadata?.speechedit?.text ?? clip.name
        const start = clip.metadata?.speechedit?.start ?? 0
        const duration = secondsFromRational(clip.source_range?.duration)
        if (text && duration > 0.03) graphics.push({ start, duration, text })
      }
    }
    if (graphics.length) next = restoreCaptions(next, graphics)
  }
  const metaOverlays = data.metadata?.speechedit?.overlays ?? []
  if (metaOverlays.length) next = restoreMediaClips(next, metaOverlays)
  else {
    const parsed: RestoredMediaClip[] = []
    for (const track of data.tracks?.children ?? []) {
      const name = (track.name ?? '').toLowerCase()
      if (name.includes('picture') || name.includes('voice') || name.includes('caption') || name.includes('title')) {
        continue
      }
      const kind = (track.kind ?? '').toLowerCase() === 'audio' || name.includes('music') || name.includes('bed')
        ? 'audio'
        : 'overlay'
      for (const clip of (track.children ?? []) as Array<{
        media_reference?: { target_url?: string }
        metadata?: { speechedit?: { start?: number; path?: string; kind?: string; inPoint?: number } }
        source_range?: { start_time?: unknown; duration?: unknown }
      }>) {
        const path = clip.metadata?.speechedit?.path ?? clip.media_reference?.target_url
        const start = clip.metadata?.speechedit?.start ?? 0
        const duration = secondsFromRational(clip.source_range?.duration)
        const inPoint = clip.metadata?.speechedit?.inPoint ?? secondsFromRational(clip.source_range?.start_time)
        if (path && duration > 0.03) {
          parsed.push({
            path,
            start,
            duration,
            inPoint,
            kind: clip.metadata?.speechedit?.kind === 'audio' ? 'audio' : kind
          })
        }
      }
    }
    next = restoreMediaClips(next, parsed)
  }
  const metaInserts = data.metadata?.speechedit?.inserts ?? []
  return restoreInserts(next, metaInserts.length ? metaInserts : insertsFromOtioTrack(picture))
}

function importFcpxml(project: Project, xml: string): Project {
  const assets = new Map<string, string>()
  const audioAssets = new Set<string>()
  const assetRe = /<asset\b([^>]*)\/?>/g
  let assetMatch: RegExpExecArray | null
  while ((assetMatch = assetRe.exec(xml))) {
    const attrs = xmlAttrs(assetMatch[1])
    if (attrs.id && attrs.src) assets.set(attrs.id, attrs.src)
    if (attrs.id && attrs.hasVideo === '0') audioAssets.add(attrs.id)
  }
  const kept: Interval[] = []
  const overlays: RestoredMediaClip[] = []
  const inserts: RestoredInsert[] = []
  const gapRe = /<gap\b([^>]*)\/?>/g
  let gapMatch: RegExpExecArray | null
  while ((gapMatch = gapRe.exec(xml))) {
    const attrs = xmlAttrs(gapMatch[1])
    const duration = secondsFromStamp(attrs.duration ?? '0')
    if (duration > 0.03) {
      inserts.push({
        programStart: secondsFromStamp(attrs.offset ?? '0'),
        duration,
        kind: 'black'
      })
    }
  }
  const clipRe = /<asset-clip\b([^>]*)\/?>/g
  let match: RegExpExecArray | null
  while ((match = clipRe.exec(xml))) {
    const attrs = xmlAttrs(match[1])
    const start = secondsFromStamp(attrs.start ?? '0')
    const duration = secondsFromStamp(attrs.duration ?? '0')
    const path = assets.get(attrs.ref ?? '')
    const overlay = Number(attrs.lane ?? 0) > 1 || /^ov/i.test(attrs.ref ?? '')
    if (overlay) {
      if (path && duration > 0.03) {
        overlays.push({
          path,
          name: attrs.name,
          start: secondsFromStamp(attrs.offset ?? '0'),
          duration,
          inPoint: start,
          kind: audioAssets.has(attrs.ref ?? '') ? 'audio' : 'overlay'
        })
      }
      continue
    }
    if (duration > 0.03) kept.push(unifyLocalSpan(project, start, start + duration, path))
  }
  const next = kept.length
    ? applyTimeline(project, cutsFromKept(kept, project.sourceDuration || kept[kept.length - 1].end))
    : project
  const titles: Array<{ start: number; duration: number; text: string }> = []
  const titleRe =
    /<title[^>]*\boffset="([^"]+)"[^>]*\bduration="([^"]+)"[^>]*>[\s\S]*?<text>([^<]*)<\/text>|<title[^>]*\bname="([^"]+)"[^>]*\boffset="([^"]+)"[^>]*\bduration="([^"]+)"/g
  let title: RegExpExecArray | null
  while ((title = titleRe.exec(xml))) {
    const start = secondsFromStamp(title[1] ?? title[5] ?? '0')
    const duration = secondsFromStamp(title[2] ?? title[6] ?? '0')
    const text = (title[3] ?? title[4] ?? '').trim()
    if (text && duration > 0.03) titles.push({ start, duration, text })
  }
  const withTitles = titles.length ? restoreCaptions(next, titles) : next
  return restoreInserts(restoreMediaClips(withTitles, overlays), inserts)
}

function importMlt(project: Project, xml: string): Project {
  const kept: Interval[] = []
  const frame = 1 / (project.fps || 30)
  const producers = new Map<string, string>()
  const producerRe = /<producer id="([^"]+)"[^>]*>([\s\S]*?)<\/producer>/g
  let producer: RegExpExecArray | null
  while ((producer = producerRe.exec(xml))) {
    if (/^title/i.test(producer[1])) continue
    const resource = producer[2].match(/<property name="resource">([^<]*)<\/property>/)
    if (resource) producers.set(producer[1], resource[1])
  }
  const entryRe = /<entry\b([^>]*)\/?>/g
  let match: RegExpExecArray | null
  while ((match = entryRe.exec(xml))) {
    const attrs = xmlAttrs(match[1])
    const producerId = attrs.producer ?? ''
    if (!producerId || /^title|^ov_|^bed_/i.test(producerId)) continue
    if (!producers.has(producerId) && producerId !== 'src') continue
    const start = secondsFromStamp(attrs.in ?? '0')
    const end = secondsFromStamp(attrs.out ?? '0') + frame
    if (end > start) kept.push(unifyLocalSpan(project, start, end, producers.get(producerId)))
  }
  if (!kept.length) {
    const loose = /<entry[^>]*\bin="([^"]+)"[^>]*\bout="([^"]+)"/g
    while ((match = loose.exec(xml))) {
      if (xml.slice(Math.max(0, match.index - 80), match.index).includes('title')) continue
      const start = secondsFromStamp(match[1])
      const end = secondsFromStamp(match[2]) + frame
      if (end > start) kept.push(unifyLocalSpan(project, start, end))
    }
  }
  const next = kept.length
    ? applyTimeline(project, cutsFromKept(kept, project.sourceDuration || kept[kept.length - 1].end))
    : project
  const titles: Array<{ start: number; duration: number; text: string }> = []
  const prodRe =
    /<producer id="(title\d+)"[^>]*>[\s\S]*?<property name="text">([^<]*)<\/property>[\s\S]*?(?:<property name="speechedit.start">([^<]*)<\/property>)?[\s\S]*?<\/producer>/g
  let prod: RegExpExecArray | null
  while ((prod = prodRe.exec(xml))) {
    const start = Number(prod[3] ?? 0)
    const text = prod[2] ?? ''
    const entry = xml.match(new RegExp(`<entry producer="${prod[1]}"[^>]*out="([^"]+)"`))
    const duration = entry ? secondsFromStamp(entry[1]) : 2
    if (text) titles.push({ start, duration: Math.max(0.4, duration), text })
  }
  const withTitles = titles.length ? restoreCaptions(next, titles) : next
  return restoreInserts(
    restoreMediaClips(withTitles, [
      ...mediaFromPlaylist(xml, 'broll', producers, 'overlay', frame),
      ...mediaFromPlaylist(xml, 'beds', producers, 'audio', frame)
    ]),
    insertsFromPlaylist(xml, 'video', frame)
  )
}

function mediaFromPlaylist(
  xml: string,
  playlistId: string,
  producers: Map<string, string>,
  kind: 'overlay' | 'audio',
  frame: number
): RestoredMediaClip[] {
  const block = xml.match(new RegExp(`<playlist id="${playlistId}">([\\s\\S]*?)</playlist>`))?.[1]
  if (!block) return []
  let cursor = 0
  const rows: RestoredMediaClip[] = []
  const tokenRe = /<(blank|entry)\b([^>]*)\/?>/g
  let token: RegExpExecArray | null
  while ((token = tokenRe.exec(block))) {
    const attrs = xmlAttrs(token[2] ?? '')
    if (token[1] === 'blank') {
      cursor += secondsFromStamp(attrs.length ?? '0')
      continue
    }
    const path = producers.get(attrs.producer ?? '')
    const inn = secondsFromStamp(attrs.in ?? '0')
    const out = secondsFromStamp(attrs.out ?? '0') + frame
    const duration = Math.max(0.04, out - inn)
    if (path) rows.push({ path, start: cursor, duration, inPoint: inn, kind })
    cursor += duration
  }
  return rows
}

function insertsFromPlaylist(xml: string, playlistId: string, frame: number): RestoredInsert[] {
  const block = xml.match(new RegExp(`<playlist id="${playlistId}">([\\s\\S]*?)</playlist>`))?.[1]
  if (!block) return []
  let cursor = 0
  const rows: RestoredInsert[] = []
  const tokenRe = /<(blank|entry)\b([^>]*)\/?>/g
  let token: RegExpExecArray | null
  while ((token = tokenRe.exec(block))) {
    const attrs = xmlAttrs(token[2] ?? '')
    if (token[1] === 'blank') {
      const duration = secondsFromStamp(attrs.length ?? '0')
      if (duration > 0.03) rows.push({ programStart: cursor, duration, kind: 'black' })
      cursor += duration
      continue
    }
    const inn = secondsFromStamp(attrs.in ?? '0')
    const out = secondsFromStamp(attrs.out ?? '0') + frame
    cursor += Math.max(0.04, out - inn)
  }
  return rows
}

function importPremiere(project: Project, xml: string): Project {
  const rateMatch = xml.match(/<timebase>(\d+)<\/timebase>/)
  const rate = Number(rateMatch?.[1] ?? project.fps ?? 30)
  const kept: Interval[] = []
  const overlays: RestoredMediaClip[] = []
  const inserts: RestoredInsert[] = []
  const clipRe = /<clipitem[\s\S]*?<\/clipitem>/g
  let match: RegExpExecArray | null
  while ((match = clipRe.exec(xml))) {
    const block = match[0]
    const inn = block.match(/<in>([^<]+)<\/in>/)
    const out = block.match(/<out>([^<]+)<\/out>/)
    const path = block.match(/<pathurl>([^<]*)<\/pathurl>/)?.[1]?.replace(/^file:\/\//i, '')
    const clipId = block.match(/<clipitem id="([^"]+)"/)?.[1] ?? ''
    const fileId = block.match(/<file id="([^"]+)"/)?.[1] ?? ''
    const name = block.match(/<name>([^<]*)<\/name>/)?.[1] ?? ''
    if (/^slug/i.test(clipId) || (!path && /^Hold$/i.test(name))) {
      const programStart = Number(block.match(/<start>([^<]+)<\/start>/)?.[1] ?? 0) / rate
      const programEnd = Number(block.match(/<end>([^<]+)<\/end>/)?.[1] ?? 0) / rate
      if (programEnd - programStart > 0.03) {
        inserts.push({ programStart, duration: programEnd - programStart, kind: 'black' })
      }
      continue
    }
    if (!inn || !out) continue
    if (/^ovfile/i.test(fileId) || /^ovclip|^bedclip/i.test(clipId)) {
      const programStart = Number(block.match(/<start>([^<]+)<\/start>/)?.[1] ?? 0) / rate
      const programEnd = Number(block.match(/<end>([^<]+)<\/end>/)?.[1] ?? 0) / rate
      if (path && programEnd > programStart) {
        overlays.push({
          path,
          start: programStart,
          duration: programEnd - programStart,
          inPoint: Number(inn[1]) / rate,
          kind: /^bedclip/i.test(clipId) ? 'audio' : 'overlay'
        })
      }
      continue
    }
    const start = Number(inn[1]) / rate
    const end = Number(out[1]) / rate
    if (end > start) kept.push(unifyLocalSpan(project, start, end, path))
  }
  const next = kept.length
    ? applyTimeline(project, cutsFromKept(kept, project.sourceDuration || kept[kept.length - 1].end))
    : project
  const titles: Array<{ start: number; duration: number; text: string }> = []
  const genRe = /<generatoritem[\s\S]*?<start>([^<]+)<\/start>[\s\S]*?<end>([^<]+)<\/end>[\s\S]*?<value>([^<]*)<\/value>/g
  let gen: RegExpExecArray | null
  while ((gen = genRe.exec(xml))) {
    const start = Number(gen[1]) / rate
    const end = Number(gen[2]) / rate
    const text = gen[3] ?? ''
    if (text && end > start) titles.push({ start, duration: end - start, text })
  }
  const withTitles = titles.length ? restoreCaptions(next, titles) : next
  return restoreInserts(restoreMediaClips(withTitles, overlays), inserts)
}

function asChunk(item: unknown): { start: number; end: number; speed: number } | null {
  if (Array.isArray(item) && item.length >= 2) {
    return { start: Number(item[0]), end: Number(item[1]), speed: Number(item[2] ?? 1) }
  }
  if (item && typeof item === 'object') {
    const rec = item as { start?: number; end?: number; a?: number; b?: number; speed?: number }
    const start = rec.start ?? rec.a
    const end = rec.end ?? rec.b
    if (start == null || end == null) return null
    return { start, end, speed: rec.speed ?? 1 }
  }
  return null
}

function importAutoEditor(project: Project, raw: unknown): Project {
  const data = raw as { chunks?: unknown[]; timeline?: { v1?: unknown[] } }
  const list = data.chunks ?? data.timeline?.v1 ?? []
  const chunks = list.map(asChunk).filter((c): c is NonNullable<typeof c> => Boolean(c))
  if (!chunks.length) return project
  const kept = chunks.filter((c) => c.speed > 0 && c.speed < 900)
  const styles: SegmentStyle[] = kept
    .filter((c) => Math.abs(c.speed - 1) > 0.02)
    .map((c) => ({
      id: uid('sty'),
      start: c.start,
      end: c.end,
      speed: c.speed,
      transform: { ...DEFAULT_TRANSFORM, ...project.picture },
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      keyframes: []
    }))
  return applyTimeline(
    project,
    cutsFromKept(
      kept.map((c) => ({ start: c.start, end: c.end })),
      project.sourceDuration || kept[kept.length - 1].end
    ),
    styles.length ? styles : project.styles
  )
}

export function applyInterchange(project: Project, filename: string, text: string): Project {
  const name = filename.toLowerCase()
  const trimmed = text.trim()
  if (name.endsWith('.srt') || name.endsWith('.vtt') || trimmed.startsWith('WEBVTT')) {
    return withCaptionClips(project, clipsFromCaptionCues(parseCaptionCues(trimmed)))
  }
  if (name.endsWith('.otio') || trimmed.includes('OTIO_SCHEMA')) {
    return importOtio(project, JSON.parse(trimmed))
  }
  if (name.endsWith('.fcpxml') || trimmed.includes('<fcpxml')) {
    return importFcpxml(project, trimmed)
  }
  if (name.endsWith('.kdenlive') || trimmed.includes('kdenlive:docproperties')) {
    return importMlt(project, trimmed)
  }
  if (name.endsWith('.mlt') || trimmed.includes('<mlt')) {
    return importMlt(project, trimmed)
  }
  if (name.endsWith('.xml') || trimmed.includes('<xmeml') || trimmed.includes('<!DOCTYPE xmeml')) {
    return importPremiere(project, trimmed)
  }
  if (name.endsWith('.json') || trimmed.startsWith('{')) {
    const json = JSON.parse(trimmed) as {
      OTIO_SCHEMA?: string
      chunks?: unknown
      timeline?: unknown
      chapters?: unknown
    }
    if (json.OTIO_SCHEMA) return importOtio(project, json)
    if (json.chunks || json.timeline) return importAutoEditor(project, json)
  }
  throw new Error(
    'Unrecognized timeline. Use OTIO, FCPXML, Premiere XML, Shotcut MLT, Kdenlive, Auto-Editor JSON, or SRT/VTT.'
  )
}

export async function pickInterchange(): Promise<{ name: string; text: string } | null> {
  if (typeof document === 'undefined') return null
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.otio,.fcpxml,.mlt,.kdenlive,.json,.xml,.srt,.vtt'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      resolve({ name: file.name, text: await file.text() })
    }
    input.click()
  })
}
