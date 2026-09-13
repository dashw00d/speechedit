import { describe, expect, test } from 'bun:test'
import { buildWorkflow, highlightRange, prepareWorkflow, WORKFLOW_PRESETS, workflowUnavailable } from './workflowPresets'
import { createDemoProject } from './demo'
import { applyCommand, programLength } from './commands'
import { overlap } from './edl'
import { captionClipsOf } from './captions'
import { hasOpeningTitle } from './title'
import type { IntelligenceDraft } from './intelligence'
import { useEditor } from '../store'

const emptyDraft = (): IntelligenceDraft => ({ scenes: [], suggestions: [], commands: [], notes: '' })

describe('one-click workflow recipes', () => {
  for (const preset of WORKFLOW_PRESETS) test(`${preset.label} makes an isolated finished edit`, () => {
    const before = createDemoProject()
    const snapshot = JSON.stringify(before)
    const result = buildWorkflow(before, preset.id)
    expect(JSON.stringify(before)).toBe(snapshot)
    expect(result.project.audioMaster.normalize).toBe(true)
    expect(result.project.cutMargin).toBe(preset.margin)
    expect(result.afterSeconds).toBeGreaterThan(0)
    expect(result.afterSeconds).toBeLessThanOrEqual(result.beforeSeconds)
    expect(captionClipsOf(result.project).length).toBeGreaterThan(0)
    expect(result.project.markIn).toBeNull()
    expect(result.project.markOut).toBeNull()
    expect(result.ai).toBe('off')
  })

  test('livestream keeps repeated remarks; presentation collapses detected retakes', () => {
    const project = createDemoProject()
    const retake = project.scenes.find((scene) => scene.kind === 'retake')!
    const live = buildWorkflow(project, 'livestream', { captions: false }).project
    const feature = buildWorkflow(project, 'presentation', { captions: false }).project
    const coverage = (p: typeof project) => p.cuts.reduce((n, cut) => n + overlap(cut, retake), 0)
    expect(coverage(feature)).toBeGreaterThan(coverage(live))
    expect(hasOpeningTitle(feature)).toBe(true)
  })

  test('preserves protected words and does not restore an existing manual cut', () => {
    let project = createDemoProject()
    const selected = project.transcript.words.slice(0, 4)
    project = applyCommand(project, { type: 'addTag', start: selected[0].start, end: selected.at(-1)!.end, kind: 'keep' })
    const manual = project.transcript.words[20]
    project = applyCommand(project, { type: 'toggleWords', wordIds: [manual.id] })
    for (const preset of WORKFLOW_PRESETS) {
      const after = buildWorkflow(project, preset.id).project
      for (const word of selected) expect(after.transcript.words.find((row) => row.id === word.id)?.deleted).toBeFalsy()
      expect(after.transcript.words.find((row) => row.id === manual.id)?.deleted).toBe(true)
    }
  })

  test('preserves manual caption cards and does not duplicate opening titles on rerun', () => {
    const project = applyCommand(createDemoProject(), { type: 'addTitle', start: 0, duration: 3, text: 'Hand-written title', preset: 'title' })
    const manual = project.tracks.flatMap((track) => track.clips).find((clip) => clip.text === 'Hand-written title')!
    const first = buildWorkflow(project, 'presentation').project
    const second = buildWorkflow(first, 'presentation').project
    expect(second.tracks.flatMap((track) => track.clips).filter((clip) => clip.id === manual.id && clip.text === manual.text)).toHaveLength(1)
    expect(second.tracks.flatMap((track) => track.clips).filter((clip) => clip.style?.position === 'center' && clip.style.fontSize === 64)).toHaveLength(1)
  })

  test('highlight uses whole-word boundaries and a vertical canvas', () => {
    const project = createDemoProject()
    const range = highlightRange(project, 4)!
    expect(project.transcript.words.some((word) => word.start === range.start)).toBe(true)
    expect(project.transcript.words.some((word) => word.end === range.end)).toBe(true)
    const result = buildWorkflow(project, 'highlight').project
    expect([result.width, result.height]).toEqual([1080, 1920])
  })

  test('tutorial leaves more breathing room than livestream cleanup', () => {
    const project = createDemoProject()
    expect(buildWorkflow(project, 'tutorial').afterSeconds).toBeGreaterThanOrEqual(buildWorkflow(project, 'livestream').afterSeconds)
  })

  test('caption opt-out keeps manual cards without generating auto captions', () => {
    const result = buildWorkflow(createDemoProject(), 'livestream', { captions: false })
    expect(result.changes.some((change) => change.includes('Generated captions'))).toBe(false)
  })

  test('a full preset is exactly one undo and redo', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    const before = useEditor.getState().project
    const result = buildWorkflow(before, 'presentation')
    useEditor.getState().dispatch({ type: 'replaceProject', project: result.project })
    const after = useEditor.getState().project
    expect(useEditor.getState().past).toHaveLength(1)
    useEditor.getState().undo()
    expect(useEditor.getState().project).toEqual(before)
    useEditor.getState().redo()
    expect(useEditor.getState().project).toEqual(after)
  })

  test('rejects missing or placeholder transcripts before changing anything', () => {
    const project = createDemoProject()
    project.transcript.words = []
    expect(workflowUnavailable(project)).toContain('transcription')
    expect(() => buildWorkflow(project, 'livestream')).toThrow('transcription')
  })
})

describe('optional AI enhancement', () => {
  test('local mode never calls a provider', async () => {
    let calls = 0
    const result = await prepareWorkflow(createDemoProject(), 'tutorial', { analyze: async () => { calls++; return emptyDraft() } })
    expect(calls).toBe(0)
    expect(result.ai).toBe('off')
  })

  test('AI can add a bounded cut, but cannot execute commands or cut protected words', async () => {
    let project = createDemoProject()
    const protectedWord = project.transcript.words[0]
    const word = project.transcript.words[7]
    project = applyCommand(project, { type: 'addTag', start: protectedWord.start, end: protectedWord.end, kind: 'keep' })
    const result = await prepareWorkflow(project, 'livestream', { useAi: true, analyze: async () => ({
      ...emptyDraft(), commands: [{ type: 'setName', name: 'INJECTED' }, { type: 'deleteRange', start: 0, end: project.sourceDuration }],
      suggestions: [protectedWord, word, { start: NaN, end: Infinity }, { start: -100, end: 1 }].map((span, index) => ({
        id: `test-${index}`, type: 'model', action: 'cut', safe: true, applied: false, start: span.start, end: span.end, label: 'AI example'
      }))
    }) })
    expect(result.ai).toBe('used')
    expect(result.project.name).toBe(project.name)
    expect(result.project.transcript.words.find((row) => row.id === protectedWord.id)?.deleted).toBeFalsy()
    expect(result.project.transcript.words.find((row) => row.id === word.id)?.deleted).toBe(true)
    expect(result.project.suggestions.every((row) => Number.isFinite(row.start) && Number.isFinite(row.end))).toBe(true)
    expect(programLength(result.project)).toBeGreaterThan(0)
  })

  test('uncertain and excessive AI cuts stay pending', () => {
    const project = createDemoProject()
    const draft = emptyDraft()
    draft.suggestions = [
      { id: 'all', type: 'model', action: 'cut', safe: true, applied: false, start: 0, end: project.sourceDuration, label: 'Everything' },
      { id: 'uncertain', type: 'model', action: 'cut', safe: false, applied: false, start: 1, end: 2, label: 'Maybe' }
    ]
    const result = buildWorkflow(project, 'livestream', { draft })
    expect(result.project.suggestions.filter((row) => row.type === 'model').every((row) => !row.applied)).toBe(true)
  })

  test('provider failure completes the local recipe with an explicit fallback', async () => {
    const result = await prepareWorkflow(createDemoProject(), 'presentation', { useAi: true, analyze: async () => { throw new Error('Offline') } })
    expect(result.ai).toBe('fallback')
    expect(result.aiNote).toContain('Finished with local rules')
    expect(result.project.audioMaster.normalize).toBe(true)
  })

  test('an AI timeout finishes locally', async () => {
    const result = await prepareWorkflow(createDemoProject(), 'tutorial', { useAi: true, timeoutMs: 5, analyze: () => new Promise(() => {}) })
    expect(result.ai).toBe('fallback')
    expect(result.aiNote).toContain('too long')
  })

  test('cancellation discards the in-progress result', async () => {
    const controller = new AbortController()
    const project = createDemoProject()
    const snapshot = JSON.stringify(project)
    const pending = prepareWorkflow(project, 'tutorial', { useAi: true, signal: controller.signal, analyze: () => new Promise(() => {}) })
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(JSON.stringify(project)).toBe(snapshot)
  })
})
