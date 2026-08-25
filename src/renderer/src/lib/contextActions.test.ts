import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import {
  inspectorFocus,
  paceFromMargin,
  rankPalette,
  suggestTask,
  transcriptChoices
} from './contextActions'
import { createDemoProject } from './demo'

describe('transcript context choices', () => {
  test('selected live words offer Remove with a duration consequence', () => {
    const project = createDemoProject()
    const words = project.transcript.words.filter((w) => w.start >= 0.42 && w.end <= 1.08)
    const { choices, summary } = transcriptChoices(
      project,
      words.map((w) => w.id)
    )
    expect(summary).toMatch(/words/)
    const remove = choices.find((c) => c.id === 'remove')
    expect(remove?.label).toBe('Remove')
    expect(remove?.consequence).toMatch(/closes the gap/)
    expect(remove?.command.type).toBe('toggleWords')
    expect(choices.length).toBeGreaterThanOrEqual(2)
    expect(choices.length).toBeLessThanOrEqual(4)
    expect(choices.some((c) => c.id === 'keep')).toBe(true)
  })

  test('a filler token is Remove filler, still on the command bus', () => {
    const project = createDemoProject()
    const um = project.transcript.words.find((w) => w.text === 'um')
    expect(um).toBeTruthy()
    const { choices } = transcriptChoices(project, [um!.id])
    expect(choices[0]?.label).toBe('Remove filler')
    const next = applyCommand(project, choices[0]!.command)
    expect(next.transcript.words.find((w) => w.id === um!.id)?.deleted).toBe(true)
  })

  test('cut words offer Put back via restore or revert', () => {
    const project = createDemoProject()
    const um = project.transcript.words.find((w) => w.text === 'um')!
    const cut = applyCommand(project, { type: 'toggleWords', wordIds: [um.id] })
    const { choices } = transcriptChoices(cut, [um.id])
    expect(choices[0]?.id).toBe('put-back')
    const restored = applyCommand(cut, choices[0]!.command)
    expect(restored.transcript.words.find((w) => w.id === um.id)?.deleted).toBe(false)
  })

  test('the demo false take offers Use another take / Keep this take', () => {
    const project = createDemoProject()
    const take = project.transcript.words.filter((w) => w.start >= 30.2 && w.end <= 31.7)
    const { choices } = transcriptChoices(
      project,
      take.map((w) => w.id)
    )
    expect(choices.some((c) => c.id === 'use-take')).toBe(true)
    const use = choices.find((c) => c.id === 'use-take')
    const next = applyCommand(project, use!.command)
    expect(next.transcript.words.filter((w) => w.start >= 30.2 && w.end <= 31.7).every((w) => w.deleted)).toBe(true)
    const keep = choices.find((c) => c.id === 'keep-take')
    if (keep) {
      const kept = applyCommand(project, keep.command)
      expect(kept.transcript.words.filter((w) => w.start >= 30.2 && w.end <= 31.7).some((w) => !w.deleted)).toBe(true)
    }
  })
})

describe('suggest task copy', () => {
  test('demo starts as transcript-ready with safe cleans, not a chip dump', () => {
    const task = suggestTask(createDemoProject())
    expect(task.headline).toMatch(/Transcript ready/)
    expect(task.safeCount).toBeGreaterThan(0)
    expect(task.applyLabel).toMatch(/Clean \d+ pauses/)
    expect(task.reviewLabel).toMatch(/Review/)
  })

  test('after safe edits the bar asks to review leftovers', () => {
    const next = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    const task = suggestTask(next)
    expect(task.headline).toMatch(/First edit done|Edit applied/)
  })
})

describe('pace and inspector focus', () => {
  test('cut margin maps onto Natural / Balanced / Tight', () => {
    expect(paceFromMargin(0.12)).toBe('balanced')
    expect(paceFromMargin(0.04)).toBe('tight')
    expect(paceFromMargin(0.22)).toBe('natural')
  })

  test('inspector follows job, words, caption, then project', () => {
    expect(
      inspectorFocus({
        exporting: true,
        analyzing: null,
        selectedWordIds: ['w'],
        selectedClipId: null,
        selectedSuggestionId: null
      })
    ).toBe('job')
    expect(
      inspectorFocus({
        exporting: false,
        analyzing: null,
        selectedWordIds: ['w'],
        selectedClipId: 'c',
        selectedSuggestionId: null
      })
    ).toBe('words')
    expect(
      inspectorFocus({
        exporting: false,
        analyzing: null,
        selectedWordIds: [],
        selectedClipId: 'c',
        selectedSuggestionId: null,
        clipKind: 'caption'
      })
    ).toBe('caption')
    expect(
      inspectorFocus({
        exporting: false,
        analyzing: null,
        selectedWordIds: [],
        selectedClipId: null,
        selectedSuggestionId: null
      })
    ).toBe('project')
  })
})

describe('palette ranking', () => {
  const items = [
    { name: 'Export OTIO', group: 'export' as const, run: () => undefined },
    { name: 'Cut selection', group: 'selection' as const, run: () => undefined },
    { name: 'Cancel export', group: 'job' as const, run: () => undefined },
    { name: 'Save', group: 'file' as const, run: () => undefined }
  ]

  test('a running export puts Cancel first', () => {
    const ranked = rankPalette(items, '', {
      exporting: true,
      analyzing: null,
      hasWordSelection: false,
      hasClip: false
    })
    expect(ranked[0]?.name).toBe('Cancel export')
  })

  test('word selection ranks Cut selection above interchange', () => {
    const ranked = rankPalette(items, '', {
      exporting: false,
      analyzing: null,
      hasWordSelection: true,
      hasClip: false
    })
    expect(ranked[0]?.name).toBe('Cut selection')
    expect(ranked.map((i) => i.name)).toContain('Export OTIO')
    expect(ranked.map((i) => i.name)).not.toContain('Cancel export')
  })

  test('otio query finds interchange in the palette, not a menu', () => {
    const ranked = rankPalette(items, 'otio', {
      exporting: false,
      analyzing: null,
      hasWordSelection: false,
      hasClip: false
    })
    expect(ranked.map((i) => i.name)).toEqual(['Export OTIO'])
  })
})
