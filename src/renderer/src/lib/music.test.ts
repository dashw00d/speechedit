import { describe, expect, test } from 'bun:test'
import { programLength } from './commands'
import { createDemoProject } from './demo'
import { applyMusicAsset, hasMusicBed, MUSIC_FADE, musicPlacement } from './music'
import { useEditor, usePlayback } from '../store'
import type { Asset } from '../types'

const bed: Asset = {
  id: 'bed',
  path: 'https://example.com/bed.wav',
  name: 'bed.wav',
  kind: 'audio',
  duration: 12,
  waveform: []
}

describe('music bed', () => {
  test('from the playhead the bed covers the remaining reel, capped by the file', () => {
    const demo = createDemoProject()
    const remain = programLength(demo) - 8
    expect(musicPlacement(demo, 8, [], null)).toEqual({
      start: 8,
      duration: remain,
      basis: 'playhead'
    })
  })

  test('a word selection covers those words', () => {
    const demo = createDemoProject()
    const word = demo.transcript.words.find((row) => row.text === 'build')
    expect(word).toBeTruthy()
    expect(musicPlacement(demo, 0, [word!.id], null).basis).toBe('words')
  })

  test('applyMusicAsset lands a quiet faded bed and hides the next Add music', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    usePlayback.getState().seekProgram(5)
    expect(hasMusicBed(useEditor.getState().project)).toBe(false)
    const { toast, placement } = applyMusicAsset(bed)
    expect(placement.basis).toBe('playhead')
    expect(toast).toMatch(/under the voice/)
    const editor = useEditor.getState()
    const clip = editor.project.tracks.flatMap((track) => track.clips).find((row) => row.id === editor.selectedClipId)
    expect(clip?.assetId).toBe('bed')
    expect(clip?.volume).toBe(0.35)
    expect(clip?.fadeIn).toBe(MUSIC_FADE)
    expect(clip?.fadeOut).toBe(MUSIC_FADE)
    expect(clip?.start).toBe(5)
    expect(clip?.duration).toBe(12)
    expect(hasMusicBed(editor.project)).toBe(true)
    expect(editor.inspectorTab).toBe('transform')
  })
})
