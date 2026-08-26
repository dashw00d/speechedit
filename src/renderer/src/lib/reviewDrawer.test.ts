import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createDemoProject } from './demo'
import { reviewDecisionScenes, reviewDrawerCopy, reviewJob, reviewJobCount } from './reviewDrawer'

describe('review drawer focus', () => {
  test('a fresh demo reviews leftovers, not every chapter', () => {
    const demo = createDemoProject()
    expect(reviewJob(demo)).toBe('leftover')
    expect(reviewDrawerCopy(demo).kicker).toBe('Issue review')
    expect(reviewJobCount(demo)).toBeGreaterThan(0)
    expect(reviewDecisionScenes(demo).every((scene) => scene.kind === 'retake' || scene.takeIndex)).toBe(true)
    expect(reviewDecisionScenes(demo).some((scene) => scene.title === 'Thesis')).toBe(false)
  })

  test('after leftovers, review is the take family only', () => {
    const demo = createDemoProject()
    const leftovers = demo.suggestions.filter((row) => !row.applied && row.type !== 'repeat' && row.type !== 'filler')
    const cleaned = leftovers.reduce((project, row) => applyCommand(project, { type: 'dismissSuggestion', suggestionId: row.id }), demo)
    expect(reviewJob(cleaned)).toBe('retake')
    expect(reviewDrawerCopy(cleaned).detail).toMatch(/needs a decision/)
    const scenes = reviewDecisionScenes(cleaned)
    expect(scenes.some((scene) => /false|take|That/i.test(scene.title) || scene.kind === 'retake' || scene.takeIndex)).toBe(
      true
    )
    expect(scenes.some((scene) => scene.title === 'Thesis')).toBe(false)
    expect(scenes.some((scene) => scene.title === 'Walk the editor')).toBe(false)
  })

  test('a collapsed retake is completed work, not a new review job', () => {
    const demo = createDemoProject()
    const pendingNonRetakes = demo.suggestions.filter((row) => !row.applied && row.type !== 'repeat')
    const cleared = pendingNonRetakes.reduce(
      (project, row) => applyCommand(project, { type: 'dismissSuggestion', suggestionId: row.id }),
      demo
    )
    const collapsed = applyCommand(cleared, { type: 'collapseRetakes' })
    expect(reviewJob(collapsed)).toBe('applied')
    expect(reviewDecisionScenes(collapsed)).toEqual([])
  })
})
