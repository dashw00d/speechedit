import { leftoverItems, leftoverKind } from './analysis'
import { retakeReviewQueue, retakeSceneDropped, takeFamily, uncollapsedRetakeCount } from './sceneAnalysis'
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
  for (const scene of retakeReviewQueue(project).filter((row) => !retakeSceneDropped(project, row))) {
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
  if (leftoverReviewItems(project).breaths.length > 0) return 'breath'
  if (uncollapsedRetakeCount(project) > 0) return 'retake'
  if (reviewOtherPending(project).length > 0) return 'pending'
  if (project.suggestions.some((suggestion) => suggestion.applied)) return 'applied'
  return 'empty'
}

export function reviewJobCount(project: Project): number {
  const job = reviewJob(project)
  if (job === 'leftover') return leftoverReviewCount(project)
  if (job === 'breath') return leftoverReviewItems(project).breaths.length
  if (job === 'retake') return uncollapsedRetakeCount(project)
  if (job === 'pending') return reviewOtherPending(project).length
  if (job === 'applied') return project.suggestions.filter((suggestion) => suggestion.applied).length
  return 0
}

export function reviewDrawerCopy(project: Project): { kicker: string; detail: string } {
  const job = reviewJob(project)
  if (job === 'leftover') {
    const n = leftoverReviewCount(project)
    return {
      kicker: 'Issue review',
      detail: n === 1
        ? '1 issue needs a decision. Hear it, then choose what should happen.'
        : `${n} issues need a decision. Hear each one, then choose what should happen.`
    }
  }
  if (job === 'retake') {
    const n = uncollapsedRetakeCount(project)
    return {
      kicker: 'Take review',
      detail: n === 1 ? '1 take needs a decision. Hear both versions, then choose.' : `${n} takes need a decision. Hear each pair, then choose.`
    }
  }
  if (job === 'breath') {
    const n = leftoverReviewItems(project).breaths.length
    return {
      kicker: 'Breath review',
      detail: `${n} ${n === 1 ? 'breath' : 'breaths'} stayed in the reel. Hear each one, then Cut or Keep.`
    }
  }
  if (job === 'pending') {
    const n = reviewOtherPending(project).length
    return { kicker: 'Suggestion review', detail: `${n} ${n === 1 ? 'suggestion needs' : 'suggestions need'} a decision.` }
  }
  if (job === 'applied') {
    return { kicker: 'Edit history', detail: 'Review completed edits and put back anything you want to keep.' }
  }
  return { kicker: 'Issue review', detail: 'Nothing needs a decision.' }
}
