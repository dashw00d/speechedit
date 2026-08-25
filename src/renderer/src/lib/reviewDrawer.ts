import { leftoverItems, leftoverKind } from './analysis'
import { retakeReviewQueue, takeFamily } from './sceneAnalysis'
import type { EditorialScene, Project } from '../types'

export type ReviewJob = 'leftover' | 'retake' | 'breath' | 'pending' | 'applied' | 'empty'

export function leftoverReviewItems(project: Project) {
  return {
    activities: leftoverItems(project, 'activity'),
    stills: leftoverItems(project, 'still'),
    statics: leftoverItems(project, 'static'),
    hots: leftoverItems(project, 'loud'),
    breaths: leftoverItems(project, 'breath')
  }
}

export function leftoverReviewCount(project: Project): number {
  const { activities, stills, statics, hots } = leftoverReviewItems(project)
  return activities.length + stills.length + statics.length + hots.length
}

export function reviewDecisionScenes(project: Project): EditorialScene[] {
  const scenes = project.scenes ?? []
  const keep = new Set<string>()
  for (const scene of retakeReviewQueue(project)) {
    for (const member of takeFamily(scenes, scene.id)) keep.add(member.id)
  }
  return scenes.filter((scene) => keep.has(scene.id))
}

export function reviewOtherPending(project: Project) {
  return project.suggestions.filter((suggestion) => {
    if (suggestion.applied) return false
    const kind = leftoverKind(suggestion)
    return kind !== 'activity' && kind !== 'still' && kind !== 'breath' && kind !== 'static' && kind !== 'loud'
  })
}

export function reviewJob(project: Project): ReviewJob {
  if (leftoverReviewCount(project) > 0) return 'leftover'
  if (retakeReviewQueue(project).length > 0) return 'retake'
  if (leftoverReviewItems(project).breaths.length > 0) return 'breath'
  if (reviewOtherPending(project).length > 0) return 'pending'
  if (project.suggestions.some((suggestion) => suggestion.applied)) return 'applied'
  return 'empty'
}

export function reviewDrawerCopy(project: Project): { kicker: string; detail: string } {
  const job = reviewJob(project)
  if (job === 'leftover') {
    const n = leftoverReviewCount(project)
    return {
      kicker: 'Leftover',
      detail: `${n} need a listen. Hear, then Silent demo, Speed, Cut, or Keep.`
    }
  }
  if (job === 'retake') {
    const n = retakeReviewQueue(project).length
    return {
      kicker: 'Retake',
      detail: n === 1 ? 'Hear this one, then Use later take or Put back.' : `${n} takes. Hear one, then pick.`
    }
  }
  if (job === 'breath') {
    const n = leftoverReviewItems(project).breaths.length
    return {
      kicker: 'Breaths',
      detail: `${n} stayed in the reel. Cut if it hisses, Keep if the line should breathe.`
    }
  }
  if (job === 'pending') {
    const n = reviewOtherPending(project).length
    return { kicker: 'Review', detail: `${n} waiting` }
  }
  if (job === 'applied') {
    return { kicker: 'Applied', detail: 'Put back one auto-edit, or a whole type, without undoing the rest.' }
  }
  return { kicker: 'Review', detail: 'Nothing waiting.' }
}
