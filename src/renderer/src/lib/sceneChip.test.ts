import { describe, expect, test } from 'vitest'
import { createDemoProject } from './demo'
import {
  SCENE_CHIP_ACTION_IDS,
  groupScenesByTranscriptAnchor,
  neighborScene,
  sceneClockLabel,
  sceneKindLabel
} from './sceneChip'
import { takeFamily } from './sceneAnalysis'

describe('scene headings', () => {
  test('labels talk, demo, and take families in plain language', () => {
    const project = createDemoProject()
    const thesis = project.scenes.find((s) => s.id === 'sc_intro')!
    const demo = project.scenes.find((s) => s.id === 'sc_demo')!
    const retake = project.scenes.find((s) => s.id === 'sc_false')!
    expect(sceneKindLabel(thesis, takeFamily(project.scenes, thesis.id))).toBe('Scene')
    expect(sceneKindLabel(demo, takeFamily(project.scenes, demo.id))).toBe('Silent demo')
    expect(sceneKindLabel(retake, takeFamily(project.scenes, retake.id))).toBe('Take 1 of 2')
    expect(sceneClockLabel(demo)).toBe('6.5s')
    expect(SCENE_CHIP_ACTION_IDS.has('zoom')).toBe(true)
  })

  test('silent demo scene still anchors in the script before the next spoken word', () => {
    const project = createDemoProject()
    const { atWord, after } = groupScenesByTranscriptAnchor(project.scenes, project.transcript.words)
    expect(after).toEqual([])
    const cutIdx = project.transcript.words.findIndex((w) => w.text === 'Cut')
    const headed = atWord.get(cutIdx) ?? []
    expect(headed.map((s) => s.id)).toEqual(['sc_demo', 'sc_false'])
    expect([...atWord.values()].flat().some((s) => s.id === 'sc_intro')).toBe(true)
  })

  test('neighbor scene walks editorial order', () => {
    const project = createDemoProject()
    expect(neighborScene(project.scenes, 'sc_intro', 1)?.id).toBe('sc_import')
    expect(neighborScene(project.scenes, 'sc_intro', -1)).toBeUndefined()
    expect(neighborScene(project.scenes, 'sc_end', 1)).toBeUndefined()
    expect(neighborScene(project.scenes, 'sc_demo', 1)?.id).toBe('sc_false')
  })
})
