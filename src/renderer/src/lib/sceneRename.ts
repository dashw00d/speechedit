import { useEditor } from '../store'

export const RENAME_SCENE_EVENT = 'speechedit:rename-scene'

/** Open the heading field. F2 / Rename chip / palette. */
export function startSceneRename(sceneId?: string | null): { started: boolean } {
  const id = sceneId ?? useEditor.getState().selectedSceneId
  if (!id) return { started: false }
  useEditor.getState().selectScene(id)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(RENAME_SCENE_EVENT, { detail: { sceneId: id } }))
  }
  return { started: true }
}

export function toastForSceneRename(before: string, after: string): string | null {
  const title = after.trim()
  if (!title || title === before.trim()) return null
  return 'Chapter renamed. Export → Chapters copies YouTube timestamps.'
}
