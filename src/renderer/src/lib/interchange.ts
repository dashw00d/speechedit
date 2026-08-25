import {
  DEFAULT_TRANSFORM,
  type Cut,
  type Interval,
  type Project,
  type SegmentStyle
} from '../types'
import { invertIntervals, mergeIntervals, overlap } from './edl'
import { normalizeProject } from './normalize'
import { programLengthOf, resolveSegments, sourcePieces } from './resolver'
import { uid } from './time'
import { wordsToCaptions } from './captions'

function srtStamp(seconds: number): string {
  const t = Math.max(0, seconds)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  const ms = Math.floor((t % 1) * 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`
}

export function projectToSrt(project: Project): string {
  const current = normalizeProject(project)
  const captions = wordsToCaptions(current)
  return captions
    .map((clip, i) => {
      const start = clip.start
      const end = clip.start + clip.duration
      return `${i + 1}\n${srtStamp(start)} --> ${srtStamp(end)}\n${clip.text ?? ''}\n`
    })
    .join('\n')
}

export function projectToOtio(project: Project): string {
  const current = normalizeProject(project)
  const asset = Object.values(current.assets).find((a) => a.path)
  const segs = resolveSegments(current)
  const rate = current.fps
  const rational = (seconds: number) => ({
    OTIO_SCHEMA: 'RationalTime.1',
    value: Math.round(seconds * rate),
    rate
  })
  const clips = segs.map((seg) => ({
    OTIO_SCHEMA: 'Clip.1',
    name: `${seg.inPoint.toFixed(2)}-${seg.outPoint.toFixed(2)}`,
    source_range: {
      OTIO_SCHEMA: 'TimeRange.1',
      start_time: rational(seg.inPoint),
      duration: rational(seg.outPoint - seg.inPoint)
    },
    media_reference: asset
      ? {
          OTIO_SCHEMA: 'ExternalReference.1',
          target_url: asset.path,
          available_range: {
            OTIO_SCHEMA: 'TimeRange.1',
            start_time: rational(0),
            duration: rational(current.sourceDuration)
          }
        }
      : { OTIO_SCHEMA: 'MissingReference.1' }
  }))
  const overlays = current.tracks
    .filter((t) => t.type === 'overlay' || t.type === 'caption')
    .map((track) => ({
      OTIO_SCHEMA: 'Track.1',
      name: track.name,
      kind: track.type === 'caption' ? 'Video' : 'Video',
      children: track.clips.map((clip) => ({
        OTIO_SCHEMA: 'Clip.1',
        name: clip.text ?? clip.id,
        source_range: {
          OTIO_SCHEMA: 'TimeRange.1',
          start_time: rational(0),
          duration: rational(clip.duration)
        },
        metadata: { speechedit: { start: clip.start, assetId: clip.assetId } }
      }))
    }))
  return JSON.stringify(
    {
      OTIO_SCHEMA: 'Timeline.1',
      name: current.name,
      global_start: rational(0),
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
          words: current.transcript.words.length
        }
      }
    },
    null,
    2
  )
}

export function projectToFcpxml(project: Project): string {
  const current = normalizeProject(project)
  const asset = Object.values(current.assets).find((a) => a.path)
  const segs = resolveSegments(current)
  const fps = current.fps
  const tick = (seconds: number) => `${Math.round(seconds * fps)}/${fps}s`
  const src = asset?.path ?? ''
  const assetXml = asset
    ? `<asset id="r1" name="${escapeXml(asset.name)}" src="${escapeXml(src)}" start="0s" duration="${tick(current.sourceDuration)}" hasVideo="1" hasAudio="1" />`
    : ''
  const clipXml = segs
    .map(
      (seg, i) =>
        `<asset-clip name="seg${i + 1}" ref="r1" offset="${tick(seg.start)}" start="${tick(seg.inPoint)}" duration="${tick(seg.outPoint - seg.inPoint)}" />`
    )
    .join('\n            ')
  const titles = current.tracks
    .filter((t) => t.type === 'caption')
    .flatMap((t) => t.clips)
    .map(
      (c) =>
        `<title name="${escapeXml(c.text ?? 'Title')}" offset="${tick(c.start)}" duration="${tick(c.duration)}"><text>${escapeXml(c.text ?? '')}</text></title>`
    )
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
            ${titles}
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

export function projectToMlt(project: Project): string {
  const current = normalizeProject(project)
  const asset = Object.values(current.assets).find((a) => a.path)
  const segs = resolveSegments(current)
  const clock = (t: number) => {
    const ms = Math.round((t % 1) * 1000)
    const s = Math.floor(t) % 60
    const m = Math.floor(t / 60) % 60
    const h = Math.floor(t / 3600)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
  }
  const entries = segs
    .map(
      (seg) =>
        `    <entry producer="src" in="${clock(seg.inPoint)}" out="${clock(Math.max(seg.inPoint, seg.outPoint - 1 / current.fps))}" />`
    )
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<mlt LC_NUMERIC="C" version="7.24.0" title="${escapeXml(current.name)}">
  <profile width="${current.width}" height="${current.height}" frame_rate_num="${current.fps}" frame_rate_den="1" />
  <producer id="src" in="${clock(0)}" out="${clock(current.sourceDuration)}">
    <property name="resource">${escapeXml(asset?.path ?? '')}</property>
  </producer>
  <playlist id="video">
${entries}
  </playlist>
  <tractor id="tractor0" title="${escapeXml(current.name)}" in="${clock(0)}" out="${clock(programLengthOf(current))}">
    <track producer="video" />
  </tractor>
</mlt>
`
}

function importOtio(project: Project, raw: unknown): Project {
  const data = raw as {
    metadata?: { speechedit?: { cuts?: Cut[] } }
    tracks?: { children?: Array<{ kind?: string; name?: string; children?: unknown[] }> }
  }
  if (data.metadata?.speechedit?.cuts?.length) {
    return applyTimeline(
      project,
      data.metadata.speechedit.cuts.map((c) => ({
        id: c.id || uid('cut'),
        start: c.start,
        end: c.end,
        source: c.source ?? 'manual'
      }))
    )
  }
  const video = (data.tracks?.children ?? []).find(
    (t) => (t.kind ?? '').toLowerCase() === 'video' || (t.name ?? '').toLowerCase().includes('picture')
  )
  const kept: Interval[] = []
  for (const clip of (video?.children ?? []) as Array<{
    source_range?: { start_time?: unknown; duration?: unknown }
  }>) {
    const start = secondsFromRational(clip.source_range?.start_time)
    const duration = secondsFromRational(clip.source_range?.duration)
    if (duration > 0.03) kept.push({ start, end: start + duration })
  }
  if (!kept.length) return project
  return applyTimeline(project, cutsFromKept(kept, project.sourceDuration || kept[kept.length - 1].end))
}

function importFcpxml(project: Project, xml: string): Project {
  const kept: Interval[] = []
  const clipRe =
    /<asset-clip[^>]*\bstart="([^"]+)"[^>]*\bduration="([^"]+)"|<asset-clip[^>]*\bduration="([^"]+)"[^>]*\bstart="([^"]+)"/g
  let match: RegExpExecArray | null
  while ((match = clipRe.exec(xml))) {
    const start = secondsFromStamp(match[1] ?? match[4] ?? '0')
    const duration = secondsFromStamp(match[2] ?? match[3] ?? '0')
    if (duration > 0.03) kept.push({ start, end: start + duration })
  }
  if (!kept.length) return project
  return applyTimeline(project, cutsFromKept(kept, project.sourceDuration || kept[kept.length - 1].end))
}

function importMlt(project: Project, xml: string): Project {
  const kept: Interval[] = []
  const entryRe = /<entry[^>]*\bin="([^"]+)"[^>]*\bout="([^"]+)"/g
  let match: RegExpExecArray | null
  while ((match = entryRe.exec(xml))) {
    const start = secondsFromStamp(match[1])
    const end = secondsFromStamp(match[2])
    if (end > start) kept.push({ start, end })
  }
  if (!kept.length) return project
  return applyTimeline(project, cutsFromKept(kept, project.sourceDuration || kept[kept.length - 1].end))
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
  if (name.endsWith('.otio') || trimmed.includes('OTIO_SCHEMA')) {
    return importOtio(project, JSON.parse(trimmed))
  }
  if (name.endsWith('.fcpxml') || trimmed.includes('<fcpxml')) {
    return importFcpxml(project, trimmed)
  }
  if (name.endsWith('.mlt') || trimmed.includes('<mlt')) {
    return importMlt(project, trimmed)
  }
  if (name.endsWith('.json') || trimmed.startsWith('{')) {
    const json = JSON.parse(trimmed) as { OTIO_SCHEMA?: string; chunks?: unknown; timeline?: unknown }
    if (json.OTIO_SCHEMA) return importOtio(project, json)
    if (json.chunks || json.timeline) return importAutoEditor(project, json)
  }
  throw new Error('Unrecognized timeline. Use OTIO, FCPXML, Shotcut MLT, or Auto-Editor JSON.')
}

export async function pickInterchange(): Promise<{ name: string; text: string } | null> {
  if (typeof document === 'undefined') return null
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.otio,.fcpxml,.mlt,.json,.xml'
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

