import type { EditorialScene, Project } from '../types'
import { useEditor } from '../store'

export const RENAME_SCENE_EVENT = 'speechedit:rename-scene'

/** Talk/demo headings in timeline order — retakes stay out of the walk. */
export function talkChapters(project: Project): EditorialScene[] {
  return [...(project.scenes ?? [])]
    .filter((scene) => scene.kind !== 'retake')
    .sort((a, b) => a.start - b.start)
}

export function nextTalkChapter(project: Project, afterId: string): EditorialScene | undefined {
  const chapters = talkChapters(project)
  const index = chapters.findIndex((scene) => scene.id === afterId)
  if (index < 0) return undefined
  return chapters[index + 1]
}

export function describeChapterRename(nextTitle?: string, changed = true): string {
  if (nextTitle) {
    return changed
      ? `Chapter renamed. “${nextTitle}” is next — type it.`
      : `“${nextTitle}” is next — type it.`
  }
  return 'Chapter renamed. Copy chapters pastes YouTube timestamps.'
}

/** Open the heading field. F2 / Rename chip / palette. */
export function startSceneRename(sceneId?: string | null): { started: boolean } {
  const id = sceneId ?? useEditor.getState().selectedSceneId
  if (!id) return { started: false }
  useEditor.getState().selectScene(id)
  if (typeof window !== 'undefined') {
    const fire = () => window.dispatchEvent(new CustomEvent(RENAME_SCENE_EVENT, { detail: { sceneId: id } }))
    window.setTimeout(fire, 0)
  }
  return { started: true }
}

export function toastForSceneRename(before: string, after: string, nextTitle?: string): string | null {
  const title = after.trim()
  const changed = Boolean(title && title !== before.trim())
  if (!changed && !nextTitle) return null
  return describeChapterRename(nextTitle, changed)
}
