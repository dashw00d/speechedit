import { describe, expect, test } from 'bun:test'
import {
  coerceTranscriptKind,
  expandAsrCues,
  looksWordLevel,
  parseAsrPayload,
  presetIdFor,
  transcriptionsUrl,
  TRANSCRIPT_PROVIDERS
} from '../../../shared/asr'
import { wordsFromAsr, wordsFromCues } from './asr'

const whisperWords = {
  text: 'Hello there world',
  segments: [
    {
      start: 0,
      end: 2,
      text: 'Hello there world',
      words: [
        { word: 'Hello', start: 0.1, end: 0.4 },
        { word: 'there', start: 0.45, end: 0.7 },
        { word: 'world', start: 0.75, end: 1.1 }
      ]
    }
  ]
}

const openaiVerbose = {
  text: 'Hello world',
  words: [
    { word: 'Hello', start: 1.2, end: 1.5 },
    { word: 'world', start: 1.6, end: 2.0 }
  ],
  segments: [{ start: 1.2, end: 2.0, text: 'Hello world' }]
}

const phraseOnly = {
  segments: [{ start: 4, end: 6, text: 'Hello there' }]
}

const cppJson = {
  transcription: [
    {
      text: ' Hello',
      offsets: { from: 0, to: 400 },
      tokens: [
        { text: ' Hello', offsets: { from: 0, to: 400 }, t0: 0, t1: 40 },
        { text: ' world', offsets: { from: 420, to: 900 }, t0: 42, t1: 90 }
      ]
    }
  ]
}

describe('ASR catalog', () => {
  test('covers local OSS and HTTP APIs', () => {
    const kinds = new Set(TRANSCRIPT_PROVIDERS.map((p) => p.kind))
    expect(kinds.has('whisper-cli')).toBe(true)
    expect(kinds.has('faster-whisper')).toBe(true)
    expect(kinds.has('whisper-cpp')).toBe(true)
    expect(kinds.has('mlx-whisper')).toBe(true)
    expect(kinds.has('openai-compatible')).toBe(true)
    expect(kinds.has('off')).toBe(true)
    expect(TRANSCRIPT_PROVIDERS.some((p) => p.id === 'groq')).toBe(true)
    expect(TRANSCRIPT_PROVIDERS.some((p) => p.id === 'local')).toBe(true)
  })

  test('coerces unknown kinds and matches presets', () => {
    expect(coerceTranscriptKind('faster-whisper')).toBe('faster-whisper')
    expect(coerceTranscriptKind('nope')).toBe('whisper-cli')
    expect(presetIdFor('openai-compatible', 'https://api.groq.com/openai/v1')).toBe('groq')
    expect(presetIdFor('whisper-cli', '')).toBe('whisper-cli')
    expect(transcriptionsUrl('http://127.0.0.1:8000/v1/')).toBe(
      'http://127.0.0.1:8000/v1/audio/transcriptions'
    )
  })
})

describe('ASR parse — word timestamps win', () => {
  test('uses segment.words[] times instead of linearly splitting the phrase', () => {
    const result = parseAsrPayload(whisperWords, 'whisper-cli')
    expect(result?.wordLevel).toBe(true)
    expect(result?.cues.map((c) => c.text)).toEqual(['Hello', 'there', 'world'])
    expect(result?.cues.map((c) => [c.start, c.end])).toEqual([
      [0.1, 0.4],
      [0.45, 0.7],
      [0.75, 1.1]
    ])
    const expanded = expandAsrCues(result!.cues, result!.wordLevel)
    expect(expanded[0].start).toBe(0.1)
    expect(expanded[0].end).toBe(0.4)
    expect(expanded[1].start).toBe(0.45)
  })

  test('WhisperX speaker labels stay on word cues', () => {
    const result = parseAsrPayload({
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
    })
    expect(result?.cues.map((c) => [c.text, c.speaker])).toEqual([
      ['Hello', 'SPEAKER_00'],
      ['world', 'SPEAKER_01']
    ])
  })

  test('prefers top-level OpenAI/Groq words[] over segment phrases', () => {
    const result = parseAsrPayload(openaiVerbose, 'openai-compatible')
    expect(result?.wordLevel).toBe(true)
    expect(result?.cues).toEqual([
      { text: 'Hello', start: 1.2, end: 1.5 },
      { text: 'world', start: 1.6, end: 2.0 }
    ])
  })

  test('whisper.cpp tokens keep millisecond offsets (not invented)', () => {
    const result = parseAsrPayload(cppJson, 'whisper-cpp')
    expect(result?.wordLevel).toBe(true)
    expect(result?.cues).toEqual([
      { text: 'Hello', start: 0, end: 0.4 },
      { text: 'world', start: 0.42, end: 0.9 }
    ])
  })

  test('phrase-only segments may split later; parse does not invent words[]', () => {
    const result = parseAsrPayload(phraseOnly, 'whisper-cli')
    expect(result?.wordLevel).toBe(false)
    expect(result?.cues).toEqual([{ text: 'Hello there', start: 4, end: 6 }])
  })

  test('stdout noise still yields JSON', () => {
    const raw = 'detecting language\n{"words":[{"word":"Hi","start":0.2,"end":0.4}]}\n'
    const result = parseAsrPayload(raw, 'whisper-cli')
    expect(result?.cues[0]).toEqual({ text: 'Hi', start: 0.2, end: 0.4 })
    expect(result?.wordLevel).toBe(true)
  })
})

describe('cues → Word[]', () => {
  test('word-level cues keep provider times', () => {
    const words = wordsFromCues(
      [
        { text: 'Hello', start: 0.1, end: 0.4 },
        { text: 'world', start: 0.75, end: 1.1 }
      ],
      { wordLevel: true }
    )
    expect(words.map((w) => [w.text, w.start, w.end])).toEqual([
      ['Hello', 0.1, 0.4],
      ['world', 0.75, 1.1]
    ])
    expect(words.every((w) => w.id.startsWith('w'))).toBe(true)
  })

  test('phrase cues split only when words[] were absent', () => {
    const words = wordsFromAsr({
      cues: [{ text: 'Hello there', start: 4, end: 6 }],
      wordLevel: false,
      provider: 'whisper-cli'
    })
    expect(words.map((w) => w.text)).toEqual(['Hello', 'there'])
    expect(words[0].start).toBe(4)
    expect(words[0].end).toBe(5)
    expect(words[1].start).toBe(5)
    expect(words[1].end).toBe(6)
  })

  test('looksWordLevel is true for single-token cue lists', () => {
    expect(looksWordLevel([{ text: 'Hi', start: 0, end: 0.2 }])).toBe(true)
    expect(looksWordLevel([{ text: 'Hi there', start: 0, end: 1 }])).toBe(false)
  })

  test('empty / null ASR yields no words so import can fall back to islands', () => {
    expect(wordsFromAsr(null)).toEqual([])
    expect(wordsFromAsr([])).toEqual([])
    expect(parseAsrPayload({ text: 'no times' })).toBeNull()
  })
})
