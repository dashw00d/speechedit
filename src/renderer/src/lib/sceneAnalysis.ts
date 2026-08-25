import type { EditSuggestion, EditorialScene, Interval, Project, RangeTag, Word } from '../types'
import { overlap } from './edl'
import { detectRepeats } from './analysis'
import { isFillerToken } from './transcript'
import { uid } from './time'

export interface SceneDraft {
  scenes: EditorialScene[]
  suggestions: EditSuggestion[]
}

function tokenKey(text: string): string {
  return text.toLowerCase().replace(/[.,!?'"]/g, '')
}

function liveIn(words: Word[], span: Interval): Word[] {
  return words
    .filter((w) => !w.deleted && w.end > span.start && w.start < span.end && tokenKey(w.text))
    .sort((a, b) => a.start - b.start)
}

function titleOf(words: Word[]): string {
  const bits = words
    .filter((w) => !isFillerToken(w.text))
    .slice(0, 5)
    .map((w) => w.text)
  return bits.join(' ').replace(/[.,]$/, '') || 'Scene'
}

function speechIslands(words: Word[], gap = 1.2): Interval[] {
  const live = words.filter((w) => !w.deleted).sort((a, b) => a.start - b.start)
  if (!live.length) return []
  const out: Interval[] = []
  let start = live[0].start
  let end = live[0].end
  for (let i = 1; i < live.length; i++) {
    if (live[i].start - end > gap) {
      out.push({ start, end })
      start = live[i].start
    }
    end = Math.max(end, live[i].end)
  }
  out.push({ start, end })
  return out
}

function splitByRepeats(islands: Interval[], repeats: Interval[]): Interval[] {
  let pieces = [...islands]
  for (const hit of repeats) {
    pieces = pieces.flatMap((span) => {
      if (overlap(span, hit) < 0.2) return [span]
      const out: Interval[] = []
      if (hit.start - span.start >= 0.35) out.push({ start: span.start, end: hit.start })
      if (hit.end - hit.start >= 0.25) out.push({ start: Math.max(span.start, hit.start), end: Math.min(span.end, hit.end) })
      if (span.end - hit.end >= 0.35) out.push({ start: hit.end, end: span.end })
      return out.length ? out : [span]
    })
  }
  return pieces.filter((p) => p.end - p.start >= 0.2)
}

function demoSpans(input: {
  duration: number
  silence: Interval[]
  staticRegions: Interval[]
  tags: RangeTag[]
}): Interval[] {
  const tagged = input.tags.filter((t) => t.kind === 'demo' || t.kind === 'keep')
  const stillSilence = input.silence.filter((gap) =>
    input.staticRegions.some((s) => overlap(s, gap) > (gap.end - gap.start) * 0.3)
  )
  return [...tagged, ...stillSilence].filter((s) => s.end - s.start >= 1.2)
}

/**
 * Offline scene/retake pass. Groups speech islands, marks n-gram retakes,
 * and promotes silent+still (or demo-tagged) spans so Auto Edit can skip them.
 */
export function inferScenesLocal(project: Pick<Project, 'sourceDuration' | 'transcript'> & {
  analysis?: { silence?: Interval[]; staticRegions?: Interval[] }
  tags?: RangeTag[]
  suggestions?: EditSuggestion[]
}): SceneDraft {
  const words = project.transcript.words
  const repeats = detectRepeats(words)
  const islands = splitByRepeats(speechIslands(words), repeats)
  const scenes: EditorialScene[] = []

  for (const span of islands) {
    const spoken = liveIn(words, span)
    if (!spoken.length) continue
    const id = uid('sc')
    const hit = repeats.find((r) => overlap(r, span) > (span.end - span.start) * 0.55)
    scenes.push({
      id,
      start: span.start,
      end: span.end,
      title: titleOf(spoken),
      summary: spoken
        .map((w) => w.text)
        .join(' ')
        .slice(0, 140),
      kind: hit ? 'retake' : 'talk',
      takeOf: undefined
    })
  }

  for (const scene of scenes) {
    if (scene.kind !== 'retake') continue
    const keeper = scenes.find(
      (s) => s.id !== scene.id && s.kind === 'talk' && s.start >= scene.end - 0.05
    )
    if (keeper) scene.takeOf = keeper.id
  }

  for (const span of demoSpans({
    duration: project.sourceDuration,
    silence: project.analysis?.silence ?? [],
    staticRegions: project.analysis?.staticRegions ?? [],
    tags: project.tags ?? []
  })) {
    if (scenes.some((s) => overlap(s, span) > (span.end - span.start) * 0.5)) continue
    scenes.push({
      id: uid('sc'),
      start: span.start,
      end: span.end,
      title: 'Silent walkthrough',
      summary: 'No speech — likely a product demo. Auto Edit should skip this.',
      kind: 'demo'
    })
  }

  scenes.sort((a, b) => a.start - b.start)

  const existing = project.suggestions ?? []
  const suggestions: EditSuggestion[] = []
  for (const scene of scenes) {
    if (scene.kind !== 'retake') continue
    if (
      existing.some((s) => s.type === 'repeat' && overlap(s, scene) > (scene.end - scene.start) * 0.5) ||
      repeats.some((s) => overlap(s, scene) > (scene.end - scene.start) * 0.5)
    ) {
      continue
    }
    suggestions.push({
      id: uid('sug'),
      type: 'model',
      start: scene.start,
      end: scene.end,
      action: 'cut',
      label: `Superseded take · ${scene.title}`,
      safe: false,
      applied: false
    })
  }

  return { scenes, suggestions }
}

export function retakeRanges(project: Pick<Project, 'scenes' | 'suggestions'>): Interval[] {
  const fromScenes = (project.scenes ?? [])
    .filter((s) => s.kind === 'retake')
    .map((s) => ({ start: s.start, end: s.end }))
  const fromSug = (project.suggestions ?? [])
    .filter((s) => s.type === 'repeat' && !s.applied)
    .map((s) => ({ start: s.start, end: s.end }))
  return [...fromScenes, ...fromSug]
}
