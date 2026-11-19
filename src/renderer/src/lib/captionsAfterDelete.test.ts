import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { captionClipsOf } from './captions'
import { createEmptyProject } from './demo'
import type { Project } from '../types'

const SPOKEN = 'ask not what your country can do for you ask what you can do for your country'.split(' ')

function captioned(): Project {
  const base = { ...createEmptyProject('caption-delete'), sourceDuration: 9 }
  const words = SPOKEN.map((text, i) => ({
    id: `w${i}`,
    text,
    start: i * 0.5,
    end: i * 0.5 + 0.4,
    speaker: 'a',
    deleted: false
  }))
  const withWords = applyCommand(base, { type: 'setTranscript', words })
  return applyCommand(withWords, { type: 'generateCaptions', maxWords: 5, emphasize: false })
}

function ordered(project: Project) {
  return captionClipsOf(project).sort((a, b) => a.start - b.start)
}

function overlaps(project: Project): boolean {
  const clips = ordered(project)
  return clips.some((clip, i) => i > 0 && clip.start < clips[i - 1].start + clips[i - 1].duration - 1e-6)
}

describe('auto captions after deleting words', () => {
  test('generated captions start without overlap', () => {
    expect(overlaps(captioned())).toBe(false)
  })

  test('deleting words inside a card trims its text and length so the next card does not overlap it', () => {
    const before = captioned()
    const after = applyCommand(before, { type: 'toggleWords', wordIds: ['w1', 'w2', 'w3'] })
    const clips = ordered(after)
    expect(clips[0].text).toBe('ask country')
    expect(clips[0].duration).toBeLessThan(ordered(before)[0].duration)
    expect(overlaps(after)).toBe(false)
    // Cards whose words are all still present keep their identity and text.
    expect(clips.slice(1).map((clip) => clip.id)).toEqual(ordered(before).slice(1).map((clip) => clip.id))
    expect(clips.slice(1).map((clip) => clip.text)).toEqual(ordered(before).slice(1).map((clip) => clip.text))
  })

  test('deleting every word of a card removes the card and ripples the next card to the front', () => {
    const before = captioned()
    const after = applyCommand(before, { type: 'toggleWords', wordIds: ['w0', 'w1', 'w2', 'w3', 'w4'] })
    const clips = ordered(after)
    expect(clips.length).toBe(ordered(before).length - 1)
    expect(clips.some((clip) => /ask not/.test(clip.text ?? ''))).toBe(false)
    expect(clips[0].start).toBeLessThan(0.2)
    expect(overlaps(after)).toBe(false)
  })

  test('deleting words across two cards leaves no stale words and no overlap', () => {
    const after = applyCommand(captioned(), { type: 'toggleWords', wordIds: ['w3', 'w4', 'w5', 'w6', 'w7'] })
    const text = ordered(after).map((clip) => clip.text).join(' ')
    for (const gone of ['your country can do for']) expect(text).not.toContain(gone)
    expect(overlaps(after)).toBe(false)
  })

  test('manually edited cards are left alone', () => {
    const before = captioned()
    const target = ordered(before)[0]
    const edited = applyCommand(before, { type: 'setText', clipId: target.id, text: 'My own title' })
    const after = applyCommand(edited, { type: 'toggleWords', wordIds: ['w1', 'w2'] })
    expect(captionClipsOf(after).find((clip) => clip.id === target.id)?.text).toBe('My own title')
  })

  test('captions stay overlap-free through repeated deletes', () => {
    let project = captioned()
    for (const ids of [['w9'], ['w1', 'w2'], ['w12', 'w13', 'w14'], ['w5']]) {
      project = applyCommand(project, { type: 'toggleWords', wordIds: ids })
      expect(overlaps(project)).toBe(false)
    }
  })
})
