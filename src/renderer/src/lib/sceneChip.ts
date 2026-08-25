import type { EditorialScene } from '../types'

/** Action ids that belong on the scene heading, not only in the inspector. */
export const SCENE_CHIP_ACTION_IDS = new Set([
  'use-final',
  'keep-take',
  'keep-all',
  'cut-scene',
  'restore-scene'
])

export function sceneKindLabel(scene: EditorialScene, family: EditorialScene[]): string {
  if (scene.kind === 'demo') return 'Silent demo'
  if (scene.kind === 'broll') return 'B-roll'
  if (family.length > 1 || scene.kind === 'retake') {
    const n = scene.takeIndex ?? family.findIndex((s) => s.id === scene.id) + 1
    return `Take ${Math.max(1, n)} of ${Math.max(family.length, n)}`
  }
  return 'Scene'
}

export function sceneClockLabel(scene: EditorialScene): string {
  const dur = Math.max(0, scene.end - scene.start)
  if (dur < 10) return `${dur.toFixed(1)}s`
  return `${Math.round(dur)}s`
}

export function neighborScene(
  scenes: EditorialScene[],
  sceneId: string,
  step: -1 | 1
): EditorialScene | undefined {
  const ordered = [...scenes].sort((a, b) => a.start - b.start || a.end - b.end)
  const i = ordered.findIndex((s) => s.id === sceneId)
  if (i < 0) return undefined
  return ordered[i + step]
}

/** Place every scene — including silent ones with no words — at the next spoken word. */
export function groupScenesByTranscriptAnchor(
  scenes: EditorialScene[],
  words: Array<{ start: number; end: number }>
): { atWord: Map<number, EditorialScene[]>; after: EditorialScene[] } {
  const atWord = new Map<number, EditorialScene[]>()
  const after: EditorialScene[] = []
  for (const scene of [...scenes].sort((a, b) => a.start - b.start)) {
    let idx = words.findIndex((w) => w.start >= scene.start && w.start < scene.end)
    if (idx < 0) idx = words.findIndex((w) => w.start >= scene.start - 0.02)
    if (idx < 0) {
      after.push(scene)
      continue
    }
    const list = atWord.get(idx) ?? []
    list.push(scene)
    atWord.set(idx, list)
  }
  return { atWord, after }
}
