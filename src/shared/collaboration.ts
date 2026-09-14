import { z } from 'zod'
import type { Project, Asset } from '../renderer/src/types'
import { resolveProgram } from '../renderer/src/lib/resolver'

const id = z.string().min(1).max(120).refine(s => !['__proto__', 'constructor', 'prototype'].includes(s))
const mediaId = id.regex(/^[a-zA-Z0-9_-]{1,120}$/)
const text = z.string().max(10000), num = z.number().finite().min(-1e9).max(1e9), time = z.number().min(0).max(86400)
const span = { start: time, end: time }, crop = z.object({ x: num, y: num, w: num, h: num })
const transform = z.object({ x: num, y: num, scale: num, rotation: num, opacity: num, crop })
const keys = z.array(z.object({ time, transform: transform.partial(), easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']) })).max(10000)
const style = z.object({ fontSize: num, align: z.enum(['left', 'center', 'right']), fill: text, stroke: text, position: z.enum(['lower', 'center', 'upper']) })
export const sharedAssetSchema = z.object({ id: mediaId, name: z.string().max(300), kind: z.enum(['video', 'audio', 'image']), duration: time,
  width: num.optional(), height: num.optional(), fps: num.optional(), sampleRate: num.optional(), waveform: z.array(z.number().min(0).max(1)).max(2000), sourceOffset: time.optional(), isRecording: z.boolean().optional() })
const clip = z.object({ id, trackId: id, assetId: mediaId.optional(), start: time, duration: time, inPoint: time, outPoint: time, linkedClipId: id.optional(), transform, volume: num, muted: z.boolean(), speed: num, fadeIn: time, fadeOut: time, keyframes: keys, pan: num.optional(), text: text.optional(), style: style.optional(), effect: z.enum(['none', 'blur']).optional(), kind: z.enum(['media', 'slug']).optional(), auto: z.boolean().optional(), replaceVoice: z.boolean().optional() })
const rows = <T extends z.ZodType>(schema: T, max = 20000) => z.array(schema).max(max)
const schema = z.object({ id, name: z.string().max(300), fps: num.positive(), width: num.positive(), height: num.positive(), sourceDuration: time,
  assets: z.record(mediaId, sharedAssetSchema),
  tracks: rows(z.object({ id, type: z.enum(['video', 'audio', 'overlay', 'caption']), name: text, locked: z.boolean(), muted: z.boolean(), hidden: z.boolean(), solo: z.boolean().optional(), clips: rows(clip) }), 1000),
  transcript: z.object({ words: rows(z.object({ id, text, ...span, speaker: id, deleted: z.boolean(), origin: z.literal('island').optional() }), 150000), speakers: rows(z.object({ id, name: text, color: text }), 1000) }),
  cuts: rows(z.object({ id, ...span, source: z.enum(['transcript', 'silence', 'manual', 'filler', 'repeat', 'model']) })), splits: rows(time),
  styles: rows(z.object({ id, ...span, speed: num, transform, volume: num, fadeIn: time, fadeOut: time, keyframes: keys, pan: num.optional() })),
  suggestions: rows(z.object({ id, type: z.enum(['silence', 'filler', 'repeat', 'static', 'low-motion', 'loud', 'pace', 'model']), ...span, action: z.enum(['cut', 'speed', 'review', 'normalize', 'volume']), label: text, safe: z.boolean(), applied: z.boolean(), speed: num.optional(), volume: num.optional(), blockedBy: text.optional() })),
  scenes: rows(z.object({ id, ...span, title: text, summary: text, kind: z.enum(['talk', 'demo', 'retake', 'broll', 'other']), takeOf: id.optional(), takeIndex: num.optional() })),
  tags: rows(z.object({ id, ...span, kind: z.enum(['keep', 'demo', 'note', 'hook', 'cta']), label: text })),
  inserts: rows(z.object({ id, programStart: time, duration: time, kind: z.enum(['black', 'silence', 'hold']), holdSourceTime: time.optional() })).optional(), picture: transform,
  audioMaster: z.object({ volume: num, muted: z.boolean(), fadeIn: time, fadeOut: time, normalize: z.boolean(), eqLow: num, eqMid: num, eqHigh: num, compress: z.boolean(), duck: num }),
  cutMargin: time, encoder: z.string().max(100), analysis: z.object({ silence: rows(z.object(span)), staticRegions: rows(z.object(span)), sceneTimes: rows(time).optional(), loudness: rows(z.object({ ...span, lufs: num })) }),
  markIn: time.nullable(), markOut: time.nullable(), createdAt: z.number().nonnegative(), updatedAt: z.number().nonnegative()
})
/** Whitelist the editable document; local paths, browser keys and arbitrary URLs never leave the device. */
export function sharedProject(raw: unknown): Project {
  const parsed = schema.parse(raw)
  if (Object.keys(parsed.assets).length > 256) throw new Error('A shared project supports up to 256 media files.')
  const assets: Record<string, Asset> = {}
  for (const [key, asset] of Object.entries(parsed.assets)) {
    if (key !== asset.id) throw new Error('Media identifiers do not match.')
    assets[key] = { ...asset, path: `shared-media:${key}` }
  }
  const seen = new Set<string>(), clips = new Set<string>()
  for (const track of parsed.tracks) {
    if (seen.has(track.id)) throw new Error('Duplicate track identifier.')
    seen.add(track.id)
    for (const c of track.clips) {
      if (c.trackId !== track.id || clips.has(c.id) || (c.assetId && !assets[c.assetId])) throw new Error('Invalid clip media or track reference.')
      clips.add(c.id)
    }
  }
  return { ...parsed, assets }
}
export function prepareSharedProject(project: Project): Project {
  return sharedProject({ ...project, assets: Object.fromEntries(Object.entries(project.assets).map(([key, a]) => [key, { ...a, waveform: a.waveform.filter((_, i) => i % Math.max(1, Math.ceil(a.waveform.length / 2000)) === 0).map(n => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0))) }])) })
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
/** Merge only clearly separate word spans; ambiguous/overlapping changes need a decision.
 * Keep whitespace as tokens so merging never reformats the user's caption. Each side is
 * conservatively treated as one changed span (linear time, even for long captions).
 */
function mergeCaptionText(base: string, local: string, remote: string): string | undefined {
  const tokens = (value: string) => value.match(/\s+|[^\s]+/gu) || []
  const original = tokens(base)
  const change = (value: string) => {
    const next = tokens(value)
    let start = 0, end = original.length, nextEnd = next.length
    while (start < end && start < nextEnd && original[start] === next[start]) start++
    while (end > start && nextEnd > start && original[end - 1] === next[nextEnd - 1]) { end--; nextEnd-- }
    return { start, end, replacement: next.slice(start, nextEnd) }
  }
  const a = change(local), b = change(remote)
  const [first, second] = a.start <= b.start ? [a, b] : [b, a]
  // Also reject touching spans: adjacent corrections have an unchanged whitespace
  // token between them; insertions at the same boundary have no stable ordering.
  if (first.end >= second.start) return undefined
  return [...original.slice(0, first.start), ...first.replacement,
    ...original.slice(first.end, second.start), ...second.replacement,
    ...original.slice(second.end)].join('')
}
/** Three-way merge of stable editorial objects. Conflicting edits remain explicit and never overwrite silently. */
export function mergeSharedProjects(base: Project, local: Project, remote: Project): { project: Project; conflicts: string[] } {
  const conflicts: string[] = []
  const captionIds = (p: Project) => new Set(p.tracks.filter(t => t.type === 'caption').flatMap(t => t.clips.map(c => c.id)))
  const captions = [base, local, remote].map(captionIds)
  function merge(b: any, l: any, r: any, path: string, captionText = false): any {
    if (equal(l, r) || equal(b, r)) return l
    if (equal(b, l)) return r
    if (captionText && [b, l, r].every(v => typeof v === 'string')) {
      const combined = mergeCaptionText(b, l, r)
      if (combined !== undefined) return combined
    }
    if (path === 'updatedAt') return Math.max(l, r)
    // Concurrent first recordings create the same track container. Merge that
    // container only when its settings agree and the takes occupy separate slots.
    // Keep overlapping takes, incompatible settings and deletion/edit conflicts explicit.
    if (b === undefined && /^tracks\[[^\]]+\]$/.test(path) && l && r &&
        Array.isArray(l.clips) && Array.isArray(r.clips)) {
      const { clips: lc, ...ls } = l, { clips: rc, ...rs } = r
      const independent = lc.every((a: any) => rc.every((c: any) =>
        a.id === c.id ? equal(a, c) : a.start + a.duration <= c.start || c.start + c.duration <= a.start))
      if (equal(ls, rs) && independent) {
        return { ...ls, clips: merge([], lc, rc, `${path}.clips`)
          .sort((a: any, c: any) => a.start - c.start || a.id.localeCompare(c.id)) }
      }
    }
    if (l && r && b && !Array.isArray(l) && !Array.isArray(r) && typeof l === 'object' && typeof r === 'object') {
      return Object.fromEntries([...new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])].map(k => [k, merge(b[k], l[k], r[k], path ? `${path}.${k}` : k, k === 'text' && b.id === l.id && b.id === r.id && typeof b.trackId === 'string' && captions.every(ids => ids.has(b.id)))]).filter(([, value]) => value !== undefined))
    }
    if ([b, l, r].every(v => Array.isArray(v) && v.every(x => x && typeof x.id === 'string') && new Set(v.map(x => x.id)).size === v.length)) {
      const ids = (v: any[]) => v.map(x => x.id)
      const original = ids(b), common = original.filter(id => l.some((v: any) => v.id === id) && r.some((v: any) => v.id === id))
      const order = (v: any[]) => ids(v).filter(id => common.includes(id))
      const lo = order(l), ro = order(r), bo = order(b)
      if (!equal(lo, ro) && !equal(lo, bo) && !equal(ro, bo)) { conflicts.push(`${path}.order`); return l }
      const primary = equal(lo, bo) ? r : l
      const ordered = [...ids(primary), ...ids(primary === l ? r : l).filter(id => !ids(primary).includes(id))]
      return ordered.map(id => merge(b.find((v: any) => v.id === id), l.find((v: any) => v.id === id), r.find((v: any) => v.id === id), `${path}[${id}]`)).filter(v => v !== undefined)
    }
    conflicts.push(path); return l
  }
  // A clip can move between tracks. Merge its identity across the whole timeline so two moves
  // cannot create duplicate clips, and moving a deleted clip cannot resurrect it silently.
  const clipMap = (p: Project) => new Map(p.tracks.flatMap(t => t.clips.map(c => [c.id, c] as const)))
  const bm = clipMap(base), lm = clipMap(local), rm = clipMap(remote)
  const moved = new Set([...new Set([...bm.keys(), ...lm.keys(), ...rm.keys()])].filter(id => {
    const locations = [bm.get(id)?.trackId, lm.get(id)?.trackId, rm.get(id)?.trackId].filter(Boolean)
    return new Set(locations).size > 1
  }))
  const withoutMoved = (p: Project) => ({ ...p, tracks: p.tracks.map(t => ({ ...t, clips: t.clips.filter(c => !moved.has(c.id)) })) })
  const project: Project = merge(withoutMoved(base), withoutMoved(local), withoutMoved(remote), '')
  for (const id of moved) {
    let clip = merge(bm.get(id), lm.get(id), rm.get(id), `clips[${id}]`)
    if (!clip) continue
    let track = project.tracks.find(t => t.id === clip.trackId)
    if (!track) {
      conflicts.push(`clips[${id}].trackId`)
      clip = lm.get(id); track = project.tracks.find(t => t.id === clip?.trackId)
    }
    if (track && clip) track.clips = [...track.clips, clip].sort((a, b) => a.start - b.start)
  }
  // Recordings live in program time. Independently merging a cut (or another
  // timing edit) can change the source passage beneath a new recording even
  // though none of its clip fields conflict. Compare the actual source mapping
  // across its slot, including cuts before it and changes inside it.
  const slotMapping = (p: Project, start: number, end: number) => resolveProgram(p).segments
    .filter(s => s.start < end && s.start + s.duration > start)
    .map(s => {
      const from = Math.max(start, s.start), to = Math.min(end, s.start + s.duration)
      return { from, to, kind: s.kind, sourceFrom: s.inPoint + (from - s.start) * s.speed,
        sourceTo: s.inPoint + (to - s.start) * s.speed, speed: s.speed }
    }).reduce<Array<{ from: number; to: number; kind: string; sourceFrom: number; sourceTo: number; speed: number }>>((spans, span) => {
      const previous = spans.at(-1)
      // An unrelated split or volume/style boundary does not change timing.
      if (previous && previous.kind === span.kind && previous.speed === span.speed &&
        Math.abs(previous.to - span.from) < 1e-7 && Math.abs(previous.sourceTo - span.sourceFrom) < 1e-7) {
        previous.to = span.to; previous.sourceTo = span.sourceTo
      } else spans.push(span)
      return spans
    }, []).map(s => [s.kind, ...[s.from, s.to, s.sourceFrom, s.sourceTo].map(n => Math.round(n * 1e7) / 1e7)])
  const timingConflicts = new Set<string>()
  for (const [branch, clips] of [[local, lm], [remote, rm]] as const) {
    for (const c of clips.values()) {
      if (!c.replaceVoice || equal(c, bm.get(c.id))) continue
      if (!equal(slotMapping(branch, c.start, c.start + c.duration), slotMapping(project, c.start, c.start + c.duration))) {
        timingConflicts.add('The passage timing changed while someone re-recorded it. Keep your version or use the saved version, then redo the other edit.')
      }
    }
  }
  // Both draft recovery and "Keep my edits" consume this project. Return a
  // coherent local snapshot on a timing collision, never the unsafe hybrid.
  if (timingConflicts.size) return { project: local, conflicts: [...conflicts, ...timingConflicts] }
  return { project, conflicts }
}
