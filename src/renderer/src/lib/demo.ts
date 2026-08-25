import {
  DEFAULT_ANALYSIS,
  DEFAULT_AUDIO_MASTER,
  DEFAULT_CAPTION_STYLE,
  DEFAULT_TRANSFORM,
  emptyClipFields,
  type Asset,
  type Project,
  type Word
} from '../types'
import { detectFillers, detectRepeats, suggestionsFromSilence } from './analysis'
import { parseTranscriptJson } from './transcript'
import { uid } from './time'

function word(
  text: string,
  start: number,
  end: number,
  speaker = 'ryan',
  deleted = false
): Word {
  return { id: uid('w'), text, start, end, speaker, deleted }
}

function sineWaveform(samples = 1400): number[] {
  return Array.from({ length: samples }, (_, i) => {
    const t = i / samples
    const speech = t > 0.08 && t < 0.29 || t > 0.36 && t < 0.72 || t > 0.78 && t < 0.96
    const envelope = speech ? 0.35 + 0.65 * Math.abs(Math.sin(t * 38)) : 0.04 + 0.05 * Math.random()
    return Math.min(1, envelope * (0.7 + 0.3 * Math.sin(t * 220)))
  })
}

export function createEmptyProject(name = 'Untitled'): Project {
  const now = Date.now()
  return {
    id: uid('prj'),
    name,
    fps: 30,
    width: 1920,
    height: 1080,
    sourceDuration: 0,
    assets: {},
    tracks: [
      { id: 'v3', type: 'caption', name: 'V3 Captions', locked: false, muted: false, hidden: false, clips: [] },
      { id: 'v2', type: 'overlay', name: 'V2 Overlay', locked: false, muted: false, hidden: false, clips: [] },
      { id: 'v1', type: 'video', name: 'V1 Picture', locked: false, muted: false, hidden: false, clips: [] },
      { id: 'a1', type: 'audio', name: 'A1 Voice', locked: false, muted: false, hidden: false, clips: [] }
    ],
    transcript: {
      words: [],
      speakers: [{ id: 'ryan', name: 'Speaker 1', color: '#C4452D' }]
    },
    cuts: [],
    splits: [],
    styles: [],
    suggestions: [],
    scenes: [],
    tags: [],
    picture: { ...DEFAULT_TRANSFORM },
    audioMaster: { ...DEFAULT_AUDIO_MASTER },
    cutMargin: 0.12,
    encoder: 'auto',
    analysis: { ...DEFAULT_ANALYSIS },
    markIn: null,
    markOut: null,
    createdAt: now,
    updatedAt: now
  }
}

export function createDemoProject(): Project {
  const asset: Asset = {
    id: 'demo_src',
    path: '',
    name: 'studio-demo.wav',
    kind: 'audio',
    duration: 46.2,
    waveform: sineWaveform()
  }

  const words: Word[] = [
    word('So', 0.42, 0.62),
    word('today', 0.66, 1.08),
    word('um', 1.22, 1.48),
    word("we're", 1.7, 1.98),
    word('going', 2.02, 2.28),
    word('to', 2.3, 2.42),
    word('build', 2.48, 2.82),
    word('a', 2.86, 2.96),
    word('local', 3.02, 3.38),
    word('video', 3.44, 3.78),
    word('editor', 3.84, 4.36),
    word('that', 4.62, 4.84),
    word('cuts', 4.9, 5.22),
    word('from', 5.28, 5.5),
    word('the', 5.54, 5.68),
    word('transcript.', 5.74, 6.5),
    word('First', 16.2, 16.52),
    word("I'll", 16.56, 16.78),
    word('import', 16.84, 17.22),
    word('the', 17.26, 17.4),
    word('recording,', 17.46, 18.1),
    word('then', 18.4, 18.66),
    word("we'll", 18.7, 18.92),
    word('strip', 18.98, 19.3),
    word('the', 19.34, 19.48),
    word('dead', 19.54, 19.8),
    word('air', 19.86, 20.14),
    word('and', 20.28, 20.46),
    word('you', 20.62, 20.8),
    word('know', 20.84, 21.08),
    word('the', 21.28, 21.42),
    word('filler', 21.48, 21.84),
    word('words.', 21.9, 22.4),
    word('Like', 22.72, 23.0),
    word('this', 23.06, 23.28),
    word('one.', 23.32, 23.7),
    word('Cut', 30.2, 30.48),
    word('speech', 30.52, 30.9),
    word('like', 30.94, 31.18),
    word('text.', 31.22, 31.7),
    word("That's", 32.1, 32.4),
    word('the', 32.44, 32.58),
    word('whole', 32.64, 32.92),
    word('idea.', 32.98, 33.5),
    word('Cut', 33.82, 34.08),
    word('speech', 34.14, 34.52),
    word('like', 34.58, 34.8),
    word('text.', 34.86, 35.4),
    word('Zoom', 35.7, 36.0),
    word('the', 36.04, 36.16),
    word('screen', 36.2, 36.56),
    word('when', 36.62, 36.82),
    word("I'm", 36.86, 37.02),
    word('typing,', 37.08, 37.6),
    word('caption', 37.86, 38.3),
    word('everything,', 38.36, 39.1),
    word('and', 39.28, 39.44),
    word('never', 39.5, 39.8),
    word('open', 39.86, 40.12),
    word('Shotcut', 40.2, 40.7),
    word('again.', 40.78, 41.3)
  ]

  const project = createEmptyProject('Studio demo')
  const silence = [
    { start: 6.58, end: 16.02 },
    { start: 23.78, end: 29.85 }
  ]
  return {
    ...project,
    sourceDuration: asset.duration,
    assets: { [asset.id]: asset },
    analysis: {
      silence,
      staticRegions: [{ start: 16.2, end: 22.4 }],
      loudness: [
        { start: 4, end: 6.4, lufs: -10.8 },
        { start: 18, end: 20, lufs: -26 }
      ]
    },
    transcript: {
      speakers: [
        { id: 'ryan', name: 'Ryan', color: '#C4452D' }
      ],
      words
    },
    tags: [
      {
        id: 'tag_demo',
        start: 24.4,
        end: 27.8,
        kind: 'demo',
        label: 'Silent product walkthrough'
      }
    ],
    scenes: [
      {
        id: 'sc_intro',
        start: 0.42,
        end: 6.5,
        title: 'Thesis',
        summary: 'Cut speech like text — the pitch.',
        kind: 'talk'
      },
      {
        id: 'sc_import',
        start: 16.2,
        end: 23.7,
        title: 'Walk the editor',
        summary: 'Import, strip dead air, mention fillers.',
        kind: 'talk'
      },
      {
        id: 'sc_demo',
        start: 23.7,
        end: 30.2,
        title: 'Silent product walkthrough',
        summary: 'Showing the UI, not talking.',
        kind: 'demo'
      },
      {
        id: 'sc_false',
        start: 30.2,
        end: 31.7,
        title: 'False take',
        summary: 'First pass of the thesis line.',
        kind: 'retake',
        takeOf: 'sc_thesis'
      },
      {
        id: 'sc_thesis',
        start: 32.1,
        end: 35.4,
        title: 'Keep this take',
        summary: 'The line that should stay.',
        kind: 'talk'
      },
      {
        id: 'sc_end',
        start: 35.7,
        end: 41.3,
        title: 'Close',
        summary: 'Zoom, captions, never open Shotcut.',
        kind: 'talk'
      }
    ],
    suggestions: [
      ...suggestionsFromSilence(silence, 0.12),
      {
        id: 'sug_norm',
        type: 'loud',
        start: 0,
        end: asset.duration,
        action: 'normalize',
        label: 'Normalize voice to -16 LUFS',
        safe: true,
        applied: false
      },
      {
        id: 'sug_fill_1',
        type: 'filler',
        start: 1.22,
        end: 1.48,
        action: 'cut',
        label: 'um',
        safe: true,
        applied: false
      },
      {
        id: 'sug_fill_2',
        type: 'filler',
        start: 20.62,
        end: 21.08,
        action: 'cut',
        label: 'you know',
        safe: true,
        applied: false
      },
      {
        id: 'sug_fill_3',
        type: 'filler',
        start: 22.72,
        end: 23.0,
        action: 'cut',
        label: 'Like',
        safe: true,
        applied: false
      },
      ...detectRepeats(words),
      {
        id: 'sug_static_1',
        type: 'static',
        start: 16.2,
        end: 22.4,
        action: 'speed',
        label: 'Low motion while talking over desktop',
        safe: false,
        applied: false
      }
    ],
    tracks: project.tracks.map((track) => {
      if (track.id === 'v3') {
        return {
          ...track,
          clips: [
            {
              id: uid('clip'),
              trackId: 'v3',
              start: 0.4,
              duration: 6.1,
              inPoint: 0,
              outPoint: 6.1,
              transform: { ...DEFAULT_TRANSFORM },
              volume: 1,
              muted: false,
              speed: 1,
              text: 'Cut speech like text.',
              style: { ...DEFAULT_CAPTION_STYLE },
              ...emptyClipFields()
            }
          ]
        }
      }
      if (track.id === 'v2') {
        return {
          ...track,
          clips: [
            {
              id: uid('clip'),
              trackId: 'v2',
              start: 18.4,
              duration: 4.2,
              inPoint: 0,
              outPoint: 4.2,
              transform: { ...DEFAULT_TRANSFORM, scale: 1.35, y: 40 },
              volume: 1,
              muted: false,
              speed: 1,
              text: 'ZOOM · VS Code',
              ...emptyClipFields()
            }
          ]
        }
      }
      return track
    })
  }
}

export { detectFillers, parseTranscriptJson, suggestionsFromSilence }
