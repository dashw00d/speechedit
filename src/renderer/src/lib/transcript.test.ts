import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { applyCommand } from './commands'
import { createEmptyProject } from './demo'
import { normalizeProject } from './normalize'
import {
  parseAnyTranscript,
  parseTranscriptJson,
  takeWordsNeedReplace,
  transcriptIsPlaceholder,
  wordsFromIslands
} from './transcript'

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
