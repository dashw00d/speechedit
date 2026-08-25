import type { EditSuggestion, Interval, RangeTag, Word } from '../types'
import { invertIntervals, mergeIntervals, overlap } from './edl'
import { isFillerToken } from './transcript'
import { uid } from './time'

/**
 * Suggestion-layer detectors inspired by Auto-Editor's first pass:
 * audio inactivity + `--margin` padding around kept speech, composed with
 * motion/stillness so silent demos are not cut blindly. Everything here is a
 * suggestion — only long interior dead air is marked safe.
 */
export interface AnalysisInput {
  duration: number
  silence: Interval[]
  scenes?: number[]
  sceneHits?: Interval[]
  loudnessWindows?: { start: number; end: number; lufs: number }[]
  words: Word[]
  margin?: number
}

export const DEFAULT_CUT_MARGIN = 0.12
const DEAD_AIR_REMAINING = 0.55
const BREATH_REMAINING_MIN = 0.12
const BREATH_RAW_MAX = 0.95
const WORD_BREATH_RAW_MIN = 0.35
const EDGE_RAW_MIN = 0.6
const STILL_OVERLAP = 0.35
const RETAKE_GAP_MIN = 0.4
const RETAKE_GAP_MAX = 22
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'and',
  'or',
  'in',
  'on',
  'for',
  'is',
  'it',
  'we',
  'i',
  'you',
  'that',
  'this',
  'with',
  'as',
  'at',
  'be',
  'by',
  'from',
  'not',
  'but',
  'so',
  'if',
  'then',
  'than',
  'my',
  'our',
  'your',
  'was',
  'are',
  'were',
  'been',
  'have',
  'has',
  'had',
  'do',
  'did',
  'does',
  'will',
  'would',
  'can',
  'just',
  'like',
  'know',
  'there',
  'here',
  'what',
  'when',
  'how',
  'all',
  'no',
  'yes',
  'ok',
  'oh',
  'yeah',
  'um',
  'uh',
  'gonna',
  'wanna',
  'got',
  'get',
  'they',
  'them',
  'their',
  'its',
  'into',
  'about',
  'up',
  'out',
  'now',
  'very'
])

function tokenKey(text: string): string {
  return text.toLowerCase().replace(/[.,!?'"]/g, '')
}

function hesitationGap(words: Word[], i: number): boolean {
  const prev = words[i - 1]
  const next = words[i + 1]
  const before = prev ? words[i].start - prev.end : 1
  const after = next ? next.start - words[i].end : 1
  return before >= 0.14 || after >= 0.18
}

export function detectFillers(words: Word[]): EditSuggestion[] {
  const out: EditSuggestion[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const key = tokenKey(w.text)
    // Discourse "like" / "Like this" is not a cut. Only um/uh-class tokens.
    if (
      isFillerToken(w.text) &&
      (key === 'um' || key === 'uh' || key === 'uhm' || key === 'uhh' || hesitationGap(words, i))
    ) {
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
    if (key === 'you' && next && tokenKey(next.text) === 'know') {
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

export function withCutMargin(gaps: Interval[], margin = DEFAULT_CUT_MARGIN): Interval[] {
  return gaps
    .map((g) => ({ start: g.start + margin, end: g.end - margin }))
    .filter((g) => g.end - g.start >= 0.25)
}

function padGap(
  gap: Interval,
  margin: number,
  duration: number
): { padded: Interval; kind: 'leading' | 'trailing' | 'interior' } | null {
  const leading = gap.start <= 0.05
  const trailing = duration > 0 && gap.end >= duration - 0.05
  const start = gap.start + (leading ? 0 : margin)
  const end = gap.end - (trailing ? 0 : margin)
  if (end - start < BREATH_REMAINING_MIN) return null
  const kind = leading ? 'leading' : trailing ? 'trailing' : 'interior'
  return { padded: { start, end }, kind }
}

function stillFrame(range: Interval, staticRegions: Interval[]): boolean {
  const span = range.end - range.start
  if (span <= 0) return false
  return staticRegions.some((s) => overlap(s, range) > span * STILL_OVERLAP)
}

function silenceSuggestion(
  gap: Interval,
  padded: Interval,
  kind: 'leading' | 'trailing' | 'interior',
  margin: number,
  staticRegions: Interval[]
): EditSuggestion {
  const raw = gap.end - gap.start
  const remain = padded.end - padded.start
  const still = stillFrame(padded, staticRegions)
  const breath = kind === 'interior' && (remain < DEAD_AIR_REMAINING || raw <= BREATH_RAW_MAX)
  const hold = kind === 'interior' ? raw : remain
  const padMs = Math.round(margin * 1000)
  let label: string
  if (kind === 'leading') label = `Leading silence ${hold.toFixed(1)}s · ${padMs}ms speech pad`
  else if (kind === 'trailing') label = `Trailing silence ${hold.toFixed(1)}s · ${padMs}ms speech pad`
  else if (still) label = `Silent still ${raw.toFixed(1)}s · maybe a demo — tag before cutting`
  else if (breath) label = `Breath ${raw.toFixed(1)}s · ${padMs}ms pad`
  else label = `Dead air ${raw.toFixed(1)}s · ${padMs}ms pad`

  const safe = !still && !breath && remain >= (kind === 'interior' ? DEAD_AIR_REMAINING : 0.25)
  return {
    id: uid('sug'),
    type: 'silence',
    start: padded.start,
    end: padded.end,
    action: still ? 'review' : 'cut',
    label,
    safe,
    applied: false
  }
}

export function suggestionsFromSilence(
  gaps: Interval[],
  margin = DEFAULT_CUT_MARGIN,
  staticRegions: Interval[] = [],
  duration = 0
): EditSuggestion[] {
  return mergeIntervals(gaps).flatMap((gap) => {
    const hit = padGap(gap, margin, duration)
    if (!hit) return []
    return [silenceSuggestion(gap, hit.padded, hit.kind, margin, staticRegions)]
  })
}

export function suggestionsFromWordGaps(
  words: Word[],
  silence: Interval[] = [],
  margin = DEFAULT_CUT_MARGIN
): EditSuggestion[] {
  const live = words.filter((w) => !w.deleted).sort((a, b) => a.start - b.start)
  const covered = mergeIntervals(silence)
  const out: EditSuggestion[] = []
  for (let i = 1; i < live.length; i++) {
    const start = live[i - 1].end
    const end = live[i].start
    const raw = end - start
    if (raw < WORD_BREATH_RAW_MIN || raw > BREATH_RAW_MAX) continue
    const gap = { start, end }
    if (covered.some((g) => overlap(g, gap) > raw * 0.5)) continue
    const padded = { start: start + margin, end: end - margin }
    if (padded.end - padded.start < BREATH_REMAINING_MIN) continue
    out.push({
      id: uid('sug'),
      type: 'silence',
      start: padded.start,
      end: padded.end,
      action: 'cut',
      label: `Breath ${raw.toFixed(1)}s · ${Math.round(margin * 1000)}ms pad`,
      safe: false,
      applied: false
    })
  }
  return out
}

export function suggestionsFromEdges(
  duration: number,
  words: Word[],
  silence: Interval[] = [],
  margin = DEFAULT_CUT_MARGIN,
  staticRegions: Interval[] = []
): EditSuggestion[] {
  if (duration <= 0) return []
  const live = words.filter((w) => !w.deleted).sort((a, b) => a.start - b.start)
  const covered = mergeIntervals(silence)
  const gaps: Interval[] = []
  const leadEnd = live[0]?.start ?? 0
  if (
    leadEnd >= EDGE_RAW_MIN &&
    !covered.some((g) => g.start <= 0.08 && g.end >= Math.min(leadEnd, duration) - 0.05)
  ) {
    gaps.push({ start: 0, end: Math.min(leadEnd, duration) })
  }
  const trailStart = live.length ? live[live.length - 1].end : duration
  if (
    duration - trailStart >= EDGE_RAW_MIN &&
    !covered.some((g) => g.end >= duration - 0.08 && g.start <= trailStart + 0.05)
  ) {
    gaps.push({ start: Math.max(0, trailStart), end: duration })
  }
  return suggestionsFromSilence(gaps, margin, staticRegions, duration)
}

function coveredBy(existing: EditSuggestion[], next: EditSuggestion): boolean {
  const span = next.end - next.start
  return existing.some((s) => overlap(s, next) > span * 0.45)
}

export function suggestionsFromGaps(input: AnalysisInput): EditSuggestion[] {
  const margin = input.margin ?? DEFAULT_CUT_MARGIN
  const staticRegions = input.sceneHits ?? []
  const fromAudio = suggestionsFromSilence(input.silence, margin, staticRegions, input.duration)
  const fromEdges = suggestionsFromEdges(
    input.duration,
    input.words,
    input.silence,
    margin,
    staticRegions
  )
  const combined = [...fromAudio, ...fromEdges.filter((s) => !coveredBy(fromAudio, s))]
  const fromWords = suggestionsFromWordGaps(input.words, input.silence, margin)
  return [...combined, ...fromWords.filter((s) => !coveredBy(combined, s))]
}

export function suggestionsFromStatic(hits: Interval[], words: Word[] = []): EditSuggestion[] {
  const live = words.filter((w) => !w.deleted)
  return hits
    .filter((g) => g.end - g.start >= 1.8)
    .map((g) => {
      const talking = live.some((w) => overlap(w, g) > 0.2)
      if (talking) {
        return {
          id: uid('sug'),
          type: 'low-motion' as const,
          start: g.start,
          end: g.end,
          action: 'review' as const,
          label: `Low motion ${(g.end - g.start).toFixed(1)}s while talking`,
          safe: false,
          applied: false
        }
      }
      return {
        id: uid('sug'),
        type: 'static' as const,
        start: g.start,
        end: g.end,
        action: 'speed' as const,
        speed: 4,
        label: `Static screen ${(g.end - g.start).toFixed(1)}s → 4×`,
        safe: false,
        applied: false
      }
    })
}

export function talkingDuration(words: Word[], duration: number, silence: Interval[] = []): number {
  const live = words.filter((w) => !w.deleted)
  if (!live.length) return Math.max(0.5, duration)
  const span = { start: live[0].start, end: live[live.length - 1].end }
  const quiet = silence.reduce((sum, g) => sum + overlap(g, span), 0)
  return Math.max(0.5, span.end - span.start - quiet)
}

export function suggestionsFromPace(
  words: Word[],
  duration: number,
  silence: Interval[] = []
): EditSuggestion[] {
  const live = words.filter((w) => !w.deleted)
  if (live.length < 8 || duration < 8) return []
  const talk = talkingDuration(words, duration, silence)
  const wpm = (live.length / talk) * 60
  if (wpm >= 105) return []
  return [
    {
      id: uid('sug'),
      type: 'pace',
      start: live[0].start,
      end: live[live.length - 1].end,
      action: 'review',
      label: `Slow pace · ${Math.round(wpm)} wpm talking`,
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

export function protectIntervals(tags: RangeTag[]): Interval[] {
  return tags.filter(isProtectTag)
}

export function cutMinusProtected(range: Interval, tags: Array<Interval | RangeTag>): Interval[] {
  const guards = tags.filter((tag) => !('kind' in tag) || tag.kind === 'keep' || tag.kind === 'demo')
  let pieces: Interval[] = [{ start: range.start, end: range.end }]
  for (const tag of guards) {
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
  const guards = protectIntervals(tags)
  return suggestions.map((s) => {
    if (s.action === 'normalize' || s.applied) return { ...s, blockedBy: undefined }
    const remain = cutMinusProtected(s, guards)
    if (remain.length === 0) {
      return { ...s, safe: false, blockedBy: tags.find((t) => isProtectTag(t) && overlap(t, s) > 0)?.id }
    }
    return { ...s, blockedBy: undefined }
  })
}

export function blockedByLabel(tags: RangeTag[], blockedBy?: string): string | undefined {
  if (!blockedBy) return undefined
  const tag = tags.find((t) => t.id === blockedBy)
  if (!tag) return 'protected'
  if (tag.label?.trim()) return tag.label
  return tag.kind === 'demo' ? 'Silent demo' : 'Protected'
}

export function appliedSuggestionAt(
  suggestions: EditSuggestion[],
  start: number,
  end: number
): EditSuggestion | undefined {
  const span = { start, end }
  return suggestions
    .filter((s) => s.applied && s.action !== 'normalize' && overlap(s, span) > 0.02)
    .sort((a, b) => overlap(b, span) - overlap(a, span))[0]
}

export function speechIslands(duration: number, silence: Interval[]): Interval[] {
  return invertIntervals(mergeIntervals(silence), duration).filter((s) => s.end - s.start > 0.35)
}

function isContentToken(token: string): boolean {
  return token.length > 2 && !STOPWORDS.has(token)
}

function contentCount(tokens: string[]): number {
  return tokens.filter(isContentToken).length
}

export function detectRepeats(words: Word[]): EditSuggestion[] {
  const live = words.filter((w) => !w.deleted && !isFillerToken(w.text) && tokenKey(w.text))
  const tokens = live.map((w) => tokenKey(w.text))
  const raw: EditSuggestion[] = []
  for (let n = 8; n >= 4; n--) {
    const hits = new Map<string, number[]>()
    for (let i = 0; i <= tokens.length - n; i++) {
      const key = tokens.slice(i, i + n).join(' ')
      const list = hits.get(key) ?? []
      list.push(i)
      hits.set(key, list)
    }
    for (const [key, idxs] of hits) {
      if (idxs.length < 2) continue
      const parts = key.split(' ')
      const needed = n >= 6 ? 2 : 3
      if (contentCount(parts) < needed) continue
      for (let k = 1; k < idxs.length; k++) {
        const a = idxs[k - 1]
        const b = idxs[k]
        if (b < a + n) continue
        const first = live[a]
        const firstEnd = live[a + n - 1]
        const second = live[b]
        const secondEnd = live[b + n - 1]
        const gap = second.start - firstEnd.end
        if (gap < RETAKE_GAP_MIN || gap > RETAKE_GAP_MAX) continue
        if (first.speaker && second.speaker && first.speaker !== second.speaker) continue
        const d1 = firstEnd.end - first.start
        const d2 = secondEnd.end - second.start
        const ratio = d1 / Math.max(0.05, d2)
        if (ratio < 0.45 || ratio > 2.2) continue
        const between = b - (a + n)
        if (between > n * 3) continue
        if (between >= n && gap > 8) continue
        raw.push({
          id: uid('sug'),
          type: 'repeat',
          start: first.start,
          end: firstEnd.end,
          action: 'cut',
          label: `First take · “${key.slice(0, 48)}”`,
          safe: false,
          applied: false
        })
        break
      }
    }
  }
  raw.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
  const kept: EditSuggestion[] = []
  for (const hit of raw) {
    if (kept.some((k) => overlap(k, hit) > 0.15)) continue
    kept.push(hit)
  }
  return kept.sort((a, b) => a.start - b.start)
}

export function buildSuggestions(input: AnalysisInput): EditSuggestion[] {
  return [
    ...suggestionsFromGaps(input),
    ...detectFillers(input.words),
    ...detectRepeats(input.words),
    ...suggestionsFromStatic(input.sceneHits ?? [], input.words),
    ...suggestionsFromLoudness(input.loudnessWindows ?? [], input.duration),
    ...suggestionsFromPace(input.words, input.duration, input.silence)
  ]
}

export { detectFillers as detectFillersLegacy }
