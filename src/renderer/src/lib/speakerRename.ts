import { useEditor } from '../store'

export const RENAME_SPEAKER_EVENT = 'speechedit:rename-speaker'

export function speakerIdFromSelection(
  selectedWordIds: string[],
  words: { id: string; speaker?: string }[],
  speakers: { id: string }[]
): string | null {
  const picked = words.filter((word) => selectedWordIds.includes(word.id))
  const ids = [...new Set(picked.map((word) => word.speaker).filter((id): id is string => Boolean(id)))]
  if (ids.length === 1) return ids[0]
  if (!picked.length && speakers.length === 1) return speakers[0]!.id
  return null
}

/** Open the speaker field. F2 / Rename chip / palette. */
export function startSpeakerRename(speakerId?: string | null): { started: boolean } {
  const editor = useEditor.getState()
  const speakers = editor.project.transcript.speakers
  const id =
    speakerId ??
    speakerIdFromSelection(editor.selectedWordIds, editor.project.transcript.words, speakers)
  if (!id || !speakers.some((row) => row.id === id)) return { started: false }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(RENAME_SPEAKER_EVENT, { detail: { speakerId: id } }))
  }
  return { started: true }
}

export function toastForSpeakerRename(before: string, after: string): string | null {
  const name = after.trim()
  if (!name || name === before.trim()) return null
  return 'Speaker renamed. Copy notes uses the new name.'
}
