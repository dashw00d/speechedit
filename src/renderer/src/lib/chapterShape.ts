import { neighborScene } from './sceneChip'
import { startSceneRename } from './sceneRename'
import { programToSourceOf } from './resolver'
import { caretWord } from './transcriptEdit'
import { useEditor, usePlayback } from '../store'

const EDGE = 0.15

export function splitChapterFromContext(sceneId?: string | null): { toast: string; split: boolean } {
  const editor = useEditor.getState()
  const id = sceneId ?? editor.selectedSceneId
  const scene = (editor.project.scenes ?? []).find((row) => row.id === id)
  if (!scene) return { toast: 'Select a chapter, then Split.', split: false }
  const playback = usePlayback.getState()
  let source = programToSourceOf(editor.project, playback.programTime)
  if (source <= scene.start + EDGE || source >= scene.end - EDGE) {
    const words = editor.project.transcript.words
    const picked = words.filter((w) => editor.selectedWordIds.includes(w.id))
    const wholeChapter =
      picked.length > 1 &&
      picked[0]!.start <= scene.start + EDGE &&
      picked[picked.length - 1]!.end >= scene.end - EDGE
    const word = wholeChapter ? undefined : caretWord(words, editor.selectedWordIds, source)
    if (word && word.start > scene.start + EDGE && word.start < scene.end - EDGE) {
      source = word.start
    } else {
      return { toast: 'Park inside this chapter, then Split.', split: false }
    }
  }
  editor.dispatch({ type: 'splitScene', sceneId: scene.id, time: source })
  const created = (useEditor.getState().project.scenes ?? []).find(
    (row) => row.id !== scene.id && Math.abs(row.start - source) < 0.02
  )
  if (created) startSceneRename(created.id)
  return { toast: 'Chapter split. Type the new heading.', split: true }
}

export function mergeChapterFromContext(step: -1 | 1, sceneId?: string | null): { toast: string; merged: boolean } {
  const editor = useEditor.getState()
  const id = sceneId ?? editor.selectedSceneId
  const scene = (editor.project.scenes ?? []).find((row) => row.id === id)
  if (!scene) return { toast: 'Select a chapter, then Merge.', merged: false }
  const other = neighborScene(editor.project.scenes ?? [], scene.id, step)
  if (!other) return { toast: step < 0 ? 'Nothing to merge before this chapter.' : 'Nothing to merge after this chapter.', merged: false }
  editor.dispatch({ type: 'mergeScenes', sceneId: scene.id, otherId: other.id })
  const kept = other.start < scene.start ? other.id : scene.id
  editor.selectScene(kept)
  return { toast: 'Chapters joined. Export → Chapters copies the new timestamps.', merged: true }
}
