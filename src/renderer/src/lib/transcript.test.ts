import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { applyCommand, programLength } from './commands'
import { createEmptyProject } from './demo'
import { normalizeProject } from './normalize'
import {
  parseAnyTranscript,
  parseTranscriptJson,
  takeWordsNeedReplace,
  transcriptIsPlaceholder,
  wordsFromIslands
} from './transcript'
import { currentWord, overlap } from './edl'
import { wordsFromCues } from './asr'

const whisperCli = {
  text: 'Hello there um world',
  segments: [
    {
      start: 0.1,
      end: 1.4,
      text: ' Hello there um world',
      words: [
        { word: 'Hello', start: 0.1, end: 0.32 },
        { word: 'there', start: 0.36, end: 0.55 },
        { word: 'um', start: 0.62, end: 0.78 },
        { word: 'world', start: 0.9, end: 1.35 }
      ]
    }
  ]
}

const whisperX = {
  segments: [
    {
      start: 0,
      end: 2,
      text: 'Hello world',
      speaker: 'SPEAKER_00',
      words: [
        { word: 'Hello', start: 0.2, end: 0.5, speaker: 'SPEAKER_00' },
        { word: 'world', start: 0.6, end: 1.1, speaker: 'SPEAKER_01' }
      ]
    }
  ]
}

describe('drop / open transcript JSON', () => {
  test('legacy BLANK_AUDIO project rows are removed when a reel opens', () => {
    const project = createEmptyProject('legacy-blank')
    project.transcript.words = [
      { id: 'blank', text: '[BLANK_AUDIO]', start: 0, end: 1, speaker: 'ryan', deleted: false },
      { id: 'hello', text: 'Hello', start: 1, end: 1.4, speaker: 'ryan', deleted: false }
    ]
    expect(normalizeProject(project).transcript.words.map((word) => word.text)).toEqual(['Hello'])
  })

  test('SpeechEdit words[] and samples/transcript.json still land', () => {
    const sample = parseTranscriptJson(
      JSON.parse(readFileSync(new URL('../../../../samples/transcript.json', import.meta.url), 'utf8'))
    )
    expect(sample.map((w) => w.text)).toEqual(['Hello', 'from', 'a', 'dropped', 'transcript.'])
    const kept = parseTranscriptJson({
      words: [{ id: 'w_keep', text: 'Kept', start: 1, end: 2, speaker: 'ryan', deleted: true }]
    })
    expect(kept[0]).toMatchObject({ id: 'w_keep', deleted: true, text: 'Kept' })
  })

  test('native SpeechEdit words[] with a zero-duration row stays highlightable', () => {
    const words = parseTranscriptJson({
      words: [
        { id: 'a', text: 'Hello', start: 0, end: 0.3, speaker: 'ryan', deleted: false },
        { id: 'zero', text: 'uh', start: 0.3, end: 0.3, speaker: 'ryan', deleted: false },
        { id: 'b', text: 'world', start: 0.3, end: 0.6, speaker: 'ryan', deleted: false }
      ]
    })
    const zero = words.find((w) => w.id === 'zero')
    // Flush to `world`: keep the zero-duration timestamp so a cut is safe…
    expect([zero!.start, zero!.end]).toEqual([0.3, 0.3])
    // …highlighting is separate from cutting and still reaches the token.
    expect(currentWord(words, zero!.start)?.id).toBe('zero')
  })

  test('SPE-10 P1: deleting a flush zero-duration filler leaves the following word intact', () => {
    const words = wordsFromCues(
      [
        { text: 'hello', start: 0, end: 0.3 },
        { text: 'uh', start: 0.3, end: 0.3 },
        { text: 'world', start: 0.3, end: 0.6 }
      ],
      { wordLevel: true }
    )
    const base = createEmptyProject('zero-flush')
    const project = { ...base, sourceDuration: 1, transcript: { ...base.transcript, words } }
    const uh = project.transcript.words.find((w) => w.text === 'uh')!
    const removed = applyCommand(project, { type: 'toggleWords', wordIds: [uh.id] })
    expect(removed.transcript.words.find((w) => w.text === 'uh')!.deleted).toBe(true)
    const world = removed.transcript.words.find((w) => w.text === 'world')!
    expect(world.deleted).toBe(false)
    expect([world.start, world.end]).toEqual([0.3, 0.6])
    expect(removed.cuts.some((cut) => overlap(cut, { start: 0.3, end: 0.6 }) > 0)).toBe(false)
    expect(programLength(removed)).toBeCloseTo(programLength(project), 5)
    const restored = applyCommand(removed, { type: 'toggleWords', wordIds: [uh.id] })
    expect(restored.transcript.words.find((w) => w.text === 'uh')!.deleted).toBe(false)
  })

  test('SPE-10 P2: a zero-duration token at recording start is reachable and cut-safe', () => {
    const words = wordsFromCues(
      [
        { text: 'uh', start: 0, end: 0 },
        { text: 'world', start: 0, end: 0.6 }
      ],
      { wordLevel: true }
    )
    const base = createEmptyProject('zero-start')
    const project = { ...base, sourceDuration: 1, transcript: { ...base.transcript, words } }
    const uh = project.transcript.words.find((w) => w.text === 'uh')!
    // Never borrow past the recording start into a negative timestamp.
    expect([uh.start, uh.end]).toEqual([0, 0])
    expect(currentWord(project.transcript.words, 0)?.text).toBe('uh')
    const removed = applyCommand(project, { type: 'toggleWords', wordIds: [uh.id] })
    expect(removed.transcript.words.find((w) => w.text === 'uh')!.deleted).toBe(true)
    const world = removed.transcript.words.find((w) => w.text === 'world')!
    expect(world.deleted).toBe(false)
    expect([world.start, world.end]).toEqual([0, 0.6])
    expect(removed.cuts.some((cut) => overlap(cut, { start: 0, end: 0.6 }) > 0)).toBe(false)
  })

  test('deleting a zero-duration token does not split the following word (jfk geometry)', () => {
    // Real whisper.cpp jfk geometry: ask @8.24 (gap before; what @8.29).
    const words = wordsFromCues(
      [
        { text: 'you', start: 7.0, end: 7.55 },
        { text: 'ask', start: 8.24, end: 8.24 },
        { text: 'what', start: 8.29, end: 8.49 }
      ],
      { wordLevel: true }
    )
    const base = createEmptyProject('zero-token')
    const project = { ...base, sourceDuration: 12, transcript: { ...base.transcript, words } }
    const ask = words.find((w) => w.text === 'ask')!
    expect(ask.end).toBeLessThanOrEqual(8.29)
    const cut = applyCommand(project, { type: 'toggleWords', wordIds: [ask.id] })
    const whats = cut.transcript.words.filter((w) => w.text === 'what')
    expect(whats).toHaveLength(1)
    expect(whats[0].deleted).toBe(false)
    expect([whats[0].start, whats[0].end]).toEqual([8.29, 8.49])
  })

  test('same-start zero token borrows the preceding gap without splitting the next word', () => {
    // Real geometry: or @38.42 next word also @38.42, with a gap before.
    const words = wordsFromCues(
      [
        { text: 'so', start: 38.0, end: 38.27 },
        { text: 'or', start: 38.42, end: 38.42 },
        { text: 'not', start: 38.42, end: 38.62 }
      ],
      { wordLevel: true }
    )
    const base = createEmptyProject('zero-token-same-start')
    const project = { ...base, sourceDuration: 40, transcript: { ...base.transcript, words } }
    const token = words.find((w) => w.text === 'or')!
    expect(token.end).toBeLessThanOrEqual(38.42)
    const cut = applyCommand(project, { type: 'toggleWords', wordIds: [token.id] })
    const nots = cut.transcript.words.filter((w) => w.text === 'not')
    expect(nots).toHaveLength(1)
    expect(nots[0].deleted).toBe(false)
  })

  test('openai-whisper segments.words[] keep provider times (no lerp)', () => {
    const words = parseTranscriptJson(whisperCli)
    expect(words.map((w) => [w.text, w.start, w.end])).toEqual([
      ['Hello', 0.1, 0.32],
      ['there', 0.36, 0.55],
      ['um', 0.62, 0.78],
      ['world', 0.9, 1.35]
    ])
  })

  test('samples/whisper.json matches the Whisper CLI drop path', () => {
    const words = parseAnyTranscript(
      'take.json',
      readFileSync(new URL('../../../../samples/whisper.json', import.meta.url), 'utf8')
    )
    expect(words.map((w) => w.text)).toEqual(['Hello', 'there', 'um', 'world'])
    expect(words[2].start).toBe(0.62)
  })

  test('whisper.cpp and OpenAI verbose_json land as words', () => {
    const cpp = parseAnyTranscript(
      'out.json',
      JSON.stringify({
        transcription: [
          {
            text: ' Hello',
            offsets: { from: 0, to: 400 },
            tokens: [
              { text: ' Hello', offsets: { from: 0, to: 400 } },
              { text: ' um', offsets: { from: 420, to: 600 } }
            ]
          }
        ]
      })
    )
    expect(cpp.map((w) => [w.text, w.start, w.end])).toEqual([
      ['Hello', 0, 0.4],
      ['um', 0.42, 0.6]
    ])
    const openai = parseTranscriptJson({
      words: [
        { word: 'Hello', start: 1.2, end: 1.5 },
        { word: 'world', start: 1.6, end: 2.0 }
      ],
      segments: [{ start: 1.2, end: 2.0, text: 'Hello world' }]
    })
    expect(openai.map((w) => w.text)).toEqual(['Hello', 'world'])
    expect(openai[0].start).toBe(1.2)
  })

  test('setTranscript is undoable and registers WhisperX speakers + filler suggestions', () => {
    const islands = applyCommand(createEmptyProject('take'), {
      type: 'setTranscript',
      words: [{ id: 'island', text: 'Speech 1', start: 0, end: 2, speaker: 'ryan', deleted: false }]
    })
    const landed = applyCommand(islands, { type: 'setTranscript', words: parseTranscriptJson(whisperX) })
    expect(landed.transcript.words.map((w) => w.text)).toEqual(['Hello', 'world'])
    expect(landed.transcript.words.map((w) => w.speaker)).toEqual(['spk_00', 'spk_01'])
    expect(landed.transcript.speakers.some((s) => s.name === 'Speaker 0')).toBe(true)
    expect(landed.transcript.speakers.some((s) => s.name === 'Speaker 1')).toBe(true)

    const whisper = applyCommand(createEmptyProject('take'), {
      type: 'setTranscript',
      words: parseTranscriptJson(whisperCli)
    })
    expect(whisper.suggestions.some((s) => s.type === 'filler' && /um/i.test(s.label))).toBe(true)
    expect(whisper.transcript.words).not.toEqual(islands.transcript.words)
  })

  test('garbage JSON fails closed with an actionable error', () => {
    expect(() => parseTranscriptJson({ text: 'no times' })).toThrow(/Whisper segments|words array/)
    expect(() => parseAnyTranscript('bad.json', '{')).toThrow(/not valid/)
  })

  test('takeWordsNeedReplace grows ASR and keeps a dropped transcript', () => {
    const word = (text: string, start: number, end: number) => ({
      id: text,
      text,
      start,
      end,
      speaker: 'ryan',
      deleted: false
    })
    expect(takeWordsNeedReplace([], [word('hello', 0.2, 0.6)])).toBe(true)
    expect(takeWordsNeedReplace([word('Speech 1', 0, 2)], [word('hello', 0.2, 0.6)])).toBe(true)
    expect(
      takeWordsNeedReplace([word('hello', 0.2, 0.6)], [word('hello', 0.2, 0.6), word('world', 9.5, 10.1)])
    ).toBe(true)
    expect(takeWordsNeedReplace([word('already here', 0.2, 0.6)], [word('whisper', 0.2, 0.5)])).toBe(false)
  })

  test('silence islands are marked so they cannot pass as spoken words', () => {
    const islands = wordsFromIslands([
      { start: 0, end: 2 },
      { start: 3.2, end: 5 }
    ])
    expect(islands.map((w) => w.origin)).toEqual(['island', 'island'])
    expect(transcriptIsPlaceholder(islands)).toBe(true)
    expect(transcriptIsPlaceholder([])).toBe(true)
    expect(transcriptIsPlaceholder([{ ...islands[0], text: 'Hello', origin: undefined }])).toBe(false)
  })
})
