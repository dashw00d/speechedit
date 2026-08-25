import { describe, expect, test } from 'bun:test'
import { applyCommand, programLength } from './commands'
import { createDemoProject, createEmptyProject } from './demo'
import { parseIntelligence } from './intelligence'
import { planIntent } from './intent'
import { normalizeProject } from './normalize'
import {
  commandForScene,
  findTake,
  inferScenesLocal,
  normalizeScenes,
} from './sceneAnalysis'
import type { Word } from '../types'

function word(text: string, start: number, end: number): Word {
  return { id: `w_${start}`, text, start, end, speaker: 'ryan', deleted: false }
}

function pricingReel() {
  const project = createEmptyProject('Pricing')
  const words = [
    word('The', 0.2, 0.4),
    word('pricing', 0.45, 0.9),
    word('is', 0.95, 1.1),
    word('ten', 1.15, 1.4),
    word('dollars.', 1.45, 1.9),
    word('The', 4.2, 4.4),
    word('pricing', 4.45, 4.9),
    word('is', 4.95, 5.1),
    word('twelve', 5.15, 5.5),
    word('dollars', 5.55, 5.95),
    word('a', 6.0, 6.1),
    word('month.', 6.15, 6.6)
  ]
  return {
    ...project,
    sourceDuration: 8,
    transcript: { ...project.transcript, words },
    analysis: { silence: [{ start: 1.95, end: 4.15 }], staticRegions: [], loudness: [] }
  }
}

describe('scene grouping and retakes', () => {
  test('normalize fills scenes and drops invalid spans', () => {
    const empty = normalizeProject({ ...createEmptyProject(), scenes: undefined as never })
    expect(empty.scenes).toEqual([])
    const cleaned = normalizeScenes([
      { id: 'sc1', start: 1, end: 3, title: 'A', summary: '', kind: 'talk' },
      { id: 'bad', start: 5, end: 4, title: 'nope', summary: '', kind: 'talk' }
    ])
    expect(cleaned).toHaveLength(1)
    expect(cleaned[0].title).toBe('A')
  })

  test('heuristic groups the demo into talk, demo, and a retake', () => {
    const demo = { ...createDemoProject(), scenes: [] }
    const draft = inferScenesLocal(demo)
    expect(draft.scenes.length).toBeGreaterThanOrEqual(3)
    expect(draft.scenes.some((s) => s.kind === 'demo')).toBe(true)
    const retake = draft.scenes.find((s) => s.kind === 'retake')
    expect(retake).toBeTruthy()
    expect(retake!.takeOf).toBeTruthy()
    const keeper = draft.scenes.find((s) => s.id === retake!.takeOf)
    expect(keeper).toBeTruthy()
    expect(keeper!.start).toBeGreaterThan(retake!.start)
    expect(retake!.takeIndex).toBe(1)
    expect(keeper!.takeIndex).toBe(2)
  })

  test('retake suggestions are type repeat, unsafe, and revertible', () => {
    const demo = applyCommand({ ...createDemoProject(), scenes: [] }, { type: 'rebuildIntelligence' })
    const retake = demo.suggestions.find((s) => s.type === 'repeat')
    expect(retake).toBeTruthy()
    expect(retake!.safe).toBe(false)
    expect(retake!.action).toBe('cut')
    expect(retake!.applied).toBe(false)
    const cut = applyCommand(demo, { type: 'applySuggestion', suggestionId: retake!.id })
    expect(programLength(cut)).toBeLessThan(programLength(demo) - 0.8)
    expect(cut.cuts.some((c) => c.source === 'repeat')).toBe(true)
    const back = applyCommand(cut, { type: 'revertSuggestion', suggestionId: retake!.id })
    expect(back.suggestions.find((s) => s.id === retake!.id)?.applied).toBe(false)
    expect(programLength(back)).toBeCloseTo(programLength(demo), 1)
  })

  test('rebuildIntelligence is offline and keeps applied cuts', () => {
    const cut = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    const rebuilt = applyCommand(cut, { type: 'rebuildIntelligence' })
    expect(rebuilt.scenes.length).toBeGreaterThan(0)
    expect(rebuilt.suggestions.some((s) => s.applied)).toBe(true)
    expect(programLength(rebuilt)).toBeCloseTo(programLength(cut), 2)
    expect(rebuilt.scenes.some((s) => s.kind === 'retake' || s.takeIndex)).toBe(true)
  })

  test('keep take 2 of the pricing bit cuts take 1 only', () => {
    const reel = applyCommand(pricingReel(), { type: 'inferScenes' })
    const take2 = findTake(reel, 'pricing', 2)
    expect(take2).toBeTruthy()
    const kept = applyCommand(reel, { type: 'keepTake', sceneId: take2!.id })
    const first = kept.transcript.words.find((w) => w.text === 'ten')
    const second = kept.transcript.words.find((w) => w.text === 'twelve')
    expect(first?.deleted).toBe(true)
    expect(second?.deleted).toBe(false)
    const plan = planIntent(reel, 'keep take 2 of the pricing bit')
    expect(plan.commands[0]?.type).toBe('keepTake')
  })

  test('collapseRetakes skips keep-tagged ranges and is command-bus only', () => {
    const inferred = applyCommand({ ...createDemoProject(), scenes: [] }, { type: 'inferScenes' })
    const retake = inferred.scenes.find((s) => s.kind === 'retake')
    expect(retake).toBeTruthy()
    const guarded = applyCommand(inferred, {
      type: 'addTag',
      start: retake!.start,
      end: retake!.end,
      kind: 'keep',
      label: 'Keep the false start'
    })
    const collapsed = applyCommand(guarded, { type: 'collapseRetakes' })
    expect(collapsed.transcript.words.filter((w) => w.start >= retake!.start && w.end <= retake!.end).some((w) => !w.deleted)).toBe(
      true
    )
    const open = applyCommand(inferred, { type: 'collapseRetakes' })
    expect(programLength(open)).toBeLessThan(programLength(inferred))
  })

  test('API JSON scenes become repeat suggestions via mergeIntelligence', () => {
    const draft = parseIntelligence({
      notes: 'Keep take 2.',
      scenes: [
        { id: 'sc1', start: 0.2, end: 1.9, title: 'Pricing', kind: 'retake', takeOf: 'sc2', takeIndex: 1 },
        { id: 'sc2', start: 4.2, end: 6.6, title: 'Pricing', kind: 'talk', takeIndex: 2 }
      ]
    })
    expect(draft.scenes[0].takeIndex).toBe(1)
    const retake = draft.suggestions.find((s) => s.type === 'repeat')
    expect(retake).toBeTruthy()
    expect(retake!.safe).toBe(false)
    const merged = applyCommand(pricingReel(), {
      type: 'mergeIntelligence',
      scenes: draft.scenes,
      suggestions: draft.suggestions
    })
    expect(merged.scenes.some((s) => s.kind === 'retake' && s.takeOf === 'sc2')).toBe(true)
    expect(merged.suggestions.some((s) => s.type === 'repeat' && s.safe === false)).toBe(true)
  })

  test('scene chip apply/put-back uses applyCommand', () => {
    const inferred = applyCommand({ ...createDemoProject(), scenes: [] }, { type: 'inferScenes' })
    const retake = inferred.scenes.find((s) => s.kind === 'retake')
    expect(retake).toBeTruthy()
    const apply = commandForScene(inferred, retake!, 'apply')
    const cut = applyCommand(inferred, apply)
    expect(programLength(cut)).toBeLessThan(programLength(inferred))
    const revert = commandForScene(cut, retake!, 'revert')
    const back = applyCommand(cut, revert)
    expect(programLength(back)).toBeCloseTo(programLength(inferred), 1)
  })

  test('intent maps scene verbs onto the command bus', () => {
    const demo = createDemoProject()
    expect(planIntent(demo, 'Find scenes and mark retakes').commands[0]?.type).toBe('inferScenes')
    expect(planIntent(demo, 'rebuild intelligence').commands[0]?.type).toBe('rebuildIntelligence')
    expect(planIntent(demo, 'collapse retakes').commands[0]?.type).toBe('collapseRetakes')
  })
})
