import type { EditSuggestion, Interval, RangeTag, Word } from '../types'
import { invertIntervals, mergeIntervals, overlap } from './edl'
import { isFillerToken } from './transcript'
import { uid } from './time'

export interface AnalysisInput {
  duration: number
  silence: Interval[]
  scenes?: number[]
  sceneHits?: Interval[]
  loudnessWindows?: { start: number; end: number; lufs: number }[]
  words: Word[]
  margin?: number
}

export function detectFillers(words: Word[]): EditSuggestion[] {
  const out: EditSuggestion[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (isFillerToken(w.text)) {
      out.push({
        id: uid('sug'),
        type: 'filler',
        start: w.start,
        end: w.end,
        action: 'cut',
        label: w.text,
        safe: true,
        applied: w.deleted
      })
    }
    const next = words[i + 1]
    if (
      w.text.toLowerCase().replace(/[.,!?]/g, '') === 'you' &&
      next?.text.toLowerCase().replace(/[.,!?]/g, '') === 'know'
    ) {
      out.push({
        id: uid('sug'),
        type: 'filler',
        start: w.start,
        end: next.end,
        action: 'cut',
        label: 'you know',
        safe: true,
        applied: w.deleted && next.deleted
      })
    }
  }
  return out
}

export function withCutMargin(gaps: Interval[], margin = 0.12): Interval[] {
  return gaps
    .map((g) => ({ start: g.start + margin, end: g.end - margin }))
    .filter((g) => g.end - g.start >= 0.25)
}

export function suggestionsFromSilence(
  gaps: Interval[],
  margin = 0.12,
  staticRegions: Interval[] = []
): EditSuggestion[] {
  return withCutMargin(gaps, margin).map((g) => {
    const still = staticRegions.some((s) => overlap(s, g) > (g.end - g.start) * 0.35)
    const hold = g.end - g.start + margin * 2
    return {
      id: uid('sug'),
      type: 'silence' as const,
      start: g.start,
      end: g.end,
      action: still ? ('review' as const) : ('cut' as const),
      label: still
        ? `Silent still ${hold.toFixed(1)}s · maybe a demo — tag before cutting`
        : `Dead air ${hold.toFixed(1)}s · ${Math.round(margin * 1000)}ms pad`,
      safe: !still && g.end - g.start >= 0.55,
      applied: false
    }
  })
}

export function suggestionsFromStatic(hits: Interval[]): EditSuggestion[] {
  return hits
    .filter((g) => g.end - g.start >= 2.4)
    .map((g) => ({
      id: uid('sug'),
      type: 'static' as const,
      start: g.start,
      end: g.end,
      action: 'speed' as const,
      speed: 4,
      label: `Static screen ${(g.end - g.start).toFixed(1)}s → 4×`,
      safe: false,
      applied: false
    }))
}

export function suggestionsFromPace(words: Word[], duration: number): EditSuggestion[] {
  const live = words.filter((w) => !w.deleted)
  if (live.length < 8 || duration < 8) return []
  const wpm = (live.length / duration) * 60
  if (wpm >= 130) return []
  return [
    {
      id: uid('sug'),
      type: 'pace',
      start: live[0].start,
      end: live[live.length - 1].end,
      action: 'review',
      label: `Slow pace · ${Math.round(wpm)} wpm`,
      safe: false,
      applied: false
    }
  ]
}

export function suggestionsFromLoudness(
  windows: { start: number; end: number; lufs: number }[],
  duration = 0
): EditSuggestion[] {
  const hot = windows.filter((w) => w.lufs > -12)
  const quiet = windows.filter((w) => w.lufs < -24)
  const out: EditSuggestion[] = hot.map((w) => ({
    id: uid('sug'),
    type: 'loud' as const,
    start: w.start,
    end: w.end,
    action: 'review' as const,
    label: `Hot audio ${w.lufs.toFixed(1)} LUFS`,
    safe: false,
    applied: false
  }))
  if (hot.length || quiet.length > 4) {
    out.unshift({
      id: uid('sug'),
      type: 'loud',
      start: 0,
      end: duration || windows[windows.length - 1]?.end || 0,
      action: 'normalize',
      label: 'Normalize voice to -16 LUFS',
      safe: true,
      applied: false
    })
  }
  return out
}

export function isProtectTag(tag: RangeTag): boolean {
  return tag.kind === 'keep' || tag.kind === 'demo'
}

export function cutMinusProtected(range: Interval, tags: RangeTag[]): Interval[] {
  let pieces: Interval[] = [{ start: range.start, end: range.end }]
  for (const tag of tags.filter(isProtectTag)) {
    pieces = pieces.flatMap((piece) => {
      if (overlap(piece, tag) === 0) return [piece]
      const out: Interval[] = []
      if (piece.start < tag.start - 0.02) out.push({ start: piece.start, end: Math.min(piece.end, tag.start) })
      if (piece.end > tag.end + 0.02) out.push({ start: Math.max(piece.start, tag.end), end: piece.end })
      return out
    })
  }
  return pieces.filter((p) => p.end - p.start >= 0.03)
}

export function annotateProtected(suggestions: EditSuggestion[], tags: RangeTag[]): EditSuggestion[] {
  return suggestions.map((s) => {
    if (s.action === 'normalize' || s.applied) return { ...s, blockedBy: undefined }
    const remain = cutMinusProtected(s, tags)
    if (remain.length === 0) {
      return { ...s, safe: false, blockedBy: tags.find((t) => isProtectTag(t) && overlap(t, s) > 0)?.id }
    }
    return { ...s, blockedBy: undefined }
  })
}

export function speechIslands(duration: number, silence: Interval[]): Interval[] {
  return invertIntervals(mergeIntervals(silence), duration).filter((s) => s.end - s.start > 0.35)
}

function tokenKey(text: string): string {
  return text.toLowerCase().replace(/[.,!?'"]/g, '')
}

export function detectRepeats(words: Word[]): EditSuggestion[] {
  const live = words.filter((w) => !w.deleted && !isFillerToken(w.text) && tokenKey(w.text))
  const tokens = live.map((w) => tokenKey(w.text))
  const out: EditSuggestion[] = []
  const claimed = new Set<string>()
  for (let n = 6; n >= 4; n--) {
    const hits = new Map<string, number[]>()
    for (let i = 0; i <= tokens.length - n; i++) {
      const key = tokens.slice(i, i + n).join(' ')
      const list = hits.get(key) ?? []
      list.push(i)
      hits.set(key, list)
    }
    for (const [key, idxs] of hits) {
      if (idxs.length < 2 || claimed.has(key)) continue
      for (let k = 1; k < idxs.length; k++) {
        const a = idxs[k - 1]
        const b = idxs[k]
        if (b < a + n) continue
        const first = live[a]
        const firstEnd = live[a + n - 1]
        const second = live[b]
        const gap = second.start - firstEnd.end
        if (gap < 0.45 || gap > 45) continue
        claimed.add(key)
        out.push({
          id: uid('sug'),
          type: 'repeat',
          start: first.start,
          end: firstEnd.end,
          action: 'cut',
          label: `Retake · “${key.slice(0, 48)}”`,
          safe: false,
          applied: false
        })
        break
      }
    }
  }
  return out
}

export function buildSuggestions(input: AnalysisInput): EditSuggestion[] {
  return [
    ...suggestionsFromSilence(input.silence, input.margin ?? 0.12, input.sceneHits ?? []),
    ...detectFillers(input.words),
    ...detectRepeats(input.words),
    ...suggestionsFromStatic(input.sceneHits ?? []),
    ...suggestionsFromLoudness(input.loudnessWindows ?? [], input.duration),
    ...suggestionsFromPace(input.words, input.duration)
  ]
}

export { detectFillers as detectFillersLegacy }
