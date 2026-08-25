import type { EditorialScene, Project } from '../types'
import { neighborScene } from './sceneChip'
import { sceneRemoveTarget } from './sceneRemove'
import { startSceneRename } from './sceneRename'
import { programToSourceOf, sourceToProgramOf } from './resolver'
import { caretWord } from './transcriptEdit'
import { useEditor, usePlayback } from '../store'

const EDGE = 0.15

export type ChapterSplitPlacement = {
  scene: EditorialScene
  source: number
}

function sceneCovers(scene: EditorialScene, source: number): boolean {
  return source >= scene.start - 0.05 && source <= scene.end + 0.05
}

function insideChapter(scene: EditorialScene, source: number): boolean {
  return source > scene.start + EDGE && source < scene.end - EDGE
}

function sceneAtSource(project: Project, source: number): EditorialScene | undefined {
  return (project.scenes ?? [])
    .filter((scene) => scene.kind !== 'retake')
    .find((scene) => sceneCovers(scene, source))
}

function impliedSceneWordIds(scene: EditorialScene, project: Project): string[] {
  return project.transcript.words
    .filter((word) => word.start >= scene.start && word.end <= scene.end)
    .map((word) => word.id)
}

function wordsAreSceneSelection(selectedWordIds: string[], implied: string[]): boolean {
  if (!implied.length || selectedWordIds.length !== implied.length) return false
  const picked = new Set(selectedWordIds)
  return implied.every((id) => picked.has(id))
}

/** Chapter and cut point from the selected words, playhead, or a named heading. */
export function chapterSplitPlacement(
  project: Project,
  programTime: number,
  selectedWordIds: string[],
  selectedSceneId: string | null
): ChapterSplitPlacement | null {
  const sourcePlayhead = programToSourceOf(project, programTime)
  const named = selectedSceneId
    ? (project.scenes ?? []).find((row) => row.id === selectedSceneId)
    : undefined
  const implied = named ? impliedSceneWordIds(named, project) : []
  const impliedPick = Boolean(named && selectedWordIds.length && wordsAreSceneSelection(selectedWordIds, implied))
  const word = impliedPick ? undefined : caretWord(project.transcript.words, selectedWordIds, sourcePlayhead)
  const sourceWord = word && !word.deleted ? word.start : null
  const source = sourceWord ?? sourcePlayhead
  const scene = sceneAtSource(project, source) ?? (named && sceneCovers(named, source) ? named : undefined)
  if (!scene || !insideChapter(scene, source)) return null
  return { scene, source }
}

export function splitChapterFromContext(sceneId?: string | null): { toast: string; split: boolean } {
  const editor = useEditor.getState()
  const placed = chapterSplitPlacement(
    editor.project,
    usePlayback.getState().programTime,
    editor.selectedWordIds,
    sceneId ?? editor.selectedSceneId
  )
  if (!placed) {
    const hasChapters = (editor.project.scenes ?? []).some((scene) => scene.kind !== 'retake')
    return {
      toast: hasChapters ? 'Park on the line where the next beat starts, then Split.' : 'Need a chapter to split.',
      split: false
    }
  }
  editor.dispatch({ type: 'splitScene', sceneId: placed.scene.id, time: placed.source })
  const next = useEditor.getState().project
  const created = (next.scenes ?? []).find(
    (row) => row.id !== placed.scene.id && Math.abs(row.start - placed.source) < 0.02
  )
  if (created) {
    startSceneRename(created.id)
    usePlayback.getState().seekProgram(sourceToProgramOf(next, created.start) + 0.15)
    usePlayback.getState().pause()
  }
  return { toast: 'Chapter split. Type the new heading.', split: true }
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

/** Chapter under the heading, words, or playhead, plus the talk neighbor to join. */
export function chapterMergeTarget(
  project: Project,
  programTime: number,
  selectedWordIds: string[],
  selectedSceneId: string | null,
  step: -1 | 1
): { scene: EditorialScene; other: EditorialScene } | null {
  const scene = sceneRemoveTarget(project, programTime, selectedWordIds, selectedSceneId)
  if (!scene) return null
  const other = talkNeighbor(project.scenes ?? [], scene.id, step)
  if (!other) return null
  return { scene, other }
}

export function describeChapterMerge(keptTitle: string, otherTitle: string): string {
  return `Joined ${keptTitle} with ${otherTitle}. Hear it, or Copy chapters.`
}

export function mergeChapterFromContext(step: -1 | 1, sceneId?: string | null): { toast: string; merged: boolean } {
  const editor = useEditor.getState()
  const placed = sceneId
    ? (() => {
        const scene = (editor.project.scenes ?? []).find((row) => row.id === sceneId)
        const other = scene ? talkNeighbor(editor.project.scenes ?? [], scene.id, step) : undefined
        return scene && other ? { scene, other } : null
      })()
    : chapterMergeTarget(
        editor.project,
        usePlayback.getState().programTime,
        editor.selectedWordIds,
        editor.selectedSceneId,
        step
      )
  if (!placed) {
    return {
      toast: sceneRemoveTarget(
        editor.project,
        usePlayback.getState().programTime,
        editor.selectedWordIds,
        sceneId ?? editor.selectedSceneId
      )
        ? step < 0
          ? 'Nothing to merge before this chapter.'
          : 'Nothing to merge after this chapter.'
        : 'Park on a chapter, then Merge.',
      merged: false
    }
  }
  editor.dispatch({ type: 'mergeScenes', sceneId: placed.scene.id, otherId: placed.other.id })
  const keptId = placed.other.start < placed.scene.start ? placed.other.id : placed.scene.id
  const dropped = keptId === placed.scene.id ? placed.other : placed.scene
  const keptTitle = keptId === placed.scene.id ? placed.scene.title : placed.other.title
  editor.selectScene(keptId)
  const next = useEditor.getState().project
  const joined = (next.scenes ?? []).find((row) => row.id === keptId)
  if (joined) {
    usePlayback.getState().playLoop(sourceToProgramOf(next, joined.start), sourceToProgramOf(next, joined.end))
  }
  return { toast: describeChapterMerge(keptTitle, dropped.title), merged: true }
}
