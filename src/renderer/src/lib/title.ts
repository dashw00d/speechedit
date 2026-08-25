import type { Project } from '../types'
import { startPictureTextEdit } from './pictureText'
import { useEditor, usePlayback } from '../store'

export const TITLE_DURATION = 3
export const TITLE_PLACEHOLDER = 'Title'

export function isTitleCard(clip: { text?: string; assetId?: string; start?: number; style?: { position?: string; fontSize?: number } } | undefined): boolean {
  if (!clip?.text || clip.assetId) return false
  if (clip.text === 'ZOOM' || clip.text === 'REDACT') return false
  if (clip.style?.position === 'center' && (clip.style.fontSize ?? 0) >= 56) return true
  return clip.text === TITLE_PLACEHOLDER && (clip.start ?? 0) < 0.35
}

export type TitleAt = 'head' | 'playhead'

export interface TitlePlacement {
  start: number
  duration: number
  at: TitleAt
}

function clipLooksLikeTitle(
  text: string | undefined,
  auto?: boolean,
  assetId?: string,
  position?: string
): boolean {
  if (!text || auto || assetId) return false
  if (text === 'ZOOM' || text === 'REDACT') return false
  if (position === 'lower') return false
  return true
}

/** A card at the head of the reel — not an auto caption or a zoom. */
export function hasOpeningTitle(project: Project): boolean {
  return project.tracks.some((track) =>
    (track.type === 'caption' || track.type === 'overlay') &&
    track.clips.some(
      (clip) =>
        clip.start < 0.35 && clipLooksLikeTitle(clip.text, clip.auto, clip.assetId, clip.style?.position)
    )
  )
}

/** First title lands at 0. Another title follows the playhead. */
export function titlePlacement(project: Project, programTime: number): TitlePlacement {
  if (!hasOpeningTitle(project)) {
    return { start: 0, duration: TITLE_DURATION, at: 'head' }
  }
  return { start: programTime, duration: TITLE_DURATION, at: 'playhead' }
}

export function titleLabel(project: Project): string {
  const name = project.name.replace(/\.[^.]+$/, '').trim()
  if (!name || /^untitled$/i.test(name) || /^studio[- ]demo$/i.test(name)) return TITLE_PLACEHOLDER
  return name
}

export function describeTitle(placement: TitlePlacement): string {
  if (placement.at === 'head') {
    return 'Title at the start — 3 seconds. Type the subject.'
  }
  return 'Title on the tape — 3 seconds from here. Type the subject.'
}

export function applyTitleFromContext(): { toast: string; placement: TitlePlacement } {
  const editor = useEditor.getState()
  const placement = titlePlacement(editor.project, usePlayback.getState().programTime)
  editor.dispatch({
    type: 'addTitle',
    start: placement.start,
    duration: placement.duration,
    text: titleLabel(editor.project),
    preset: 'title'
  })
  const clipId = useEditor.getState().selectedClipId
  usePlayback.getState().seekProgram(placement.start + 0.15)
  startPictureTextEdit(clipId)
  return { toast: describeTitle(placement), placement }
}
