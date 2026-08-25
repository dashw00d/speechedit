import { currentWord } from './edl'
import { coveringNote, isTapeNote } from './clipEdit'
import { programToSourceOf } from './resolver'
import { wordRange } from './transcriptEdit'
import { useEditor, usePlayback } from '../store'
import type { EditorialScene, Project } from '../types'

export const EDIT_NOTE_EVENT = 'speechedit:edit-note'
export const NOTE_TYPE_TOAST = 'Type the note — hook, ask, or why you parked.'
export const NOTE_SAVED_TOAST = 'Note saved. N hops back here, or Copy notes pastes it as a quote.'

function noteIntent(label: string): 'hook' | 'ask' | 'cta' | 'note' {
  const text = label.trim().toLowerCase()
  if (text === 'hook' || text.startsWith('hook ') || text.startsWith('hook:') || text.startsWith('hook —')) {
    return 'hook'
  }
  if (text === 'cta' || text.startsWith('cta ') || text.startsWith('cta:')) return 'cta'
  if (text === 'ask' || text === 'question' || text.startsWith('ask ') || text.startsWith('ask:')) return 'ask'
  return 'note'
}

export function describeNoteSaved(label: string): string | null {
  const text = label.trim()
  if (!text || /^Note$/i.test(text)) return null
  const hop = 'N hops back here'
  if (noteIntent(text) === 'hook') return `Hook marked. ${hop}, or Mark clip.`
  if (noteIntent(text) === 'ask') return `Ask marked. ${hop}, or Copy notes.`
  if (noteIntent(text) === 'cta') return `CTA marked. ${hop}, or Copy notes.`
  return NOTE_SAVED_TOAST
}

/** After N lands on a mark. */
export function describeNoteHop(label: string | undefined, count: number): string {
  const name = label?.trim() || 'Note'
  if (count > 1) return `${name}. N is the next mark.`
  return `${name}. Mark clip if it should ship.`
}

function wordsAreSceneSelection(selectedWordIds: string[], implied: string[]): boolean {
  if (!implied.length || selectedWordIds.length !== implied.length) return false
  const picked = new Set(selectedWordIds)
  return implied.every((id) => picked.has(id))
}

function wordsInScene(project: Project, scene: EditorialScene): string[] {
  return project.transcript.words
    .filter((word) => word.start >= scene.start && word.end <= scene.end)
    .map((word) => word.id)
}

/** Words they painted, else the playhead word — not the implied full-chapter highlight. */
export function noteSpan(
  project: Project,
  programTime: number,
  selectedWordIds: string[],
  selectedSceneId: string | null
): { start: number; end: number } {
  const words = project.transcript.words
  const selected = wordRange(words, selectedWordIds)
  const scene = selectedSceneId
    ? (project.scenes ?? []).find((row) => row.id === selectedSceneId)
    : undefined
  const implied = scene ? wordsInScene(project, scene) : []
  const impliedPick = Boolean(scene && selectedWordIds.length && wordsAreSceneSelection(selectedWordIds, implied))
  if (selected && !impliedPick) return { start: selected.start, end: selected.end }
  const source = programToSourceOf(project, programTime)
  const word = currentWord(words, source)
  if (scene && word && (word.start < scene.start - 0.05 || word.start >= scene.end)) {
    const first = words.find((row) => !row.deleted && row.start >= scene.start && row.end <= scene.end)
    if (first) return { start: first.start, end: first.end }
    return { start: scene.start, end: Math.min(scene.start + 1, scene.end) }
  }
  if (scene && !word) {
    const next = words.find(
      (row) => !row.deleted && row.start >= source && row.start < scene.end && row.end <= scene.end
    )
    if (next) return { start: next.start, end: next.end }
    const prev = [...words]
      .reverse()
      .find((row) => !row.deleted && row.end <= source && row.start >= scene.start)
    if (prev) return { start: prev.start, end: prev.end }
    const first = words.find((row) => !row.deleted && row.start >= scene.start && row.end <= scene.end)
    if (first) return { start: first.start, end: first.end }
    return { start: scene.start, end: Math.min(scene.start + 1, scene.end) }
  }
  return { start: word?.start ?? source, end: word?.end ?? source + 1 }
}

export function startNoteEdit(tagId?: string | null): { started: boolean } {
  const editor = useEditor.getState()
  const source = programToSourceOf(editor.project, usePlayback.getState().programTime)
  const id =
    tagId ??
    coveringNote(editor.project, source, source)?.id ??
    editor.project.tags.find((tag) => isTapeNote(tag.kind))?.id
  if (!id || !editor.project.tags.some((tag) => tag.id === id && isTapeNote(tag.kind))) {
    return { started: false }
  }
  if (typeof window !== 'undefined') {
    const fire = () => window.dispatchEvent(new CustomEvent(EDIT_NOTE_EVENT, { detail: { tagId: id } }))
    window.setTimeout(fire, 0)
  }
  return { started: true }
}

function selectNoteWords(start: number, end: number) {
  const editor = useEditor.getState()
  const ids = editor.project.transcript.words
    .filter((word) => word.start >= start - 0.02 && word.end <= end + 0.02)
    .map((word) => word.id)
  if (ids.length) editor.selectWords(ids)
}

/** Drop a note on the selection or playhead, then type it. */
export function addNoteFromContext(): { toast: string; tagId: string | null } {
  const editor = useEditor.getState()
  const project = editor.project
  const { start, end } = noteSpan(
    project,
    usePlayback.getState().programTime,
    editor.selectedWordIds,
    editor.selectedSceneId
  )
  const existing = coveringNote(project, start, end)
  if (existing) {
    selectNoteWords(existing.start, existing.end)
    startNoteEdit(existing.id)
    return { toast: NOTE_TYPE_TOAST, tagId: existing.id }
  }
  editor.dispatch({ type: 'addTag', start, end, kind: 'note', label: 'Note' })
  const note = coveringNote(useEditor.getState().project, start, end)
  if (!note) return { toast: 'Park on a word, then Note.', tagId: null }
  selectNoteWords(note.start, note.end)
  startNoteEdit(note.id)
  return { toast: NOTE_TYPE_TOAST, tagId: note.id }
}

export function removeNoteFromContext(tagId?: string | null): { toast: string; removed: boolean } {
  const editor = useEditor.getState()
  const source = programToSourceOf(editor.project, usePlayback.getState().programTime)
  const note =
    editor.project.tags.find((tag) => tag.id === tagId && isTapeNote(tag.kind)) ??
    coveringNote(editor.project, source, source)
  if (!note) return { toast: 'Right-click a note, then Remove.', removed: false }
  editor.dispatch({ type: 'removeTag', tagId: note.id })
  return { toast: 'Note removed.', removed: true }
}

export function noteContextActions(): Array<{ id: 'type' | 'remove'; label: string; hint: string }> {
  return [
    { id: 'type', label: 'Type…', hint: 'Hook, ask, or why you parked' },
    { id: 'remove', label: 'Remove', hint: 'Take the note off the tape' }
  ]
}
