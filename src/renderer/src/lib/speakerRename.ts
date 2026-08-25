import type { Project } from '../types'
import { sourceToProgramOf } from './resolver'
import { wordRange } from './transcriptEdit'
import { useEditor, usePlayback } from '../store'

export const RENAME_SPEAKER_EVENT = 'speechedit:rename-speaker'

export function speakersInOrder(project: Project): Project['transcript']['speakers'] {
  return [...project.transcript.speakers]
}

export function nextSpeaker(project: Project, afterId: string): Project['transcript']['speakers'][number] | undefined {
  const rows = speakersInOrder(project)
  const index = rows.findIndex((row) => row.id === afterId)
  if (index < 0) return undefined
  return rows[index + 1]
}

export function describeSpeakerRename(nextName?: string, changed = true): string {
  if (nextName) {
    return changed
      ? `Speaker renamed. “${nextName}” is next — type it.`
      : `“${nextName}” is next — type it.`
  }
  return 'Speaker renamed. Copy notes uses the new name in the paste.'
}

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

export function describeSpeakerAssign(name: string, count: number): string {
  const label = count === 1 ? '1 word is' : `${count} words are`
  return `${label} ${name} now. Copy notes uses that name.`
}

/** Give the selected words to this voice and hear them. */
export function assignSpeakerFromContext(speakerId: string): { toast: string; assigned: boolean } {
  const editor = useEditor.getState()
  const ids = editor.selectedWordIds
  const speaker = editor.project.transcript.speakers.find((row) => row.id === speakerId)
  if (!speaker || !ids.length) {
    return { toast: 'Select the words, then click the speaker.', assigned: false }
  }
  const words = editor.project.transcript.words
  const already = ids.every((id) => words.find((word) => word.id === id)?.speaker === speakerId)
  if (already) return { toast: '', assigned: false }
  editor.dispatch({ type: 'setSpeaker', wordIds: ids, speakerId })
  const span = wordRange(words, ids)
  if (span) {
    const project = useEditor.getState().project
    usePlayback
      .getState()
      .playLoop(sourceToProgramOf(project, span.start), sourceToProgramOf(project, span.end))
  }
  return { toast: describeSpeakerAssign(speaker.name, ids.length), assigned: true }
}

export function toastForSpeakerRename(before: string, after: string, nextName?: string): string | null {
  const name = after.trim()
  const changed = Boolean(name && name !== before.trim())
  if (!changed && !nextName) return null
  return describeSpeakerRename(nextName, changed)
}

/** Drop a speaker. Their words move to the first remaining voice. */
export function removeSpeakerFromContext(speakerId?: string | null): { toast: string; removed: boolean } {
  const editor = useEditor.getState()
  const speakers = editor.project.transcript.speakers
  const words = editor.project.transcript.words
  const id =
    speakerId ??
    speakerIdFromSelection(editor.selectedWordIds, words, speakers)
  if (!id || !speakers.some((row) => row.id === id)) {
    return { toast: 'Select a speaker, then Remove.', removed: false }
  }
  if (speakers.length <= 1) {
    return { toast: 'Keep at least one speaker.', removed: false }
  }
  const gone = speakers.find((row) => row.id === id)!
  const keep = speakers.find((row) => row.id !== id)!
  const owned = words.some((word) => word.speaker === id)
  editor.dispatch({ type: 'removeSpeaker', speakerId: id })
  return {
    toast: owned
      ? `Removed ${gone.name}. Those words are ${keep.name} now.`
      : `Removed ${gone.name}.`,
    removed: true
  }
}

export function speakerContextActions(
  speakers: { id: string; name: string }[],
  speakerId: string
): Array<{ id: 'rename' | 'remove'; label: string; hint: string; disabled?: boolean }> {
  const speaker = speakers.find((row) => row.id === speakerId)
  if (!speaker) return []
  const last = speakers.length <= 1
  const keep = speakers.find((row) => row.id !== speakerId)
  return [
    {
      id: 'rename',
      label: 'Rename',
      hint: 'Change the name used in the transcript export'
    },
    {
      id: 'remove',
      label: 'Remove',
      hint: last
        ? 'Keep at least one speaker.'
        : keep
          ? `Their words go to ${keep.name}.`
          : 'Remove this speaker.',
      ...(last ? { disabled: true as const } : {})
    }
  ]
}
