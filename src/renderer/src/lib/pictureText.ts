import type { Clip, Project } from '../types'
import { useEditor, usePlayback } from '../store'
import { textClipsOf } from './captionStyle'

export const EDIT_PICTURE_TEXT_EVENT = 'speechedit:edit-picture-text'

const TITLE_PLACEHOLDER = 'Title'
const NAME_PLACEHOLDER = 'Name'

export function pictureTextClip(clipId?: string | null) {
  const id = clipId ?? useEditor.getState().selectedClipId
  if (!id) return undefined
  return useEditor
    .getState()
    .project.tracks.flatMap((track) => track.clips)
    .find((clip) => clip.id === id && clip.text && !clip.assetId)
}

export function pictureTextDraft(text: string): string {
  if (text === TITLE_PLACEHOLDER || text === NAME_PLACEHOLDER) return ''
  if (text.includes('\n')) return text.split('\n')[0] ?? ''
  return text
}

export function pictureTextPlaceholder(clip: {
  text?: string
  style?: { position?: string; fontSize?: number }
}): string {
  if (clip.style?.position === 'center' || clip.text === TITLE_PLACEHOLDER) return 'Type the subject'
  if (clip.style?.position === 'lower' || clip.text === NAME_PLACEHOLDER) return 'Type the name'
  return 'Type the line'
}

function isCenterTitle(clip: { text?: string; style?: { position?: string; fontSize?: number } }): boolean {
  return clip.style?.position === 'center' || ((clip.style?.fontSize ?? 0) >= 56 && clip.text === TITLE_PLACEHOLDER)
}

function cardLabel(text: string | undefined): string {
  return text?.split(/\n/)[0]?.trim() || ''
}

/** Handmade names on overlay — not captions, not zoom/redact. */
export function chapterNameCards(project: Project): Clip[] {
  const overlayIds = new Set(project.tracks.filter((track) => track.type === 'overlay').map((track) => track.id))
  return project.tracks
    .flatMap((track) => track.clips)
    .filter(
      (clip) =>
        overlayIds.has(clip.trackId) &&
        !clip.auto &&
        Boolean(clip.text) &&
        !clip.assetId &&
        clip.style?.position === 'lower' &&
        clip.text !== 'ZOOM' &&
        clip.text !== 'REDACT'
    )
    .sort((a, b) => a.start - b.start)
}

export function nextChapterNameCard(project: Project, afterId: string): Clip | undefined {
  const cards = chapterNameCards(project)
  if (cards.length < 2) return undefined
  const index = cards.findIndex((clip) => clip.id === afterId)
  if (index < 0) return undefined
  return cards[index + 1]
}

export function describeChapterNameAdvance(nextText: string, changed: boolean): string {
  const label = cardLabel(nextText)
  const named = label && label !== NAME_PLACEHOLDER ? `“${label}”` : 'the next chapter'
  if (changed) return `Name on the picture. ${named} is next — type it.`
  return `${named} is next — type it.`
}

/** Open the field on the picture. Delayed so a menu click does not steal focus. */
export function startPictureTextEdit(clipId?: string | null): { started: boolean; clipId: string | null } {
  const clip = pictureTextClip(clipId)
  if (!clip) return { started: false, clipId: null }
  const playback = usePlayback.getState()
  const head = playback.programTime
  if (head < clip.start || head >= clip.start + clip.duration) {
    playback.seekProgram(clip.start + Math.min(0.2, clip.duration / 2))
  } else {
    playback.pause()
  }
  if (typeof window !== 'undefined') {
    const fire = () =>
      window.dispatchEvent(new CustomEvent(EDIT_PICTURE_TEXT_EVENT, { detail: { clipId: clip.id } }))
    window.setTimeout(fire, 0)
  }
  return { started: true, clipId: clip.id }
}

export function commitPictureText(
  clipId: string,
  draft: string
): { toast: string | null; nextClipId: string | null } {
  const editor = useEditor.getState()
  const clip = pictureTextClip(clipId)
  if (!clip) return { toast: null, nextClipId: null }
  const current = clip.text ?? ''
  const trimmed = draft.replace(/\s+/g, ' ').trim()
  const fallback =
    clip.style?.position === 'lower' || current === NAME_PLACEHOLDER
      ? NAME_PLACEHOLDER
      : isCenterTitle(clip) || current === TITLE_PLACEHOLDER
        ? TITLE_PLACEHOLDER
        : current || TITLE_PLACEHOLDER
  const heading = cardLabel(current)
  const rest = current.includes('\n') ? current.split('\n').slice(1).join('\n') : ''
  const next = !trimmed
    ? fallback
    : rest && (trimmed === heading || trimmed === current.replace(/\s+/g, ' ').trim())
      ? current
      : rest
        ? `${trimmed}\n${rest}`
        : trimmed
  const changed = next !== current
  if (changed) editor.dispatch({ type: 'setText', clipId: clip.id, text: next })

  const project = useEditor.getState().project
  const nextCard = nextChapterNameCard(project, clip.id)
  if (nextCard) {
    editor.selectClip(nextCard.id)
    return { toast: describeChapterNameAdvance(nextCard.text ?? '', changed), nextClipId: nextCard.id }
  }

  editor.selectClip(clip.id)
  const more = textClipsOf(project).some((row) => row.id !== clip.id)
  const follow = more ? ' Change fill here, then Apply style.' : ''
  if (!changed) {
    return { toast: more ? follow.trim() : null, nextClipId: null }
  }
  if (isCenterTitle({ ...clip, text: next }) || clip.style?.position === 'center') {
    return { toast: next === TITLE_PLACEHOLDER ? null : `Title on the picture.${follow}`, nextClipId: null }
  }
  if (clip.style?.position === 'lower' || clip.text === NAME_PLACEHOLDER) {
    return { toast: next === NAME_PLACEHOLDER ? null : `Name on the picture.${follow}`, nextClipId: null }
  }
  return { toast: `Caption on the picture.${follow}`, nextClipId: null }
}
