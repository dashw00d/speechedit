import type { Project } from '../types'
import { hasOpeningTitle, TITLE_DURATION } from './title'
import { hasSceneLowerThirds } from './captions'
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
  if (clip.text === 'ZOOM') return false
  return clip.style?.position === 'lower'
}

export function hasLowerThird(project: Project): boolean {
  return project.tracks.some(
    (track) => track.type === 'overlay' && track.clips.some((clip) => isLowerThirdCard(clip))
  )
}

export type LowerThirdAt = 'after-title' | 'playhead'

export interface LowerThirdPlacement {
  start: number
  duration: number
  at: LowerThirdAt
}

/** First name sits after an opening title, or on the playhead. Another follows the playhead. */
export function lowerThirdPlacement(project: Project, programTime: number): LowerThirdPlacement {
  const titleEnd = hasOpeningTitle(project) ? TITLE_DURATION : 0
  if (!hasLowerThird(project) && titleEnd > 0 && programTime < titleEnd + 0.2) {
    return { start: titleEnd, duration: LOWER_THIRD_DURATION, at: 'after-title' }
  }
  return { start: Math.max(programTime, titleEnd), duration: LOWER_THIRD_DURATION, at: 'playhead' }
}

export function describeLowerThird(placement: LowerThirdPlacement): string {
  if (placement.at === 'after-title') {
    return 'Name on screen after the title — 3 seconds. Type in the inspector.'
  }
  return 'Name on screen — 3 seconds from here. Type in the inspector.'
}

export function applyLowerThirdFromContext(): { toast: string; placement: LowerThirdPlacement } {
  const editor = useEditor.getState()
  const placement = lowerThirdPlacement(editor.project, usePlayback.getState().programTime)
  editor.dispatch({
    type: 'addTitle',
    start: placement.start,
    duration: placement.duration,
    text: LOWER_THIRD_PLACEHOLDER,
    preset: 'lower-third'
  })
  return { toast: describeLowerThird(placement), placement }
}

export function addSceneLowerThirdsFromContext(): { toast: string; added: boolean } {
  const editor = useEditor.getState()
  const chapters = (editor.project.scenes ?? []).filter((scene) => scene.kind !== 'retake')
  if (chapters.length < 2) return { toast: 'Need more than one chapter first.', added: false }
  if (hasSceneLowerThirds(editor.project)) return { toast: 'Chapter names are already on the tape.', added: false }
  editor.dispatch({ type: 'addLowerThirds' })
  const next = useEditor.getState()
  const head = usePlayback.getState().programTime
  const cards = next.project.tracks
    .filter((track) => track.type === 'overlay')
    .flatMap((track) => track.clips)
    .filter((clip) => clip.text)
  const near = cards.slice().sort((a, b) => Math.abs(a.start - head) - Math.abs(b.start - head))[0]
  if (near) next.selectClip(near.id)
  return {
    toast: 'Chapter names on the tape. Edit any one, then Apply style to all titles.',
    added: true
  }
}
