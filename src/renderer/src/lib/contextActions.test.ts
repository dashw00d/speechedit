import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import {
  hasUncollapsedRetakes,
  inspectorFocus,
  inspectorTabs,
  nextPendingSuggestionAfter,
  paceFromMargin,
  projectInspectorDetail,
  rankPalette,
  sceneInspectorDetail,
  suggestTask,
  suggestionInspectorDetail,
  commandForGapDoubleClick,
  gapInspectorDetail,
  pendingSuggestionForGap,
  toastForCommand,
  toastForEdit,
  transcriptChoices,
  wordsInspectorDetail
} from './contextActions'
import { leftoverKind, suggestionsFromLoudness, suggestionsFromSilence, suggestionsFromStatic } from './analysis'
import { createDemoProject, createEmptyProject } from './demo'
import { paragraphIds } from './transcriptEdit'
import { selectParagraphFromContext } from './scriptActions'
import { useEditor, usePlayback } from '../store'

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
    expect(choices.some((c) => c.id === 'keep')).toBe(true)
  })

  test('a full paragraph offers Remove paragraph and a cut toast', () => {
    const project = createDemoProject()
    const ids = paragraphIds(project.transcript.words, 0)
    expect(ids.length).toBeGreaterThan(2)
    const { choices, summary } = transcriptChoices(project, ids)
    expect(summary).toMatch(/words/)
    expect(choices.find((c) => c.id === 'cut-paragraph')?.label).toBe('Remove paragraph')
    expect(choices.some((c) => c.id === 'cut-sentence')).toBe(false)
    expect(toastForEdit(project, { type: 'toggleWords', wordIds: ids })).toMatch(/Removed the paragraph/)
    const detail = wordsInspectorDetail(project, ids)
    expect(detail?.title).toBe('Paragraph')
    expect(detail?.nextHint).toMatch(/Remove paragraph/)
  })

  test('selectParagraphFromContext points at Remove paragraph', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    usePlayback.getState().seekProgram(0.7)
    const result = selectParagraphFromContext()
    expect(result.count).toBeGreaterThan(2)
    expect(result.toast).toMatch(/Remove paragraph/)
    expect(useEditor.getState().selectedWordIds.length).toBe(result.count)
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

  test('the demo false take offers Use later take / Keep this take', () => {
    const project = createDemoProject()
    const take = project.transcript.words.filter((w) => w.start >= 30.2 && w.end <= 31.7)
    const { choices } = transcriptChoices(
      project,
      take.map((w) => w.id)
    )
    expect(choices.some((c) => c.id === 'use-take')).toBe(true)
    const use = choices.find((c) => c.id === 'use-take')
    expect(use?.label).toBe('Use later take')
    const next = applyCommand(project, use!.command)
    expect(next.transcript.words.filter((w) => w.start >= 30.2 && w.end <= 31.7).every((w) => w.deleted)).toBe(true)
    const keep = choices.find((c) => c.id === 'keep-take')
    if (keep) {
      const kept = applyCommand(project, keep.command)
      expect(kept.transcript.words.filter((w) => w.start >= 30.2 && w.end <= 31.7).some((w) => !w.deleted)).toBe(true)
    }
  })

  test('a short live previous line offers Cut previous sentence', () => {
    const project = createDemoProject()
    const thats = project.transcript.words.find((w) => w.text === "That's")!
    const { choices } = transcriptChoices(project, [thats.id])
    const cutPrev = choices.find((c) => c.id === 'cut-prev')
    expect(cutPrev?.label).toBe('Cut previous sentence')
    expect(cutPrev?.consequence).toMatch(/closes the gap/)
    expect(cutPrev?.command.type).toBe('cutPreviousSentence')
    const next = applyCommand(project, cutPrev!.command)
    expect(next.transcript.words.filter((w) => w.start >= 30.2 && w.end <= 31.7).every((w) => w.deleted)).toBe(true)
    expect(next.transcript.words.find((w) => w.id === thats.id)?.deleted).toBe(false)
    expect(toastForCommand(cutPrev!.command)).toMatch(/Hear the join/)
  })

  test('a long previous chapter does not steal a chip — comma still exists', () => {
    const project = createDemoProject()
    const first = project.transcript.words.find((w) => w.text === 'First')!
    const { choices } = transcriptChoices(project, [first.id])
    expect(choices.some((c) => c.id === 'cut-prev')).toBe(false)
    const cutThis = choices.find((c) => c.id === 'cut-sentence')
    expect(cutThis?.label).toBe('Cut this sentence')
    expect(cutThis?.command.type).toBe('cutSentence')
  })

  test('an already-cut previous sentence does not offer Cut previous sentence', () => {
    const project = createDemoProject()
    const thats = project.transcript.words.find((w) => w.text === "That's")!
    const collapsed = applyCommand(project, { type: 'collapseRetakes' })
    const { choices } = transcriptChoices(collapsed, [thats.id])
    expect(choices.some((c) => c.id === 'cut-prev')).toBe(false)
  })
})

describe('suggest task copy', () => {
  test('speech-island fallback is not advertised as a transcript', () => {
    const empty = createEmptyProject('islands')
    const project = {
      ...empty,
      transcript: {
        ...empty.transcript,
        words: [
          { id: 'w1', text: 'Speech 1', start: 0, end: 2, speaker: 'ryan', deleted: false, origin: 'island' as const }
        ]
      }
    }
    expect(suggestTask(project).headline).toMatch(/No transcript/)
    expect(suggestTask(project).headline).not.toMatch(/Transcript ready/)
    expect(suggestTask(createEmptyProject()).headline).toMatch(/Open media/)
  })

  test('demo starts as transcript-ready with safe cleans, not a chip dump', () => {
    const task = suggestTask(createDemoProject())
    expect(task.headline).toMatch(/Transcript ready/)
    expect(task.safeCount).toBeGreaterThan(0)
    expect(task.applyLabel).toMatch(/Apply \d+ safe edits/)
    expect(task.reviewLabel).toMatch(/Review/)
    expect(task.showPace).toBe(true)
    expect(task.showMarkedExport).toBe(false)
  })

  test('In–Out marks make Export marked range the next step', () => {
    const marked = applyCommand(createDemoProject(), { type: 'setMarks', markIn: 32.1, markOut: 35.4 })
    const task = suggestTask(marked)
    expect(task.showMarkedExport).toBe(true)
    expect(task.headline).toMatch(/Clip marked/)
    expect(task.headline).toMatch(/Cut it/)
    expect(task.headline).toMatch(/export it/)
    expect(task.headline).toMatch(/Clear marks/)
  })

  test('after safe edits the bar asks to review leftovers', () => {
    const next = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    const task = suggestTask(next)
    expect(task.headline).toMatch(/First edit done|Edit applied/)
    expect(task.showPace).toBe(false)
    expect(task.showWatch).toBe(true)
    expect(task.applyLabel).toBeNull()
    expect(task.reviewCount).toBeGreaterThan(0)
    expect(task.findRetakes).toBe(false)
  })

  test('after leftovers a reel without retake scenes still offers Find retakes', () => {
    const [activity] = suggestionsFromSilence([{ start: 2, end: 8 }], 0.12, [], 20, [3.2])
    const project = {
      ...createEmptyProject('find-retakes'),
      transcript: {
        words: [{ id: 'w1', text: 'Hello', start: 0.2, end: 0.6, speaker: 'ryan', deleted: false }],
        speakers: [{ id: 'ryan', name: 'Ryan', color: '#C4452D' }]
      },
      suggestions: [{ ...activity, applied: false }],
      scenes: []
    }
    expect(suggestTask(project).findRetakes).toBe(true)
    const cleaned = {
      ...project,
      suggestions: [{ ...activity, applied: true, action: 'cut' as const, safe: true }]
    }
    const task = suggestTask(cleaned)
    expect(task.findRetakes).toBe(true)
    expect(task.headline).toMatch(/Find retakes/)
  })

  test('after leftovers, completed retakes stay applied while breaths remain actionable', () => {
    const first = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    const collapsed = applyCommand(first, { type: 'collapseRetakes' })
    expect(suggestTask(collapsed).headline).toMatch(/quiet picture|silent still|First edit done/)
    const leftoversGone = {
      ...collapsed,
      suggestions: collapsed.suggestions.map((s) => {
        const kind = leftoverKind(s)
        return kind === 'activity' || kind === 'still' || kind === 'static' || kind === 'loud'
          ? { ...s, applied: true }
          : s
      })
    }
    const task = suggestTask(leftoversGone)
    expect(task.findRetakes).toBe(false)
    expect(task.headline).not.toMatch(/Dropped \d+ false take/)
    expect(task.reviewLabel).not.toMatch(/Review \d+ take/)
    expect(task.reviewCount).toBe(0)
    expect(task.showWatch).toBe(true)
    expect(task.showZoom).toBe(true)
    expect(task.showTitle).toBe(true)
    expect(task.showLowerThird).toBe(true)
    expect(task.showBreaths).toBe(true)
    expect(task.breathCount).toBeGreaterThan(0)
  })

  test('leftover breaths get Cut and Keep in the inspector', () => {
    const demo = createDemoProject()
    const breath = demo.suggestions.find((s) => s.id === 'sug_breath')
    expect(breath).toBeTruthy()
    const detail = suggestionInspectorDetail(demo, breath!.id)
    expect(detail?.title).toBe('Breath')
    expect(detail?.category).toBe('Breath')
    expect(detail?.prompt).toMatch(/sound natural/i)
    expect(detail?.actions.some((a) => a.id === 'apply' && a.label === 'Cut')).toBe(true)
    expect(detail?.actions.find((a) => a.id === 'keep')?.command.type).toBe('resolveSuggestion')
    expect(detail?.explanation).toMatch(/more natural/i)
    const first = applyCommand(demo, { type: 'applySafeSuggestions' })
    expect(suggestTask(first).showBreaths).toBe(false)
    const leftoversGone = {
      ...first,
      suggestions: first.suggestions.map((s) => {
        const kind = leftoverKind(s)
        return kind === 'activity' || kind === 'still' || kind === 'static' || kind === 'loud'
          ? { ...s, applied: true }
          : s
      })
    }
    expect(suggestTask(leftoversGone).showBreaths).toBe(true)
    expect(suggestTask(leftoversGone).headline).not.toMatch(/need review/)
  })

  test('silent stills get Cut, Silent demo, Speed, and Keep in the inspector', () => {
    const [still] = suggestionsFromSilence([{ start: 2, end: 8 }], 0.12, [{ start: 1.8, end: 8.2 }])
    const project = { ...createDemoProject(), suggestions: [...createDemoProject().suggestions, still] }
    const detail = suggestionInspectorDetail(project, still.id)
    expect(detail?.actions.some((a) => a.id === 'cut' && a.command.type === 'resolveSuggestion')).toBe(true)
    expect(detail?.actions.some((a) => a.id === 'demo' && a.command.type === 'resolveSuggestion')).toBe(true)
    expect(detail?.actions.some((a) => a.id === 'speed' && a.command.type === 'resolveSuggestion')).toBe(true)
    expect(detail?.actions.some((a) => a.id === 'keep' && a.command.type === 'resolveSuggestion')).toBe(true)
    expect(detail?.actions.find((a) => a.id === 'keep')?.consequence).toMatch(/Auto Edit will skip/)
    expect(detail?.category).toBe('Silent still')
    expect(detail?.prompt).toMatch(/useful hold|dead air/i)
    expect(detail?.explanation).toMatch(/deliberate hold|dead air/i)
  })

  test('quiet picture changes lead with Silent demo, then Speed or Cut', () => {
    const [activity] = suggestionsFromSilence([{ start: 2, end: 8 }], 0.12, [], 20, [3.2])
    const project = { ...createDemoProject(), suggestions: [activity] }
    const detail = suggestionInspectorDetail(project, activity.id)
    expect(detail?.title).toBe('Quiet picture change')
    expect(detail?.category).toBe('Silent activity')
    expect(detail?.status).toBe('Needs decision')
    expect(detail?.prompt).toMatch(/walkthrough|dead air/i)
    expect(detail?.actions[0]?.id).toBe('demo')
    expect(detail?.actions.some((a) => a.id === 'speed')).toBe(true)
    expect(detail?.actions.some((a) => a.id === 'cut')).toBe(true)
    expect(detail?.explanation).toMatch(/walkthrough|dead air/i)
    const task = suggestTask({
      ...createEmptyProject('activity-bar'),
      suggestions: [
        ...createDemoProject().suggestions.map((s) => ({ ...s, applied: true })),
        activity
      ]
    })
    expect(task.headline).toMatch(/quiet picture change/)
    expect(task.reviewLabel).toMatch(/Review 1 change/)
  })

  test('static screens get Speed and Keep in the inspector', () => {
    const [screen] = suggestionsFromStatic([{ start: 2, end: 6 }])
    const project = { ...createDemoProject(), suggestions: [screen] }
    const task = suggestTask({
      ...project,
      suggestions: [
        ...createDemoProject().suggestions.map((s) => ({ ...s, applied: true })),
        screen
      ]
    })
    expect(task.headline).toMatch(/static screen/)
    expect(task.reviewLabel).toBe('Review 1 screen')
    const detail = suggestionInspectorDetail(project, screen.id)
    expect(detail?.title).toBe('Static screen')
    expect(detail?.actions.some((a) => a.id === 'apply' && a.label.startsWith('Speed'))).toBe(true)
    expect(detail?.actions.some((a) => a.id === 'keep' && a.command.type === 'dismissSuggestion')).toBe(true)
    expect(detail?.explanation).toMatch(/loading screen|deliberate hold/i)
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
    expect(detail?.explanation).toMatch(/louder than the rest/i)
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

  test('words inspector offers Cut previous sentence on a restart', () => {
    const project = createDemoProject()
    const thats = project.transcript.words.find((w) => w.text === "That's")!
    const detail = wordsInspectorDetail(project, [thats.id])
    expect(detail?.actions.some((a) => a.id === 'cut-prev')).toBe(true)
    expect(detail?.nextHint).toMatch(/previous sentence/)
  })

  test('words inspector hints that captions follow a name fix', () => {
    const project = applyCommand(createDemoProject(), { type: 'generateCaptions', maxWords: 5, emphasize: true })
    const so = project.transcript.words.find((w) => w.text === 'So')!
    const detail = wordsInspectorDetail(project, [so.id])
    expect(detail?.nextHint).toMatch(/captions follow/)
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

  test('the leftover click-through pause offers Silent demo and double-click cuts', () => {
    const project = createDemoProject()
    expect(pendingSuggestionForGap(project, 22.4, 22.72)?.id).toBe('sug_click')
    const detail = gapInspectorDetail(project, 22.4, 22.72)
    expect(detail?.actions.some((a) => a.id === 'demo' && a.label === 'Silent demo')).toBe(true)
    expect(detail?.actions.some((a) => a.id === 'cut')).toBe(true)
    const command = commandForGapDoubleClick(project, 22.4, 22.72)
    expect(command).toEqual({ type: 'resolveSuggestion', suggestionId: 'sug_click', resolution: 'cut' })
    const next = applyCommand(project, command!)
    expect(next.suggestions.find((s) => s.id === 'sug_click')?.applied).toBe(true)
    expect(toastForCommand(command!)).toMatch(/Undo/)
  })

  test('a mostly-cut first-edit pause double-clicks back in', () => {
    const cut = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    const detail = gapInspectorDetail(cut, 6.5, 16.2)
    expect(detail?.title).toBe('Cut pause')
    expect(detail?.actions[0]?.label).toBe('Put back')
    expect(detail?.actions.some((action) => action.id === 'keep' && action.label === 'Protect')).toBe(true)
    const command = commandForGapDoubleClick(cut, 6.5, 16.2)
    expect(command?.type).toBe('revertSuggestion')
    const back = applyCommand(cut, command!)
    expect(back.cuts.some((c) => c.start >= 6.6 && c.end <= 16)).toBe(false)
  })

  test('scene inspector prioritizes retake actions for the false take', () => {
    const project = createDemoProject()
    const detail = sceneInspectorDetail(project, 'sc_false')
    expect(detail?.title).toBe('Retake')
    expect(detail?.actions[0]?.label).toBe('Use later take')
    expect(detail?.actions.some((a) => a.id === 'compare')).toBe(true)
  })

  test('talk scene inspector offers remove on the chapter itself', () => {
    const project = createDemoProject()
    const detail = sceneInspectorDetail(project, 'sc_intro')
    expect(detail?.actions[0]?.id).toBe('cut-scene')
    expect(detail?.actions[0]?.label).toBe('Remove scene')
  })

  test('silent demo inspector offers remove walkthrough and Add zoom', () => {
    const project = createDemoProject()
    const detail = sceneInspectorDetail(project, 'sc_demo')
    expect(detail?.actions.some((a) => a.id === 'cut-scene' && a.label === 'Remove walkthrough')).toBe(true)
    expect(detail?.actions.some((a) => a.id === 'zoom' && a.command.type === 'addZoom')).toBe(true)
    expect(detail?.actions.some((a) => a.id === 'redact' && a.command.type === 'addRedaction')).toBe(true)
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

  test('context details always provide stable Project and Assistant routes', () => {
    expect(inspectorTabs('words').map((tab) => tab.label)).toEqual(['Words', 'Project', 'Assistant'])
    expect(inspectorTabs('clip').map((tab) => tab.label)).toEqual(['Picture', 'Project', 'Assistant'])
    expect(inspectorTabs('project').map((tab) => tab.label)).toEqual(['Project', 'Assistant'])
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
