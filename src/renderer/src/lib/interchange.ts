import {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_TRANSFORM,
  type CaptionStyle,
  type Clip,
  type Cut,
  type Interval,
  type Project,
  type SegmentStyle
} from '../types'
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
import { uid } from './time'

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
    metadata: {
      speechedit: { speed: seg.speed, fadeIn: seg.fadeIn, fadeOut: seg.fadeOut }
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
      kind: track.type === 'caption' ? 'Subtitle' : 'Video',
      children: track.clips.map((clip) => ({
        OTIO_SCHEMA: 'Clip.1',
        name: clip.text ?? clip.id,
        source_range: {
          OTIO_SCHEMA: 'TimeRange.1',
          start_time: rational(0),
          duration: rational(clip.duration)
        },
        metadata: {
          speechedit: {
            start: clip.start,
            assetId: clip.assetId,
            text: clip.text,
            style: clip.style,
            kind: track.type
          }
        }
      }))
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
          styles: current.styles
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
  const asset = Object.values(current.assets).find((a) => a.path)
  const segs = resolveSegments(current)
  const fps = current.fps
  const tick = (seconds: number) => `${Math.round(seconds * fps)}/${fps}s`
  const src = asset?.path ?? ''
  const assetXml = asset
    ? `<asset id="r1" name="${escapeXml(asset.name)}" src="${escapeXml(src)}" start="0s" duration="${tick(current.sourceDuration)}" hasVideo="1" hasAudio="1" />`
    : ''
  const titles = current.tracks
    .filter((t) => t.type === 'caption' || t.type === 'overlay')
    .flatMap((t) => t.clips.filter((c) => c.text && !c.assetId))
  const titleXml = (clip: Clip) =>
    `<title name="${escapeXml(clip.text ?? 'Title')}" lane="1" offset="${tick(clip.start)}" duration="${tick(clip.duration)}"><text>${escapeXml(clip.text ?? '')}</text></title>`
  const clipXml = segs
    .map((seg, i) => {
      const children = i === 0 ? titles.map(titleXml).join('\n              ') : ''
      const inner = children ? `\n              ${children}\n            ` : ''
      return `<asset-clip name="seg${i + 1}" ref="r1" offset="${tick(seg.start)}" start="${tick(seg.inPoint)}" duration="${tick(seg.outPoint - seg.inPoint)}">${inner}</asset-clip>`
    })
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
  const asset = Object.values(current.assets).find((a) => a.path)
  const segs = resolveSegments(current)
  const entries = segs
    .map(
      (seg) =>
        `    <entry producer="src" in="${mltClock(seg.inPoint)}" out="${mltClock(Math.max(seg.inPoint, seg.outPoint - 1 / current.fps))}" />`
    )
    .join('\n')
  const titles = titlePlaylist(current)
  return `<?xml version="1.0" encoding="utf-8"?>
<mlt LC_NUMERIC="C" version="7.24.0" title="${escapeXml(current.name)}">
  <profile width="${current.width}" height="${current.height}" frame_rate_num="${current.fps}" frame_rate_den="1" />
  <producer id="src" in="${mltClock(0)}" out="${mltClock(current.sourceDuration)}">
    <property name="resource">${escapeXml(asset?.path ?? '')}</property>
  </producer>
${titles.producers}
  <playlist id="video">
${entries}
  </playlist>
  <playlist id="audio">
${entries}
  </playlist>
  <playlist id="titles">
${titles.playlist}  </playlist>
  <tractor id="tractor0" title="${escapeXml(current.name)}" in="${mltClock(0)}" out="${mltClock(programLengthOf(current))}">
    <track producer="video" />
    <track producer="audio" />
    <track producer="titles" />
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
  const asset = Object.values(current.assets).find((a) => a.path)
  const segs = resolveSegments(current)
  const fps = current.fps
  const frames = (seconds: number) => Math.round(seconds * fps)
  const pathurl = asset?.path ? `file://${asset.path.replace(/\\/g, '/')}` : ''
  const clipItems = segs
    .map((seg, i) => {
      const start = frames(seg.start)
      const end = frames(seg.start + seg.duration)
      const inn = frames(seg.inPoint)
      const out = frames(seg.outPoint)
      return `          <clipitem id="clip${i + 1}">
            <name>seg${i + 1}</name>
            <duration>${out - inn}</duration>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            <start>${start}</start>
            <end>${end}</end>
            <in>${inn}</in>
            <out>${out}</out>
            <file id="file1">
              <name>${escapeXml(asset?.name ?? current.name)}</name>
              <pathurl>${escapeXml(pathurl)}</pathurl>
              <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
              <duration>${frames(current.sourceDuration)}</duration>
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
      </video>
      <audio>
        <track>
${clipItems}
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

function importOtio(project: Project, raw: unknown): Project {
  const data = raw as {
    metadata?: {
      speechedit?: {
        cuts?: Cut[]
        captions?: Array<{ start: number; duration: number; text: string; style?: CaptionStyle }>
        styles?: SegmentStyle[]
      }
    }
    tracks?: { children?: Array<{ kind?: string; name?: string; children?: unknown[] }> }
  }
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
    if (kept.length) {
      next = applyTimeline(project, cutsFromKept(kept, project.sourceDuration || kept[kept.length - 1].end))
    }
  }
  const metaCaps = data.metadata?.speechedit?.captions ?? []
  if (metaCaps.length) return restoreCaptions(next, metaCaps)
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
  return graphics.length ? restoreCaptions(next, graphics) : next
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
  return titles.length ? restoreCaptions(next, titles) : next
}

function importMlt(project: Project, xml: string): Project {
  const kept: Interval[] = []
  const frame = 1 / (project.fps || 30)
  const entryRe = /<entry[^>]*producer="src"[^>]*\bin="([^"]+)"[^>]*\bout="([^"]+)"|<entry[^>]*\bin="([^"]+)"[^>]*\bout="([^"]+)"[^>]*producer="src"/g
  let match: RegExpExecArray | null
  while ((match = entryRe.exec(xml))) {
    const start = secondsFromStamp(match[1] ?? match[3] ?? '0')
    const end = secondsFromStamp(match[2] ?? match[4] ?? '0') + frame
    if (end > start) kept.push({ start, end })
  }
  if (!kept.length) {
    const loose = /<entry[^>]*\bin="([^"]+)"[^>]*\bout="([^"]+)"/g
    while ((match = loose.exec(xml))) {
      if (xml.slice(Math.max(0, match.index - 80), match.index).includes('title')) continue
      const start = secondsFromStamp(match[1])
      const end = secondsFromStamp(match[2]) + frame
      if (end > start) kept.push({ start, end })
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
  return titles.length ? restoreCaptions(next, titles) : next
}

function importPremiere(project: Project, xml: string): Project {
  const rateMatch = xml.match(/<timebase>(\d+)<\/timebase>/)
  const rate = Number(rateMatch?.[1] ?? project.fps ?? 30)
  const kept: Interval[] = []
  const clipRe = /<clipitem[\s\S]*?<in>([^<]+)<\/in>[\s\S]*?<out>([^<]+)<\/out>/g
  let match: RegExpExecArray | null
  while ((match = clipRe.exec(xml))) {
    const start = Number(match[1]) / rate
    const end = Number(match[2]) / rate
    if (end > start) kept.push({ start, end })
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
  return titles.length ? restoreCaptions(next, titles) : next
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
