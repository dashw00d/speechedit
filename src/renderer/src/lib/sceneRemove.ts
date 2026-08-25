import type { EditorialScene, Project } from '../types'
import { overlap } from './edl'
import { neighborScene } from './sceneChip'
import { programToSourceOf, sourceToProgramOf } from './resolver'
import { caretWord } from './transcriptEdit'
import { useEditor, usePlayback } from '../store'

export function sceneForSpan(project: Project, start: number, end: number): EditorialScene | undefined {
  return (project.scenes ?? []).find(
    (scene) => Math.abs(scene.start - start) < 0.08 && Math.abs(scene.end - end) < 0.08
  )
}

export function describeSceneRemove(scene: EditorialScene, next?: EditorialScene): string {
  const gone = scene.kind === 'demo' ? 'Removed the walkthrough' : `Removed ${scene.title}`
  if (next) return `${gone}. ${next.title} is next.`
  return `${gone}. Undo to put it back.`
}

function sceneIsDropped(project: Project, scene: EditorialScene): boolean {
  const spoken = project.transcript.words.filter((word) => word.start >= scene.start && word.end <= scene.end)
  if (spoken.length) return spoken.every((word) => word.deleted)
  const span = scene.end - scene.start
  return span > 0.05 && project.cuts.some((cut) => overlap(cut, scene) > span * 0.55)
}

function talkNeighbor(scenes: EditorialScene[], sceneId: string, step: -1 | 1): EditorialScene | undefined {
  let current = sceneId
  for (let i = 0; i < scenes.length; i += 1) {
    const next = neighborScene(scenes, current, step)
    if (!next) return undefined
    if (next.kind !== 'retake') return next
    current = next.id
  }
  return undefined
}

function sceneCovers(scene: EditorialScene, source: number): boolean {
  return source >= scene.start - 0.05 && source <= scene.end + 0.05
}

function sceneAtSource(project: Project, source: number): EditorialScene | undefined {
  return (project.scenes ?? [])
    .filter((scene) => scene.kind !== 'retake')
    .find((scene) => sceneCovers(scene, source))
}

/** Chapter under the selected heading, selected words, or playhead. */
export function sceneRemoveTarget(
  project: Project,
  programTime: number,
  selectedWordIds: string[],
  selectedSceneId: string | null
): EditorialScene | null {
  const named = selectedSceneId ? (project.scenes ?? []).find((row) => row.id === selectedSceneId) : undefined
  if (named && named.kind !== 'retake') return named
  const sourcePlayhead = programToSourceOf(project, programTime)
  const word = caretWord(project.transcript.words, selectedWordIds, sourcePlayhead)
  const source = word && !word.deleted ? word.start : sourcePlayhead
  return sceneAtSource(project, source) ?? null
}

export function sceneIsRemoved(project: Project, scene: EditorialScene): boolean {
  return sceneIsDropped(project, scene)
}

export function removeSceneFromContext(sceneId?: string | null): { toast: string; removed: boolean } {
  const editor = useEditor.getState()
  const scene = sceneId
    ? (editor.project.scenes ?? []).find((row) => row.id === sceneId)
    : sceneRemoveTarget(
        editor.project,
        usePlayback.getState().programTime,
        editor.selectedWordIds,
        editor.selectedSceneId
      )
  if (!scene) return { toast: 'Park on the chapter to drop, then Remove scene.', removed: false }
  if (sceneIsDropped(editor.project, scene)) {
    editor.dispatch({ type: 'restoreRange', start: scene.start, end: scene.end })
    return { toast: 'Put the chapter back.', removed: false }
  }
  const next =
    talkNeighbor(editor.project.scenes ?? [], scene.id, 1) ??
    talkNeighbor(editor.project.scenes ?? [], scene.id, -1)
  const toast = describeSceneRemove(scene, next && next.id !== scene.id ? next : undefined)
  editor.dispatch({ type: 'deleteRange', start: scene.start, end: scene.end, source: 'transcript' })
  if (next && next.id !== scene.id) {
    editor.selectScene(next.id)
    const project = useEditor.getState().project
    const still = (project.scenes ?? []).find((row) => row.id === next.id)
    if (still) {
      usePlayback.getState().playLoop(sourceToProgramOf(project, still.start), sourceToProgramOf(project, still.end))
    }
  }
  return { toast, removed: true }
}
