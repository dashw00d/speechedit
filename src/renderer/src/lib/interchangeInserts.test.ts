import { describe, expect, test } from 'bun:test'
import { applyCommand, programLength } from './commands'
import { createEmptyProject } from './demo'
import {
  applyInterchange,
  projectToFcpxml,
  projectToKdenlive,
  projectToMlt,
  projectToOtio,
  projectToPremiere
} from './interchange'
import { resolveSegments } from './resolver'
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

function voiceOnly(): Project {
  return {
    ...createEmptyProject('holds'),
    sourceDuration: 6,
    fps: 30,
    assets: { a: takeAsset('a', '/tmp/voice.mp4', 6) }
  }
}

function reelWithGap(): Project {
  return applyCommand(voiceOnly(), { type: 'insertGap', time: 2, duration: 1 })
}

function reelWithLift(): Project {
  return applyCommand(voiceOnly(), { type: 'deleteRange', start: 1, end: 1.4, lift: true })
}

function holdSpans(project: Project) {
  return (project.inserts ?? [])
    .filter((row) => row.duration > 0.03)
    .map((row) => ({ start: row.programStart, duration: row.duration }))
    .sort((a, b) => a.start - b.start)
}

const formats = (project: Project): Array<[string, string]> => [
  ['reel.otio', projectToOtio(project)],
  ['reel.fcpxml', projectToFcpxml(project)],
  ['reel.mlt', projectToMlt(project)],
  ['reel.kdenlive', projectToKdenlive(project)],
  ['reel.xml', projectToPremiere(project)]
]

describe('insert / hold interchange', () => {
  test('OTIO / FCPXML / MLT / Premiere emit a native hold, not a zero-length media clip', () => {
    const project = reelWithGap()
    const otio = JSON.parse(projectToOtio(project))
    expect(otio.metadata.speechedit.inserts[0]?.duration).toBeCloseTo(1, 2)
    const picture = otio.tracks.children.find((track: { name?: string }) => track.name === 'V1 Picture')
    expect(picture?.children.some((clip: { OTIO_SCHEMA?: string }) => clip.OTIO_SCHEMA === 'Gap.1')).toBe(true)

    expect(projectToFcpxml(project)).toMatch(/<gap[^>]*duration="30\/30s"/)
    expect(projectToMlt(project)).toContain('<blank length="00:00:01.000"')
    expect(projectToPremiere(project)).toMatch(/<clipitem id="slug\d+"/ )
    expect(projectToPremiere(project)).toContain('<name>Hold</name>')
  })

  test('round-trip keeps an inserted gap on an A-roll-only reel', () => {
    const project = reelWithGap()
    const length = programLength(project)
    expect(length).toBeCloseTo(7, 1)
    for (const [name, body] of formats(project)) {
      const next = applyInterchange(voiceOnly(), name, body)
      expect(programLength(next)).toBeCloseTo(length, 1)
      const holds = holdSpans(next)
      expect(holds.length).toBe(1)
      expect(holds[0].start).toBeCloseTo(2, 1)
      expect(holds[0].duration).toBeCloseTo(1, 1)
      expect(resolveSegments(next).some((seg) => seg.kind === 'slug')).toBe(true)
    }
  })

  test('round-trip keeps a lifted hold and the source cut under it', () => {
    const project = reelWithLift()
    const length = programLength(project)
    expect(length).toBeCloseTo(6, 1)
    expect(project.cuts.some((cut) => Math.abs(cut.start - 1) < 0.05 && Math.abs(cut.end - 1.4) < 0.05)).toBe(true)
    for (const [name, body] of formats(project)) {
      const next = applyInterchange(voiceOnly(), name, body)
      expect(programLength(next)).toBeCloseTo(length, 1)
      const holds = holdSpans(next)
      expect(holds.length).toBe(1)
      expect(holds[0].duration).toBeCloseTo(0.4, 1)
      expect(next.cuts.some((cut) => cut.end - cut.start > 0.3)).toBe(true)
    }
  })

  test('OTIO still restores a hold when speechedit.inserts metadata is stripped', () => {
    const raw = JSON.parse(projectToOtio(reelWithGap())) as {
      metadata: { speechedit: { inserts?: unknown; cuts?: unknown } }
    }
    delete raw.metadata.speechedit.inserts
    delete raw.metadata.speechedit.cuts
    const next = applyInterchange(voiceOnly(), 'reel.otio', JSON.stringify(raw))
    expect(programLength(next)).toBeCloseTo(7, 1)
    const holds = holdSpans(next)
    expect(holds.length).toBe(1)
    expect(holds[0].start).toBeCloseTo(2, 1)
    expect(holds[0].duration).toBeCloseTo(1, 1)
  })
})
