import type { Command, EditSuggestion, EditorialScene, Interval, Project, RangeTag, Word } from '../types'
import { detectRepeats } from './analysis'
import { overlap } from './edl'
import { isFillerToken } from './transcript'
import { uid } from './time'

export const SCENE_KINDS = new Set<EditorialScene['kind']>(['talk', 'demo', 'retake', 'broll', 'other'])

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

function contentKeys(words: Word[]): string[] {
  return words.map((w) => tokenKey(w.text)).filter((t) => t && !isFillerToken(t))
}

function titleOf(words: Word[]): string {
  const bits = words.filter((w) => !isFillerToken(w.text)).slice(0, 5).map((w) => w.text)
  return bits.join(' ').replace(/[.,]$/, '') || 'Scene'
}

export function normalizeScenes(scenes: EditorialScene[] | undefined | null): EditorialScene[] {
  return (scenes ?? [])
    .filter((s) => s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .map((s) => ({
      id: typeof s.id === 'string' && s.id ? s.id : uid('sc'),
      start: s.start,
      end: s.end,
      title: String(s.title || 'Scene'),
      summary: String(s.summary ?? ''),
      kind: SCENE_KINDS.has(s.kind) ? s.kind : 'talk',
      takeOf: s.takeOf,
      takeIndex: typeof s.takeIndex === 'number' && s.takeIndex > 0 ? s.takeIndex : undefined
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end)
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

function splitSpan(span: Interval, cut: Interval): Interval[] {
  if (overlap(span, cut) < 0.15) return [span]
  const out: Interval[] = []
  if (cut.start - span.start >= 0.3) out.push({ start: span.start, end: cut.start })
  if (cut.end - cut.start >= 0.2) out.push({ start: Math.max(span.start, cut.start), end: Math.min(span.end, cut.end) })
  if (span.end - cut.end >= 0.3) out.push({ start: cut.end, end: span.end })
  return out.length ? out : [span]
}

function splitByCuts(islands: Interval[], cuts: Interval[]): Interval[] {
  let pieces = [...islands]
  for (const cut of cuts) {
    pieces = pieces.flatMap((span) => splitSpan(span, cut))
  }
  return pieces.filter((p) => p.end - p.start >= 0.2)
}

function sentenceBreaks(words: Word[], span: Interval): number[] {
  const spoken = liveIn(words, span)
  const marks: number[] = []
  for (let i = 0; i < spoken.length - 1; i++) {
    const a = spoken[i]
    const b = spoken[i + 1]
    if (/[.!?]$/.test(a.text) && b.start - a.end >= 0.28) marks.push(b.start)
  }
  return marks
}

function splitByTopic(islands: Interval[], words: Word[]): Interval[] {
  return islands.flatMap((span) => {
    if (span.end - span.start < 7) return [span]
    const marks = sentenceBreaks(words, span)
    if (!marks.length) return [span]
    const out: Interval[] = []
    let cursor = span.start
    for (const mark of marks) {
      const left = liveIn(words, { start: cursor, end: mark })
      const right = liveIn(words, { start: mark, end: span.end })
      const a = new Set(contentKeys(left))
      const b = contentKeys(right)
      const shared = b.filter((t) => a.has(t)).length
      const jaccard = shared / Math.max(1, new Set([...a, ...b]).size)
      if (jaccard < 0.18 && mark - cursor >= 1.2 && span.end - mark >= 1.2) {
        out.push({ start: cursor, end: mark })
        cursor = mark
      }
    }
    out.push({ start: cursor, end: span.end })
    return out
  })
}

function demoSpans(input: {
  silence: Interval[]
  staticRegions: Interval[]
  tags: RangeTag[]
}): Interval[] {
  const tagged = input.tags.filter((t) => t.kind === 'demo' || t.kind === 'keep')
  const stillSilence = input.silence.filter((gap) =>
    input.staticRegions.some((s) => overlap(s, gap) > (gap.end - gap.start) * 0.3)
  )
  return [...tagged, ...stillSilence].filter((s) => s.end - s.start >= 1.1)
}

function sharedNgram(a: string[], b: string[], n: number): boolean {
  if (a.length < n || b.length < n) return false
  const keys = new Set<string>()
  for (let i = 0; i <= a.length - n; i++) keys.add(a.slice(i, i + n).join(' '))
  for (let i = 0; i <= b.length - n; i++) {
    if (keys.has(b.slice(i, i + n).join(' '))) return true
  }
  return false
}

function prefixOverlap(a: string[], b: string[], n: number): boolean {
  const len = Math.min(a.length, b.length)
  if (len < n) return false
  let i = 0
  while (i < len && a[i] === b[i]) i++
  return i >= n
}

function isRetakePair(a: string[], b: string[]): boolean {
  if (sharedNgram(a, b, 3) || prefixOverlap(a, b, 3)) return true
  const setA = new Set(a)
  const shared = b.filter((t) => setA.has(t))
  const union = new Set([...a, ...b]).size
  return shared.length >= 2 && shared.length / Math.max(1, union) >= 0.4
}

function pickKeeper(takes: EditorialScene[]): EditorialScene {
  const last = takes[takes.length - 1]
  const longest = [...takes].sort((a, b) => b.end - b.start - (a.end - a.start))[0]
  if (last.end - last.start < (longest.end - longest.start) * 0.5) return longest
  return last
}

function linkRetakes(scenes: EditorialScene[], words: Word[]): EditorialScene[] {
  const talk = scenes.filter((s) => s.kind === 'talk' || s.kind === 'retake')
  const parent = talk.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const keys = talk.map((s) => contentKeys(liveIn(words, s)))

  for (let i = 0; i < talk.length; i++) {
    for (let j = i + 1; j < talk.length; j++) {
      if (talk[j].start - talk[i].end > 48) continue
      if (!isRetakePair(keys[i], keys[j])) continue
      const a = find(i)
      const b = find(j)
      if (a !== b) parent[b] = a
    }
  }

  const groups = new Map<number, number[]>()
  talk.forEach((_, i) => {
    const root = find(i)
    const list = groups.get(root) ?? []
    list.push(i)
    groups.set(root, list)
  })

  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue
    const members = idxs.map((i) => talk[i]).sort((a, b) => a.start - b.start)
    const keeper = pickKeeper(members)
    members.forEach((scene, n) => {
      scene.takeIndex = n + 1
      if (scene.id === keeper.id) {
        scene.kind = scene.kind === 'retake' ? 'talk' : scene.kind
        scene.takeOf = undefined
        return
      }
      scene.kind = 'retake'
      scene.takeOf = keeper.id
    })
  }
  return scenes
}

function applyNoteTitles(scenes: EditorialScene[], tags: RangeTag[]): EditorialScene[] {
  for (const tag of tags.filter((t) => t.kind === 'note' && t.label.trim())) {
    const hit = scenes.find((s) => overlap(s, tag) > (s.end - s.start) * 0.35)
    if (hit) {
      hit.title = tag.label.trim()
      hit.summary = hit.summary || tag.label
    } else {
      scenes.push({
        id: uid('sc'),
        start: tag.start,
        end: tag.end,
        title: tag.label.trim(),
        summary: tag.label,
        kind: 'other'
      })
    }
  }
  return scenes
}

export function suggestionsFromScenes(
  scenes: EditorialScene[],
  existing: EditSuggestion[] = []
): EditSuggestion[] {
  const keepers = new Map(scenes.map((s) => [s.id, s]))
  const out: EditSuggestion[] = []
  for (const scene of scenes) {
    if (scene.kind !== 'retake') continue
    if (existing.some((s) => s.type === 'repeat' && overlap(s, scene) > (scene.end - scene.start) * 0.45)) {
      continue
    }
    const keeper = scene.takeOf ? keepers.get(scene.takeOf) : undefined
    const keepN = keeper?.takeIndex
    const dropN = scene.takeIndex
    const topic = keeper?.title || scene.title
    out.push({
      id: uid('sug'),
      type: 'repeat',
      start: scene.start,
      end: scene.end,
      action: 'cut',
      label:
        dropN && keepN
          ? `Retake · drop take ${dropN} · keep take ${keepN} of “${topic}”`
          : `Retake · “${topic}”`,
      safe: false,
      applied: false
    })
  }
  return out
}

/**
 * Offline scene/retake pass. Groups speech by silence and topic, marks n-gram
 * and near-duplicate takes, and promotes silent+still (or demo-tagged) spans.
 */
export function inferScenesLocal(
  project: Pick<Project, 'sourceDuration' | 'transcript'> & {
    analysis?: { silence?: Interval[]; staticRegions?: Interval[] }
    tags?: RangeTag[]
    suggestions?: EditSuggestion[]
  }
): SceneDraft {
  const words = project.transcript.words
  const repeats = detectRepeats(words)
  const islands = splitByTopic(splitByCuts(speechIslands(words), repeats), words)
  const scenes: EditorialScene[] = []

  for (const span of islands) {
    const spoken = liveIn(words, span)
    if (!spoken.length) continue
    scenes.push({
      id: uid('sc'),
      start: span.start,
      end: span.end,
      title: titleOf(spoken),
      summary: spoken
        .map((w) => w.text)
        .join(' ')
        .slice(0, 140),
      kind: 'talk'
    })
  }

  for (const span of demoSpans({
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

  applyNoteTitles(scenes, project.tags ?? [])
  linkRetakes(scenes, words)
  scenes.sort((a, b) => a.start - b.start)

  const existing = [...(project.suggestions ?? []), ...repeats]
  return { scenes: normalizeScenes(scenes), suggestions: suggestionsFromScenes(scenes, existing) }
}

export function retakeSceneDropped(
  project: Pick<Project, 'suggestions' | 'transcript'>,
  scene: Interval
): boolean {
  const spoken = project.transcript.words.filter((word) => word.start >= scene.start && word.end <= scene.end)
  return (
    Boolean(suggestionForScene(project, scene)?.applied) ||
    (spoken.length > 0 && spoken.every((word) => word.deleted))
  )
}

export function hasUncollapsedRetakes(project: Pick<Project, 'scenes' | 'suggestions' | 'transcript'>): boolean {
  return uncollapsedRetakeCount(project) > 0
}

export function uncollapsedRetakeCount(project: Pick<Project, 'scenes' | 'suggestions' | 'transcript'>): number {
  return (project.scenes ?? []).filter((scene) => scene.kind === 'retake' && !retakeSceneDropped(project, scene)).length
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

export function takeFamily(scenes: EditorialScene[], sceneId: string): EditorialScene[] {
  const scene = scenes.find((s) => s.id === sceneId)
  if (!scene) return []
  const root = scene.takeOf ?? scene.id
  const related = scenes.filter((s) => s.id === root || s.takeOf === root)
  return related.sort((a, b) => a.start - b.start)
}

export function suggestionForScene(
  project: Pick<Project, 'suggestions'>,
  scene: Interval
): EditSuggestion | undefined {
  return (project.suggestions ?? [])
    .filter((s) => s.type === 'repeat' && overlap(s, scene) > 0.05)
    .sort((a, b) => overlap(b, scene) - overlap(a, scene))[0]
}

export function commandForScene(
  project: Pick<Project, 'suggestions'>,
  scene: EditorialScene,
  action: 'apply' | 'revert'
): Command {
  const sug = suggestionForScene(project, scene)
  if (action === 'apply') {
    return sug && !sug.applied
      ? { type: 'applySuggestion', suggestionId: sug.id }
      : { type: 'deleteRange', start: scene.start, end: scene.end, source: 'repeat' }
  }
  return sug?.applied
    ? { type: 'revertSuggestion', suggestionId: sug.id }
    : { type: 'restoreRange', start: scene.start, end: scene.end }
}

const TOPIC_STOP = new Set(['the', 'a', 'an', 'of', 'bit', 'part', 'section', 'scene', 'take', 'this', 'that', 'and'])

export function topicTokens(topic: string): string[] {
  return topic
    .toLowerCase()
    .replace(/[“”]/g, '')
    .replace(/[.,!?]/g, '')
    .split(/\s+/)
    .filter((t) => t && !TOPIC_STOP.has(t))
}

export function sceneMatchesTopic(
  scene: EditorialScene,
  words: Word[],
  topic: string
): boolean {
  const needles = topicTokens(topic)
  if (!needles.length) return false
  const hay = `${scene.title} ${scene.summary} ${liveIn(words, scene)
    .map((w) => w.text)
    .join(' ')}`.toLowerCase()
  return needles.every((n) => hay.includes(n))
}

export function findTake(
  project: Pick<Project, 'scenes' | 'transcript'>,
  topic: string | undefined,
  takeIndex: number
): EditorialScene | undefined {
  const scenes = project.scenes ?? []
  const pool = topic
    ? scenes.filter((s) => sceneMatchesTopic(s, project.transcript.words, topic))
    : scenes
  const roots = new Set(pool.map((s) => s.takeOf ?? (s.takeIndex ? s.id : '')))
  for (const root of roots) {
    if (!root) continue
    const family = takeFamily(scenes, root)
    const hit = family.find((s) => s.takeIndex === takeIndex)
    if (hit) return hit
  }
  const numbered = pool.filter((s) => s.takeIndex === takeIndex)
  return numbered[0]
}
