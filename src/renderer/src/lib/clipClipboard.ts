import { useEditor, usePlayback } from '../store'
import { clipLookOf } from './clipEdit'
import { copyQuoteFromContext } from './quote'

export function resolveSelectedClip() {
  const editor = useEditor.getState()
  const id = editor.selectedClipId
  if (!id) return undefined
  return editor.project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === id)
}

export function copySelectedClip(kind: 'clip' | 'look' = 'clip') {
  const clip = resolveSelectedClip()
  if (!clip) return false
  useEditor.getState().setClipClipboard({ kind, clip, look: clipLookOf(clip) })
  return true
}

export function pasteClipboard(kind?: 'clip' | 'look') {
  const editor = useEditor.getState()
  const board = editor.clipClipboard
  if (!board) return false
  const mode = kind ?? board.kind
  if (mode === 'look') {
    const ids = editor.selectedClipIds.length ? editor.selectedClipIds : editor.selectedClipId ? [editor.selectedClipId] : []
    if (!ids.length) return false
    editor.dispatch({ type: 'applyClipLook', clipIds: ids, look: board.look })
    return true
  }
  if (!board.clip) return false
  editor.dispatch({
    type: 'pasteClip',
    clip: board.clip,
    start: usePlayback.getState().programTime,
    trackId: board.clip.trackId
  })
  return true
}

export function copyWordText() {
  return copyQuoteFromContext().copied
}
