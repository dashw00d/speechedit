import { describe, expect, test } from 'bun:test'
import { applyAutoCaptions, emptyCaptionSession } from './firstEdit'
import { applyCommand, programLength } from './commands'
import { projectToExportJob } from './exportJob'
import {
  captionClipsOf,
  shouldAutoCaption,
  transcriptReadyForCaptions,
  wordsToCaptions
} from './captions'
import { createEmptyProject } from './demo'
import { useEditor } from '../store'

function word(text: string, start: number, end: number) {
  return { id: text, text, start, end, speaker: 'ryan', deleted: false }
}

function spokenProject() {
  return applyCommand(createEmptyProject('caps'), {
    type: 'setTranscript',
    words: [word('hello', 0.2, 0.6), word('world', 0.7, 1.1)]
  })
}

describe('auto captions from words', () => {
  test('wordsToCaptions skips speech-island placeholders', () => {
    const islands = applyCommand(createEmptyProject('islands'), {
      type: 'setTranscript',
      words: [word('Speech 1', 0, 2), word('Speech 2', 3, 5)]
    })
    expect(transcriptReadyForCaptions(islands)).toBe(false)
    expect(wordsToCaptions(islands)).toEqual([])
    expect(shouldAutoCaption(islands)).toBe(false)
  })

  test('generated clips are auto and sit on program time', () => {
    const clips = wordsToCaptions(spokenProject(), { maxWords: 5, emphasize: false })
    expect(clips.length).toBeGreaterThan(0)
    expect(clips.every((clip) => clip.auto && clip.text)).toBe(true)
    expect(clips[0]?.text).toMatch(/hello/)
    const shown = applyCommand(spokenProject(), { type: 'generateCaptions', maxWords: 5, emphasize: false })
    expect(shown.tracks.find((track) => track.type === 'caption')?.hidden).toBe(false)
  })

  test('generateCaptions does not wipe the lane when there are no real words', () => {
    const titled = applyCommand(createEmptyProject('keep'), {
      type: 'addCaption',
      start: 0,
      duration: 2,
      text: 'Keep me'
    })
    const next = applyCommand(titled, { type: 'generateCaptions', maxWords: 5 })
    expect(captionClipsOf(next).map((clip) => clip.text)).toEqual(['Keep me'])
  })

  test('editing a caption locks the lane against auto refresh', () => {
    const generated = applyCommand(spokenProject(), { type: 'generateCaptions', maxWords: 5, emphasize: false })
    expect(shouldAutoCaption(generated)).toBe(true)
    const clip = captionClipsOf(generated)[0]
    const edited = applyCommand(generated, { type: 'setText', clipId: clip.id, text: 'Edited' })
    expect(captionClipsOf(edited)[0]?.auto).toBe(false)
    expect(shouldAutoCaption(edited)).toBe(false)
  })

  test('applyAutoCaptions is one undo, then patches, and respects undo', () => {
    useEditor.getState().loadProject(spokenProject(), { path: null, clean: false })
    const session = emptyCaptionSession()
    expect(applyAutoCaptions(session)).toBe(true)
    expect(captionClipsOf(useEditor.getState().project).length).toBeGreaterThan(0)
    useEditor.getState().patch({
      type: 'setTranscript',
      words: [word('hello', 0.2, 0.6), word('world', 0.7, 1.1), word('again', 1.4, 1.8)]
    })
    expect(applyAutoCaptions(session)).toBe(true)
    expect(captionClipsOf(useEditor.getState().project).some((clip) => clip.text?.includes('again'))).toBe(true)
    useEditor.getState().undo()
    expect(captionClipsOf(useEditor.getState().project)).toEqual([])
    expect(applyAutoCaptions(session)).toBe(false)
    expect(session.skipCaptions).toBe(true)
  })

  test('export burns synthesized captions when the lane is empty', () => {
    const job = projectToExportJob(spokenProject())
    expect(job.layers.some((layer) => layer.kind === 'caption' && /hello/i.test(layer.text))).toBe(true)
    const off = projectToExportJob(spokenProject(), '', { burnCaptions: false })
    expect(off.layers.some((layer) => layer.kind === 'caption')).toBe(false)
  })

  test('setSpeed ripples later captions so they stay on the shortened program', () => {
    let project = applyCommand(
      { ...createEmptyProject('speed-caps'), sourceDuration: 10 },
      {
        type: 'setTranscript',
        words: [word('hello', 0.2, 0.6), word('world', 8.6, 9.85)]
      }
    )
    project = applyCommand(project, { type: 'generateCaptions', maxWords: 5, emphasize: false })
    const late = captionClipsOf(project).find((clip) => /world/i.test(clip.text ?? ''))
    expect(late?.start).toBeGreaterThan(8)
    project = applyCommand(project, { type: 'setSpeed', start: 2, end: 6, speed: 4 })
    const moved = captionClipsOf(project).find((clip) => clip.id === late?.id)
    expect(moved?.start).toBeCloseTo((late?.start ?? 0) - 3, 1)
    expect(programLength(project)).toBeCloseTo(7, 1)
  })
})
