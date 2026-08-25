import { captionClipsOf, transcriptReadyForCaptions } from './captions'
import { useEditor, usePlayback } from '../store'

export function generateCaptionsFromContext(): { toast: string; filled: boolean } {
  const editor = useEditor.getState()
  if (!transcriptReadyForCaptions(editor.project)) {
    return { toast: 'Need words first. Open a recording or drop a transcript.', filled: false }
  }
  const beforeClips = captionClipsOf(editor.project)
  editor.dispatch({
    type: 'generateCaptions',
    maxWords: 5,
    speakerPrefix: editor.project.transcript.speakers.length > 1,
    emphasize: true
  })
  const next = useEditor.getState()
  const afterClips = captionClipsOf(next.project)
  const beforeIds = new Set(beforeClips.map((clip) => clip.id))
  const first =
    afterClips.find((clip) => !beforeIds.has(clip.id)) ??
    afterClips.find((clip) => clip.auto) ??
    afterClips[0]
  if (first) {
    useEditor.getState().clearSelection()
    usePlayback.getState().seekProgram(first.start + Math.min(0.2, first.duration / 2))
  }
  const added = afterClips.length > beforeClips.length
  return {
    toast: first
      ? added
        ? 'Captions from the live words. Titles stayed. The first block is on the picture.'
        : 'Captions from the live words. This block is on the picture.'
      : 'Captions from the live words. Edit any block on the tape.',
    filled: afterClips.length > 0
  }
}
