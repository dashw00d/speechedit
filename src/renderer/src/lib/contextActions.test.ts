import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import {
  hasUncollapsedRetakes,
  inspectorFocus,
  nextPendingSuggestionAfter,
  paceFromMargin,
  projectInspectorDetail,
  rankPalette,
  sceneInspectorDetail,
  suggestTask,
  suggestionInspectorDetail,
  transcriptChoices,
  wordsInspectorDetail
} from './contextActions'
import { suggestionsFromLoudness, suggestionsFromSilence, suggestionsFromStatic } from './analysis'
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
    const { choices, summary } = transcriptChoices(project, [um!.id])
    expect(summary).toMatch(/1 word/)
    expect(choices[0]?.label).toBe('Remove filler')
    expect(choices.some((c) => c.id === 'all-fillers')).toBe(true)
    const all = choices.find((c) => c.id === 'all-fillers')
    expect(all?.command.type).toBe('toggleWords')
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

  test('the demo false take offers Use final take / Keep this take', () => {
    const project = createDemoProject()
    const take = project.transcript.words.filter((w) => w.start >= 30.2 && w.end <= 31.7)
    const { choices } = transcriptChoices(
      project,
      take.map((w) => w.id)
    )
    expect(choices.some((c) => c.id === 'use-take')).toBe(true)
    const use = choices.find((c) => c.id === 'use-take')
    expect(use?.label).toBe('Use final take')
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
    expect(task.showPace).toBe(true)
  })

  test('after safe edits the bar asks to review leftovers', () => {
    const next = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    const task = suggestTask(next)
    expect(task.headline).toMatch(/First edit done|Edit applied/)
    expect(task.showPace).toBe(false)
    expect(task.showWatch).toBe(true)
    expect(task.applyLabel).toBeNull()
    expect(task.reviewCount).toBeGreaterThan(0)
  })

  test('silent stills get Cut and Keep in the inspector', () => {
    const [still] = suggestionsFromSilence([{ start: 2, end: 8 }], 0.12, [{ start: 1.8, end: 8.2 }])
    const project = { ...createDemoProject(), suggestions: [...createDemoProject().suggestions, still] }
    const detail = suggestionInspectorDetail(project, still.id)
    expect(detail?.actions.some((a) => a.id === 'cut' && a.command.type === 'applySuggestion')).toBe(true)
    expect(detail?.actions.some((a) => a.id === 'keep' && a.command.type === 'dismissSuggestion')).toBe(true)
    expect(detail?.explanation).toMatch(/silent demo|dead air/i)
  })

  test('static screens get Speed and Keep in the inspector', () => {
    const [screen] = suggestionsFromStatic([{ start: 2, end: 6 }])
    const project = { ...createDemoProject(), suggestions: [screen] }
    const task = suggestTask({
      ...project,
      suggestions: [
        ...createDemoProject().suggestions.map((s) => ({ ...s, applied: s.safe })),
        screen
      ]
    })
    expect(task.headline).toMatch(/static screen/)
    expect(task.reviewLabel).toBe('Review 1 screen')
    const detail = suggestionInspectorDetail(project, screen.id)
    expect(detail?.title).toBe('Static screen')
    expect(detail?.actions.some((a) => a.id === 'apply' && a.label.startsWith('Speed'))).toBe(true)
    expect(detail?.actions.some((a) => a.id === 'keep' && a.command.type === 'dismissSuggestion')).toBe(true)
    expect(detail?.explanation).toMatch(/loading screen|Speed or Keep/i)
  })

  test('hot audio gets Quiet and Keep in the inspector', () => {
    const hot = suggestionsFromLoudness([{ start: 2, end: 4, lufs: -8 }], 10).find((s) => s.action === 'volume')!
    const project = { ...createDemoProject(), suggestions: [hot] }
    const task = suggestTask({
      ...project,
      suggestions: [...createDemoProject().suggestions.map((s) => ({ ...s, applied: true })), hot]
    })
    expect(task.headline).toMatch(/hot spike/)
    expect(task.reviewLabel).toBe('Review 1 spike')
    const detail = suggestionInspectorDetail(project, hot.id)
    expect(detail?.title).toBe('Hot audio')
    expect(detail?.actions.some((a) => a.id === 'apply' && a.label === 'Quiet')).toBe(true)
    expect(detail?.actions.some((a) => a.id === 'keep' && a.command.type === 'dismissSuggestion')).toBe(true)
    expect(detail?.explanation).toMatch(/Quiet or Keep/i)
  })
})

describe('inspector helper detail', () => {
  test('words inspector exposes actions and deeper context for a filler', () => {
    const project = createDemoProject()
    const um = project.transcript.words.find((w) => w.text === 'um')!
    const detail = wordsInspectorDetail(project, [um.id])
    expect(detail?.title).toBe('Filler')
    expect(detail?.actions.some((a) => a.id === 'remove')).toBe(true)
    expect(detail?.actions.some((a) => a.id === 'all-fillers')).toBe(true)
    expect(detail?.excerpt).toContain('um')
    expect(detail?.speakerId).toBeTruthy()
  })

  test('suggestion inspector explains pauses and offers apply', () => {
    const project = createDemoProject()
    const pause = project.suggestions.find((s) => s.type === 'silence' && !s.applied)
    expect(pause).toBeTruthy()
    const detail = suggestionInspectorDetail(project, pause!.id)
    expect(detail?.title).toBe('Pause')
    expect(detail?.explanation).toMatch(/Dead air/)
    expect(detail?.actions.some((a) => a.id === 'apply')).toBe(true)
    expect(detail?.next?.label).toBe('Review next →')
  })

  test('scene inspector prioritizes retake actions for the false take', () => {
    const project = createDemoProject()
    const detail = sceneInspectorDetail(project, 'sc_false')
    expect(detail?.title).toBe('Retake')
    expect(detail?.actions[0]?.label).toBe('Use final take')
    expect(detail?.actions.some((a) => a.id === 'compare')).toBe(true)
  })

  test('talk scene inspector offers remove on the chapter itself', () => {
    const project = createDemoProject()
    const detail = sceneInspectorDetail(project, 'sc_intro')
    expect(detail?.actions[0]?.id).toBe('cut-scene')
    expect(detail?.actions[0]?.label).toBe('Remove scene')
  })

  test('silent demo inspector offers remove walkthrough', () => {
    const project = createDemoProject()
    const detail = sceneInspectorDetail(project, 'sc_demo')
    expect(detail?.actions.some((a) => a.id === 'cut-scene' && a.label === 'Remove walkthrough')).toBe(true)
  })

  test('demo offers collapse retakes when a false take is still live', () => {
    const project = createDemoProject()
    expect(hasUncollapsedRetakes(project)).toBe(true)
    expect(suggestTask(project).collapseRetakes).toBe(true)
  })

  test('review next walks pending suggestions in timeline order', () => {
    const project = createDemoProject()
    const ordered = project.suggestions.filter((s) => !s.applied).sort((a, b) => a.start - b.start)
    const first = ordered[0]!
    const second = nextPendingSuggestionAfter(project, first.id)
    expect(second?.id).toBe(ordered[1]?.id)
  })

  test('project inspector summarizes pending work', () => {
    const detail = projectInspectorDetail(createDemoProject())
    expect(detail.headline).toMatch(/Transcript ready/)
    expect(detail.pendingByType.length).toBeGreaterThan(0)
    expect(detail.nextHint).toMatch(/Click a word/)
  })
})

describe('pace and inspector focus', () => {
  test('cut margin maps onto Natural / Balanced / Tight', () => {
    expect(paceFromMargin(0.12)).toBe('balanced')
    expect(paceFromMargin(0.04)).toBe('tight')
    expect(paceFromMargin(0.22)).toBe('natural')
  })

  test('inspector follows job, scene, words, caption, then project', () => {
    expect(
      inspectorFocus({
        exporting: true,
        analyzing: null,
        selectedWordIds: ['w'],
        selectedSceneId: null,
        selectedClipId: null,
        selectedSuggestionId: null,
        selectedGap: null
      })
    ).toBe('job')
    expect(
      inspectorFocus({
        exporting: false,
        analyzing: null,
        selectedWordIds: ['w'],
        selectedSceneId: 'sc_false',
        selectedClipId: 'c',
        selectedSuggestionId: null,
        selectedGap: null
      })
    ).toBe('scene')
    expect(
      inspectorFocus({
        exporting: false,
        analyzing: null,
        selectedWordIds: ['w'],
        selectedSceneId: null,
        selectedClipId: 'c',
        selectedSuggestionId: null,
        selectedGap: null
      })
    ).toBe('words')
    expect(
      inspectorFocus({
        exporting: false,
        analyzing: null,
        selectedWordIds: [],
        selectedSceneId: null,
        selectedClipId: 'c',
        selectedSuggestionId: null,
        selectedGap: null,
        clipKind: 'caption'
      })
    ).toBe('caption')
    expect(
      inspectorFocus({
        exporting: false,
        analyzing: null,
        selectedWordIds: [],
        selectedSceneId: null,
        selectedClipId: null,
        selectedSuggestionId: null,
        selectedGap: null
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

  test('an empty reel puts file commands above cut and interchange', () => {
    const ranked = rankPalette(
      [...items, { name: 'Open media…', group: 'file' as const, run: () => undefined }],
      '',
      {
        exporting: false,
        analyzing: null,
        hasWordSelection: false,
        hasClip: false,
        empty: true
      }
    )
    expect(ranked[0]?.name).toBe('Open media…')
    expect(ranked.map((i) => i.name).indexOf('Save')).toBeLessThan(ranked.map((i) => i.name).indexOf('Export OTIO'))
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
