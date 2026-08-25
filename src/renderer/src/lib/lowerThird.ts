import type { EditorialScene, Project } from '../types'
import { hasOpeningTitle, TITLE_DURATION } from './title'
import { hasSceneLowerThirds, lowerThirdClips } from './captions'
import { startPictureTextEdit } from './pictureText'
import { caretWord, wordRange } from './transcriptEdit'
import { programToSourceOf, sourceToProgramOf } from './resolver'
import { useEditor, usePlayback } from '../store'

export const LOWER_THIRD_DURATION = 3
export const LOWER_THIRD_PLACEHOLDER = 'Name'

export function isLowerThirdCard(
  clip:
    | {
        text?: string
        assetId?: string
        style?: { position?: string; fontSize?: number }
      }
    | undefined
): boolean {
  if (!clip?.text || clip.assetId) return false
  if (clip.text === 'ZOOM' || clip.text === 'REDACT') return false
  return clip.style?.position === 'lower'
}

export function hasLowerThird(project: Project): boolean {
  return project.tracks.some(
    (track) => track.type === 'overlay' && track.clips.some((clip) => isLowerThirdCard(clip))
  )
}

export type LowerThirdAt = 'after-title' | 'playhead' | 'words' | 'scene'

export interface LowerThirdPlacement {
  start: number
  duration: number
  at: LowerThirdAt
}

function impliedSceneWordIds(project: Project, scene: EditorialScene): string[] {
  return project.transcript.words
    .filter((word) => word.start >= scene.start && word.end <= scene.end)
    .map((word) => word.id)
}

function wordsAreSceneSelection(selectedWordIds: string[], implied: string[]): boolean {
  if (!implied.length || selectedWordIds.length !== implied.length) return false
  const picked = new Set(selectedWordIds)
  return implied.every((id) => picked.has(id))
}

function sceneSpan(project: Project, scene: EditorialScene): LowerThirdPlacement {
  const start = sourceToProgramOf(project, scene.start)
  const end = sourceToProgramOf(project, scene.end)
  return { start, duration: Math.max(1.2, end - start), at: 'scene' }
}

/** Speaker on these words or at the playhead — not “Speaker 1”. */
export function nameForLowerThird(
  project: Project,
  programTime: number,
  selectedWordIds: string[]
): string {
  const word = caretWord(project.transcript.words, selectedWordIds, programToSourceOf(project, programTime))
  const name = project.transcript.speakers.find((row) => row.id === word?.speaker)?.name?.trim()
  if (name && !/^speaker\s*\d*$/i.test(name)) return name
  return LOWER_THIRD_PLACEHOLDER
}

/**
 * Words the user picked, then a chapter, then after an opening title,
 * then 3s at the playhead.
 */
export function lowerThirdPlacement(
  project: Project,
  programTime: number,
  selectedWordIds: string[] = [],
  selectedSceneId: string | null = null
): LowerThirdPlacement {
  const selectedScene = selectedSceneId
    ? (project.scenes ?? []).find((row) => row.id === selectedSceneId)
    : undefined
  const words = wordRange(project.transcript.words, selectedWordIds)
  const implied = selectedScene ? impliedSceneWordIds(project, selectedScene) : []
  const impliedPick = Boolean(selectedScene && wordsAreSceneSelection(selectedWordIds, implied))

  if (words && !impliedPick) {
    const start = sourceToProgramOf(project, words.start)
    const end = sourceToProgramOf(project, words.end)
    return { start, duration: Math.max(1.2, end - start), at: 'words' }
  }
  if (selectedScene && selectedScene.kind !== 'retake') {
    return sceneSpan(project, selectedScene)
  }

  const titleEnd = hasOpeningTitle(project) ? TITLE_DURATION : 0
  if (!hasLowerThird(project) && titleEnd > 0 && programTime < titleEnd + 0.2) {
    return { start: titleEnd, duration: LOWER_THIRD_DURATION, at: 'after-title' }
  }
  return { start: Math.max(programTime, titleEnd), duration: LOWER_THIRD_DURATION, at: 'playhead' }
}

export function describeLowerThird(placement: LowerThirdPlacement, name = LOWER_THIRD_PLACEHOLDER): string {
  const who = name !== LOWER_THIRD_PLACEHOLDER ? ` “${name}”` : ''
  const fill = 'Type it, then Fill.'
  if (placement.at === 'words') {
    return `Name${who} on these words — ${placement.duration.toFixed(1)} seconds. ${fill}`
  }
  if (placement.at === 'scene') {
    return `Name${who} on this chapter — ${placement.duration.toFixed(1)} seconds. ${fill}`
  }
  if (placement.at === 'after-title') {
    return `Name${who} after the title — 3 seconds. ${fill}`
  }
  return `Name${who} on screen — 3 seconds from here. ${fill}`
}

export function applyLowerThirdFromContext(): { toast: string; placement: LowerThirdPlacement } {
  const editor = useEditor.getState()
  const programTime = usePlayback.getState().programTime
  const placement = lowerThirdPlacement(
    editor.project,
    programTime,
    editor.selectedWordIds,
    editor.selectedSceneId
  )
  const name = nameForLowerThird(editor.project, programTime, editor.selectedWordIds)
  editor.dispatch({
    type: 'addTitle',
    start: placement.start,
    duration: placement.duration,
    text: name,
    preset: 'lower-third'
  })
  const clipId = useEditor.getState().selectedClipId
  usePlayback.getState().seekProgram(placement.start + Math.min(0.15, placement.duration / 2))
  startPictureTextEdit(clipId)
  return { toast: describeLowerThird(placement, name), placement }
}

/** First chapter name on the tape — not a retake, not whichever card is nearest the playhead. */
export function firstChapterNameCard(project: Project) {
  const wanted = lowerThirdClips(project)[0]
  if (!wanted) return undefined
  const overlay = project.tracks.find((track) => track.type === 'overlay')?.clips ?? []
  return (
    overlay.find((clip) => clip.text === wanted.text) ??
    overlay.find((clip) => isLowerThirdCard(clip))
  )
}

export function addSceneLowerThirdsFromContext(): { toast: string; added: boolean } {
  const editor = useEditor.getState()
  const chapters = (editor.project.scenes ?? []).filter((scene) => scene.kind !== 'retake')
  if (chapters.length < 2) return { toast: 'Need more than one chapter first.', added: false }
  if (hasSceneLowerThirds(editor.project)) return { toast: 'Chapter names are already on the tape.', added: false }
  editor.dispatch({ type: 'addLowerThirds' })
  const next = useEditor.getState()
  const first = firstChapterNameCard(next.project)
  if (first) {
    usePlayback.getState().seekProgram(first.start + Math.min(0.2, first.duration / 2))
    startPictureTextEdit(first.id)
  }
  return {
    toast: first
      ? 'Type this name — Enter keeps it and opens the next. Fill is on the tape.'
      : 'Chapter names on the tape.',
    added: true
  }
}
