import { captionClipsOf, transcriptReadyForCaptions } from './captions'
import { useEditor } from '../store'

export function generateCaptionsFromContext(): { toast: string; filled: boolean } {
  const editor = useEditor.getState()
  if (!transcriptReadyForCaptions(editor.project)) {
    return { toast: 'Need words first. Open a recording or drop a transcript.', filled: false }
  }
  const before = captionClipsOf(editor.project).length
  editor.dispatch({
    type: 'generateCaptions',
    maxWords: 5,
    speakerPrefix: editor.project.transcript.speakers.length > 1,
    emphasize: true
  })
  const after = captionClipsOf(useEditor.getState().project).length
  return {
    toast:
      after > before
        ? 'Captions from the live words. Titles stayed. Edit any block on the tape.'
        : 'Captions from the live words. Edit any block on the tape.',
    filled: after > 0
  }
}
