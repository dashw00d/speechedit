import type { EditorialScene, Project } from '../types'
import { neighborScene } from './sceneChip'
import { sourceToProgramOf } from './resolver'
import { useEditor, usePlayback } from '../store'

export function sceneForSpan(project: Project, start: number, end: number): EditorialScene | undefined {
  return (project.scenes ?? []).find(
    (scene) => Math.abs(scene.start - start) < 0.08 && Math.abs(scene.end - end) < 0.08
  )
}

export function describeSceneRemove(scene: EditorialScene): string {
  return scene.kind === 'demo'
    ? 'Removed the walkthrough. Undo to put it back.'
    : 'Removed the chapter. Undo to put it back.'
}

function sceneIsDropped(project: Project, scene: EditorialScene): boolean {
  const spoken = project.transcript.words.filter((word) => word.start >= scene.start && word.end <= scene.end)
  return spoken.length > 0 && spoken.every((word) => word.deleted)
}

export function removeSceneFromContext(sceneId?: string | null): { toast: string; removed: boolean } {
  const editor = useEditor.getState()
  const id = sceneId ?? editor.selectedSceneId
  const scene = (editor.project.scenes ?? []).find((row) => row.id === id)
  if (!scene) return { toast: 'Select a chapter, then Remove.', removed: false }
  if (sceneIsDropped(editor.project, scene)) {
    editor.dispatch({ type: 'restoreRange', start: scene.start, end: scene.end })
    return { toast: 'Put the chapter back.', removed: false }
  }
  const next = neighborScene(editor.project.scenes ?? [], scene.id, 1) ?? neighborScene(editor.project.scenes ?? [], scene.id, -1)
  const toast = describeSceneRemove(scene)
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
