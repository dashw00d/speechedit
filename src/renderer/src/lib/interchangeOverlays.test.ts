import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createEmptyProject } from './demo'
import {
  applyInterchange,
  projectToFcpxml,
  projectToKdenlive,
  projectToMlt,
  projectToOtio,
  projectToPremiere
} from './interchange'
import type { Asset, Project } from '../types'

function takeAsset(id: string, path: string, duration: number): Asset {
  return {
    id,
    path,
    name: `${id}.mp4`,
    kind: 'video',
    duration,
    waveform: [0.2],
    sourceOffset: 0
  }
}

function reelWithGraphics(inPoint = 0, bedInPoint = 0): Project {
  let project: Project = {
    ...createEmptyProject('graphics'),
    sourceDuration: 6,
    fps: 30,
    assets: { a: takeAsset('a', '/tmp/voice.mp4', 6) }
  }
  project = applyCommand(project, {
    type: 'addBroll',
    start: 1.2,
    duration: 2,
    inPoint,
    asset: {
      id: 'insert',
      path: '/tmp/insert.mp4',
      name: 'insert.mp4',
      kind: 'video',
      duration: 4,
      waveform: []
    }
  })
  return applyCommand(project, {
    type: 'addAudio',
    start: 0,
    duration: 6,
    inPoint: bedInPoint,
    asset: {
      id: 'bed',
      path: '/tmp/bed.wav',
      name: 'bed.wav',
      kind: 'audio',
      duration: 8,
      waveform: []
    }
  })
}

function voiceOnly(): Project {
  return {
    ...createEmptyProject('graphics'),
    sourceDuration: 6,
    fps: 30,
    assets: { a: takeAsset('a', '/tmp/voice.mp4', 6) }
  }
}

function overlayPath(project: Project): string | undefined {
  return project.tracks
    .filter((track) => track.type === 'overlay')
    .flatMap((track) => track.clips)
    .map((clip) => (clip.assetId ? project.assets[clip.assetId]?.path : undefined))
    .find(Boolean)
}

function bedPath(project: Project): string | undefined {
  return project.tracks
    .filter((track) => track.type === 'audio' && track.id !== 'a1')
    .flatMap((track) => track.clips)
    .map((clip) => (clip.assetId ? project.assets[clip.assetId]?.path : undefined))
    .find(Boolean)
}

describe('overlay interchange', () => {
  test('OTIO / FCPXML / MLT / Premiere point B-roll and music at their own files', () => {
    const project = reelWithGraphics()

    const otio = JSON.parse(projectToOtio(project)) as {
      metadata: { speechedit: { overlays: Array<{ path: string; start: number; kind: string }> } }
      tracks: {
        children: Array<{
          name?: string
          children: Array<{ media_reference?: { target_url?: string }; metadata?: { speechedit?: { start?: number } } }>
        }>
      }
    }
    expect(otio.metadata.speechedit.overlays.map((row) => row.path)).toEqual(['/tmp/insert.mp4', '/tmp/bed.wav'])
    const graphic = otio.tracks.children.find((track) =>
      track.children.some((clip) => clip.media_reference?.target_url === '/tmp/insert.mp4')
    )
    expect(graphic).toBeTruthy()
    expect(graphic?.children[0]?.metadata?.speechedit?.start).toBeCloseTo(1.2, 2)

    const fcpxml = projectToFcpxml(project)
    expect(fcpxml).toContain('src="/tmp/insert.mp4"')
    expect(fcpxml).toContain('src="/tmp/bed.wav"')
    expect(fcpxml).toContain('ref="ov1"')
    expect(fcpxml).toContain('lane="2"')

    const mlt = projectToMlt(project)
    expect(mlt).toContain('/tmp/insert.mp4')
    expect(mlt).toContain('/tmp/bed.wav')
    expect(mlt).toContain('producer="ov_insert"')
    expect(mlt).toContain('producer="bed_bed"')
    expect(mlt).toContain('<playlist id="broll">')

    const premiere = projectToPremiere(project)
    expect(premiere).toContain('file:///tmp/insert.mp4')
    expect(premiere).toContain('file:///tmp/bed.wav')
    expect(premiere).toContain('<file id="ovfile1">')
    expect(premiere).toContain('<clipitem id="ovclip1">')
    expect(premiere).toContain('<clipitem id="bedclip1">')
  })

  test('round-trip restores B-roll and music onto an A-roll-only reel', () => {
    const project = reelWithGraphics()
    const formats: Array<[string, string]> = [
      ['reel.otio', projectToOtio(project)],
      ['reel.fcpxml', projectToFcpxml(project)],
      ['reel.mlt', projectToMlt(project)],
      ['reel.kdenlive', projectToKdenlive(project)],
      ['reel.xml', projectToPremiere(project)]
    ]
    for (const [name, body] of formats) {
      const next = applyInterchange(voiceOnly(), name, body)
      expect(overlayPath(next)).toBe('/tmp/insert.mp4')
      expect(bedPath(next)).toBe('/tmp/bed.wav')
      const broll = next.tracks
        .find((track) => track.type === 'overlay')
        ?.clips.find((clip) => clip.assetId && next.assets[clip.assetId]?.path === '/tmp/insert.mp4')
      expect(broll?.start).toBeCloseTo(1.2, 1)
      expect(broll?.duration).toBeCloseTo(2, 1)
      expect(broll?.inPoint).toBeCloseTo(0, 1)
    }
  })

  test('round-trip keeps slipped B-roll and music in-points', () => {
    const project = reelWithGraphics(1.5, 0.8)
    const formats: Array<[string, string]> = [
      ['reel.otio', projectToOtio(project)],
      ['reel.fcpxml', projectToFcpxml(project)],
      ['reel.mlt', projectToMlt(project)],
      ['reel.kdenlive', projectToKdenlive(project)],
      ['reel.xml', projectToPremiere(project)]
    ]
    for (const [name, body] of formats) {
      const next = applyInterchange(voiceOnly(), name, body)
      const broll = next.tracks
        .find((track) => track.type === 'overlay')
        ?.clips.find((clip) => clip.assetId && next.assets[clip.assetId]?.path === '/tmp/insert.mp4')
      const bed = next.tracks
        .find((track) => track.type === 'audio' && track.id !== 'a1')
        ?.clips.find((clip) => clip.assetId && next.assets[clip.assetId]?.path === '/tmp/bed.wav')
      expect(broll?.inPoint).toBeCloseTo(1.5, 1)
      expect(bed?.inPoint).toBeCloseTo(0.8, 1)
      expect(broll?.start).toBeCloseTo(1.2, 1)
    }
  })

  test('OTIO still restores B-roll when speechedit.overlays metadata is stripped', () => {
    const raw = JSON.parse(projectToOtio(reelWithGraphics(1.5, 0.8))) as {
      metadata: { speechedit: { overlays?: unknown; cuts?: unknown } }
    }
    delete raw.metadata.speechedit.overlays
    delete raw.metadata.speechedit.cuts
    const next = applyInterchange(voiceOnly(), 'reel.otio', JSON.stringify(raw))
    expect(overlayPath(next)).toBe('/tmp/insert.mp4')
    expect(bedPath(next)).toBe('/tmp/bed.wav')
    const broll = next.tracks
      .find((track) => track.type === 'overlay')
      ?.clips.find((clip) => clip.assetId && next.assets[clip.assetId]?.path === '/tmp/insert.mp4')
    expect(broll?.inPoint).toBeCloseTo(1.5, 1)
  })
})
