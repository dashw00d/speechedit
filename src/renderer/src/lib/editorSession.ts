import { EMPTY_SESSION, type EditorSession } from './agentContext'
import { useEditor, usePlayback } from '../store'

export function currentEditorSession(): EditorSession {
  if (typeof window === 'undefined') return EMPTY_SESSION
  const editor = useEditor.getState()
  const playback = usePlayback.getState()
  return {
    selectedWordIds: editor.selectedWordIds,
    selectedClipId: editor.selectedClipId,
    selectedSuggestionId: editor.selectedSuggestionId,
    programTime: playback.programTime
  }
}
