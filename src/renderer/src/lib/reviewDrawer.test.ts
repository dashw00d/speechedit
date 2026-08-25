import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createDemoProject } from './demo'
import { reviewDecisionScenes, reviewDrawerCopy, reviewJob } from './reviewDrawer'

describe('review drawer focus', () => {
  test('a fresh demo reviews leftovers, not every chapter', () => {
    const demo = createDemoProject()
    expect(reviewJob(demo)).toBe('leftover')
    expect(reviewDrawerCopy(demo).kicker).toBe('Leftover')
    expect(reviewDecisionScenes(demo).every((scene) => scene.kind === 'retake' || scene.takeIndex)).toBe(true)
    expect(reviewDecisionScenes(demo).some((scene) => scene.title === 'Thesis')).toBe(false)
  })

  test('after leftovers, review is the take family only', () => {
    const demo = createDemoProject()
    const leftovers = demo.suggestions.filter((row) => !row.applied && row.type !== 'repeat' && row.type !== 'filler')
    const cleaned = leftovers.reduce((project, row) => applyCommand(project, { type: 'dismissSuggestion', suggestionId: row.id }), demo)
    expect(reviewJob(cleaned)).toBe('retake')
    expect(reviewDrawerCopy(cleaned).detail).toMatch(/Use later take|Put back/)
    const scenes = reviewDecisionScenes(cleaned)
    expect(scenes.some((scene) => /false|take|That/i.test(scene.title) || scene.kind === 'retake' || scene.takeIndex)).toBe(
      true
    )
    expect(scenes.some((scene) => scene.title === 'Thesis')).toBe(false)
    expect(scenes.some((scene) => scene.title === 'Walk the editor')).toBe(false)
  })
})
