import { describe, expect, test } from 'bun:test'
import { createDemoProject } from './demo'
import { applyBrollAsset, BROLL_PIP_TRANSFORM, brollPlacement, FALLBACK_BROLL_DURATION } from './broll'
import { useEditor, usePlayback } from '../store'
import { overlayDuckWindows } from './exportJob'
import type { Asset } from '../types'

const still: Asset = {
  id: 'face',
  path: 'https://example.com/face.png',
  name: 'face.png',
  kind: 'image',
  duration: 3,
  waveform: []
}

const cam: Asset = {
  id: 'cam',
  path: 'https://example.com/cam.webm',
  name: 'cam.webm',
  kind: 'video',
  duration: 20,
  waveform: []
}

describe('b-roll at playhead', () => {
  test('playhead fallback is 6 seconds in the corner', () => {
    const demo = createDemoProject()
    expect(brollPlacement(demo, 12, [], null)).toEqual({
      start: 12,
      duration: FALLBACK_BROLL_DURATION,
      basis: 'playhead'
    })
  })

  test('a word selection covers those words', () => {
    const demo = createDemoProject()
    const word = demo.transcript.words.find((row) => row.text === 'build')
    expect(word).toBeTruthy()
    const placement = brollPlacement(demo, 0, [word!.id], null)
    expect(placement.basis).toBe('words')
    expect(placement.duration).toBeGreaterThan(0.05)
  })

  test('applyBrollAsset silences a corner PIP and does not duck the voice', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    usePlayback.getState().seekProgram(8)
    const { toast, placement } = applyBrollAsset(still)
    expect(placement.basis).toBe('playhead')
    expect(toast).toMatch(/corner/)
    expect(toast).toMatch(/volume/)
    const editor = useEditor.getState()
    const clip = editor.project.tracks.flatMap((track) => track.clips).find((row) => row.id === editor.selectedClipId)
    expect(clip?.assetId).toBe('face')
    expect(clip?.muted).toBe(false)
    expect(clip?.volume).toBe(0)
    expect(clip?.transform.scale).toBe(BROLL_PIP_TRANSFORM.scale)
    expect(clip?.transform.x).toBe(BROLL_PIP_TRANSFORM.x)
    expect(clip?.start).toBe(8)
    expect(clip?.duration).toBe(FALLBACK_BROLL_DURATION)
    expect(overlayDuckWindows(editor.project)).toEqual([])
    expect(editor.inspectorTab).toBe('transform')
  })

  test('a video face cam is capped by the file length', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    usePlayback.getState().seekProgram(2)
    applyBrollAsset({ ...cam, duration: 4 })
    const clip = useEditor.getState().project.tracks.flatMap((track) => track.clips).find((row) => row.assetId === 'cam')
    expect(clip?.duration).toBe(4)
    expect(clip?.volume).toBe(0)
  })
})
