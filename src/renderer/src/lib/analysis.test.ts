import { describe, expect, test } from 'bun:test'
import type { Word } from '../types'
import {
  annotateProtected,
  buildSuggestions,
  cutMinusProtected,
  detectRepeats,
  suggestionsFromEdges,
  suggestionsFromGaps,
  suggestionsFromPace,
  leftoverKind,
  leftoverReviewQueue,
  leftoverItems,
  leftoverForSpan,
  reviewGap,
  suggestionsFromLoudness,
  suggestionsFromSilence,
  suggestionsFromStatic,
  suggestionsFromWordGaps,
  volumeTowardLufs,
  withCutMargin
} from './analysis'
import { applyCommand, programLength } from './commands'
import { createDemoProject, createEmptyProject } from './demo'

function word(text: string, start: number, end: number, speaker = 'ryan'): Word {
  return { id: `w_${start}_${text}`, text, start, end, speaker, deleted: false }
}

function phrase(tokens: string[], t0: number, dur = 0.28, gap = 0.06): Word[] {
  let t = t0
  return tokens.map((text) => {
    const w = word(text, t, t + dur)
    t += dur + gap
    return w
  })
}

describe('margin-aware silence', () => {
  test('long dead air is a safe cut after the speech pad', () => {
    const [hit] = suggestionsFromSilence([{ start: 2, end: 8 }], 0.12)
    expect(hit.safe).toBe(true)
    expect(hit.action).toBe('cut')
    expect(hit.label).toMatch(/Dead air/)
    expect(hit.start).toBeCloseTo(2.12, 2)
    expect(hit.end).toBeCloseTo(7.88, 2)
    const padded = withCutMargin([{ start: 6.58, end: 16.02 }], 0.12)
    expect(padded[0].start).toBeCloseTo(6.7, 2)
    expect(padded[0].end).toBeCloseTo(15.9, 2)
  })

  test('tiny interior gap is a breath, never a safe cut', () => {
    const [hit] = suggestionsFromSilence([{ start: 4, end: 4.7 }], 0.12)
    expect(hit).toBeTruthy()
    expect(hit.safe).toBe(false)
    expect(hit.action).toBe('cut')
    expect(hit.label).toMatch(/Breath/)
    expect(hit.start).toBeCloseTo(4.12, 2)
    expect(hit.end).toBeCloseTo(4.58, 2)
  })

  test('leading and trailing silence use a one-sided speech pad', () => {
    const hits = suggestionsFromSilence(
      [
        { start: 0, end: 1.4 },
        { start: 18.2, end: 22 }
      ],
      0.2,
      [],
      22
    )
    const lead = hits.find((s) => /Leading/.test(s.label))
    const trail = hits.find((s) => /Trailing/.test(s.label))
    expect(lead?.start).toBeCloseTo(0, 2)
    expect(lead?.end).toBeCloseTo(1.2, 2)
    expect(lead?.safe).toBe(true)
    expect(trail?.start).toBeCloseTo(18.4, 2)
    expect(trail?.end).toBeCloseTo(22, 2)
    expect(trail?.safe).toBe(true)
  })

  test('silence over a still frame is review, not a safe cut', () => {
    const [hit] = suggestionsFromSilence([{ start: 2, end: 8 }], 0.12, [{ start: 1.8, end: 8.2 }])
    expect(hit.safe).toBe(false)
    expect(hit.action).toBe('review')
    expect(hit.label).toMatch(/still|demo/i)
    expect(leftoverKind(hit)).toBe('still')
    expect(leftoverKind({ ...hit, label: 'Breath 0.4s · 120ms pad', action: 'cut' })).toBe('breath')
  })

  test('silence with a scene change is activity review, not a safe cut', () => {
    const [hit] = suggestionsFromSilence([{ start: 2, end: 8 }], 0.12, [], 20, [3.4, 5.1])
    expect(hit.safe).toBe(false)
    expect(hit.action).toBe('review')
    expect(hit.label).toMatch(/silent activity/i)
    expect(leftoverKind(hit)).toBe('activity')
    const [dead] = suggestionsFromSilence([{ start: 2, end: 8 }], 0.12, [], 20, [0.2, 18])
    expect(dead.safe).toBe(true)
    expect(dead.label).toMatch(/Dead air/)
    expect(leftoverKind(dead)).toBe('other')
  })

  test('still wins over a scene mark so a frozen hold stays a still', () => {
    const [hit] = suggestionsFromSilence([{ start: 2, end: 8 }], 0.12, [{ start: 1.8, end: 8.2 }], 20, [4])
    expect(leftoverKind(hit)).toBe('still')
    expect(hit.safe).toBe(false)
  })

  test('word-gap breaths come from fixture words, not ffmpeg', () => {
    const words = [
      word('Hello', 1, 1.3),
      word('there', 2.0, 2.4),
      word('friends', 2.5, 3.0)
    ]
    const breaths = suggestionsFromWordGaps(words, [], 0.12)
    expect(breaths).toHaveLength(1)
    expect(breaths[0].safe).toBe(false)
    expect(breaths[0].label).toMatch(/Breath/)
    expect(breaths[0].start).toBeCloseTo(1.42, 2)
    expect(breaths[0].end).toBeCloseTo(1.88, 2)
    const covered = suggestionsFromWordGaps(words, [{ start: 1.3, end: 2.0 }], 0.12)
    expect(covered).toHaveLength(0)
  })

  test('inferred edges fill missing head and tail silence', () => {
    const words = [word('Hello', 1.2, 1.6), word('world', 1.7, 2.1)]
    const hits = suggestionsFromEdges(8, words, [], 0.12)
    expect(hits.some((s) => /Leading/.test(s.label))).toBe(true)
    expect(hits.some((s) => /Trailing/.test(s.label))).toBe(true)
    const already = suggestionsFromEdges(8, words, [{ start: 0, end: 1.2 }, { start: 2.1, end: 8 }], 0.12)
    expect(already).toHaveLength(0)
  })
})

describe('repeat precision', () => {
  test('nearby retake cuts the first take, not the keeper', () => {
    const first = phrase(['Cut', 'speech', 'like', 'text.'], 30.2)
    const second = phrase(['Cut', 'speech', 'like', 'text.'], 33.82)
    const hits = detectRepeats([...first, ...phrase(['That', 'idea'], 32.1), ...second])
    expect(hits).toHaveLength(1)
    expect(hits[0].safe).toBe(false)
    expect(hits[0].start).toBeCloseTo(30.2, 2)
    expect(hits[0].end).toBeCloseTo(first[3].end, 2)
    expect(hits[0].label).toMatch(/First take/)
  })

  test('stopword-heavy 4-grams do not count as retakes', () => {
    const a = phrase(['and', 'then', 'we', 'can'], 1)
    const b = phrase(['and', 'then', 'we', 'can'], 6)
    expect(detectRepeats([...a, ...b])).toHaveLength(0)
  })

  test('the same phrase reused later with unique speech is not a retake', () => {
    const first = phrase(['Import', 'the', 'raw', 'footage'], 1)
    const middle = phrase(
      ['Next', 'open', 'timeline', 'add', 'captions', 'zoom', 'picture', 'export', 'program'],
      4
    )
    const second = phrase(['Import', 'the', 'raw', 'footage'], 14)
    expect(detectRepeats([...first, ...middle, ...second])).toHaveLength(0)
  })
})

describe('review-not-blind detectors', () => {
  test('static and low-motion stay unsafe', () => {
    const talking = suggestionsFromStatic([{ start: 16.2, end: 22.4 }], [
      word('import', 16.8, 17.2),
      word('the', 17.26, 17.4)
    ])
    expect(talking[0].type).toBe('low-motion')
    expect(talking[0].safe).toBe(false)
    expect(talking[0].action).toBe('review')
    expect(leftoverKind(talking[0])).toBe('low-motion')
    const still = suggestionsFromStatic([{ start: 2, end: 6 }])
    expect(still[0].type).toBe('static')
    expect(still[0].safe).toBe(false)
    expect(still[0].action).toBe('speed')
    expect(leftoverKind(still[0])).toBe('static')
  })

  test('hot audio is a volume leftover, not a keep-only review', () => {
    expect(volumeTowardLufs(-8)).toBeCloseTo(0.398, 2)
    const hits = suggestionsFromLoudness([{ start: 2, end: 4, lufs: -8 }], 10)
    const hot = hits.find((s) => s.action === 'volume')
    expect(hot?.safe).toBe(false)
    expect(leftoverKind(hot!)).toBe('loud')
    expect(hot?.volume).toBeCloseTo(volumeTowardLufs(-8), 3)
    const screens = suggestionsFromStatic([{ start: 6, end: 9 }])
    const queue = leftoverReviewQueue({
      ...createEmptyProject('queue'),
      suggestions: [...screens, hot!]
    })
    expect(queue.map((s) => leftoverKind(s))).toEqual(['static', 'loud'])
    const [activity] = suggestionsFromSilence([{ start: 1, end: 6 }], 0.12, [], 12, [2.5])
    const queued = leftoverReviewQueue({
      ...createEmptyProject('activity-first'),
      suggestions: [...screens, activity, hot!]
    })
    expect(queued.map((s) => leftoverKind(s))).toEqual(['activity', 'static', 'loud'])
    expect(leftoverItems({ ...createEmptyProject('acts'), suggestions: [activity] }, 'activity')).toHaveLength(1)
  })

  test('slow pace is review only', () => {
    const words = phrase(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'], 1, 0.3, 0.8)
    const [hit] = suggestionsFromPace(words, 20)
    expect(hit.safe).toBe(false)
    expect(hit.action).toBe('review')
  })

  test('a leftover breath is found on the gap between takes', () => {
    const demo = createDemoProject()
    const leftover = leftoverForSpan(demo, 31.7, 32.1)
    expect(leftover?.id).toBe('sug_breath')
    const review = reviewGap(demo, 31.7, 32.1)
    expect(review.kind).toBe('breath')
    expect(review.chip).toMatch(/breath/)
    expect(review.title).toMatch(/hear/i)
  })

  test('a leftover click-through is found on the tiny gap before the next word', () => {
    const demo = createDemoProject()
    const leftover = leftoverForSpan(demo, 22.4, 22.72)
    expect(leftover?.id).toBe('sug_click')
    const review = reviewGap(demo, 22.4, 22.72)
    expect(review.kind).toBe('activity')
    expect(review.chip).toMatch(/silent activity/)
  })

  test('a mostly-cut first-edit pause is marked cut, not live leftover air', () => {
    const cut = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    const review = reviewGap(cut, 6.5, 16.2)
    expect(review.kind).toBe('cut')
    expect(review.chip).toMatch(/cut/)
  })
})

describe('guards punch holes', () => {
  test('cutMinusProtected splits around keep and demo tags', () => {
    const pieces = cutMinusProtected({ start: 1, end: 10 }, [
      { id: 'k', start: 4, end: 6, kind: 'keep', label: 'keep' },
      { id: 'd', start: 8, end: 12, kind: 'demo', label: 'demo' }
    ])
    expect(pieces).toEqual([
      { start: 1, end: 4 },
      { start: 6, end: 8 }
    ])
    const blocked = annotateProtected(
      [{ id: 's', type: 'silence', start: 4, end: 6, action: 'cut', label: 'air', safe: true, applied: false }],
      [{ id: 'k', start: 4, end: 6, kind: 'keep', label: 'keep' }]
    )
    expect(blocked[0].safe).toBe(false)
    expect(blocked[0].blockedBy).toBe('k')
  })
})

describe('import and rebuild wiring', () => {
  test('buildSuggestions classifies fixture gaps the same way import does', () => {
    const words = [
      word('Hello', 1.1, 1.4),
      word('team', 2.1, 2.5),
      ...phrase(['Ship', 'local', 'video', 'tools'], 4),
      word('Wait', 8.2, 8.5),
      ...phrase(['Ship', 'local', 'video', 'tools'], 9.2)
    ]
    const suggestions = buildSuggestions({
      duration: 16,
      silence: [
        { start: 0, end: 1.1 },
        { start: 2.5, end: 3.9 },
        { start: 12.4, end: 16 }
      ],
      sceneHits: [{ start: 4, end: 7.2 }],
      loudnessWindows: [],
      words,
      margin: 0.12
    })
    expect(suggestions.some((s) => /Leading/.test(s.label) && s.safe)).toBe(true)
    expect(suggestions.some((s) => /Trailing/.test(s.label) && s.safe)).toBe(true)
    expect(suggestions.some((s) => /Breath/.test(s.label) && !s.safe)).toBe(true)
    expect(suggestions.some((s) => /Dead air/.test(s.label) && s.safe)).toBe(true)
    expect(suggestions.some((s) => s.type === 'repeat' && !s.safe && s.start < 8)).toBe(true)
    expect(suggestions.some((s) => s.type === 'low-motion' && !s.safe)).toBe(true)
    expect(suggestions.filter((s) => s.safe && s.action === 'cut').every((s) => !/Breath/.test(s.label))).toBe(
      true
    )
  })

  test('rebuildSuggestions emits breaths and edges; safe apply skips them', () => {
    const words = [
      word('Hello', 1.2, 1.5),
      word('there', 2.2, 2.6),
      word('friends', 6.0, 6.5)
    ]
    const project = {
      ...createEmptyProject('Fixture'),
      sourceDuration: 10,
      transcript: { words, speakers: [{ id: 'ryan', name: 'Ryan', color: '#C4452D' }] },
      analysis: {
        silence: [
          { start: 0, end: 1.2 },
          { start: 2.6, end: 5.8 }
        ],
        staticRegions: [],
        loudness: []
      }
    }
    const rebuilt = applyCommand(project, { type: 'rebuildSuggestions' })
    expect(rebuilt.suggestions.some((s) => /Leading/.test(s.label))).toBe(true)
    expect(rebuilt.suggestions.some((s) => /Trailing/.test(s.label))).toBe(true)
    const breath = rebuilt.suggestions.find((s) => /Breath/.test(s.label))
    const dead = rebuilt.suggestions.find((s) => /Dead air/.test(s.label))
    expect(breath?.safe).toBe(false)
    expect(dead?.safe).toBe(true)
    const applied = applyCommand(rebuilt, { type: 'applySafeSuggestions' })
    expect(applied.suggestions.find((s) => s.id === breath?.id)?.applied).toBe(false)
    expect(applied.suggestions.find((s) => s.id === dead?.id)?.applied).toBe(true)
    expect(programLength(applied)).toBeLessThan(programLength(rebuilt))
  })

  test('suggestionsFromGaps is what setCutMargin / import share', () => {
    const words = [word('Hi', 0.8, 1.1), word('again', 1.8, 2.2)]
    const hits = suggestionsFromGaps({
      duration: 6,
      silence: [{ start: 2.2, end: 6 }],
      words,
      margin: 0.15
    })
    expect(hits.some((s) => /Trailing/.test(s.label))).toBe(true)
    expect(hits.some((s) => /Breath/.test(s.label))).toBe(true)
  })
})
