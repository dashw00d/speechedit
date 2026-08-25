import { describe, expect, test } from 'bun:test'
import { applyCommand, programLength } from './commands'
import { createEmptyProject } from './demo'
import {
  applyInterchange,
  projectToFcpxml,
  projectToMlt,
  projectToOtio,
  projectToPremiere
} from './interchange'
import type { Asset, Project, Word } from '../types'

function takeAsset(id: string, path: string, duration: number, offset?: number): Asset {
  return {
    id,
    path,
    name: `${id}.mp4`,
    kind: 'video',
    duration,
    waveform: [0.2],
    ...(offset != null ? { sourceOffset: offset } : {})
  }
}

function word(text: string, start: number, end: number): Word {
  return { id: `w_${text}_${start}`, text, start, end, speaker: 'ryan' }
}

function twoTakeReel(): Project {
  let project: Project = {
    ...createEmptyProject('two-takes'),
    sourceDuration: 2,
    fps: 30,
    assets: { a: takeAsset('a', '/tmp/take1.mp4', 2, 0) },
    transcript: {
      ...createEmptyProject('two-takes').transcript,
      words: [word('hello', 0.1, 0.4)]
    }
  }
  project = applyCommand(project, {
    type: 'appendTake',
    asset: takeAsset('b', '/tmp/take2.mp4', 2),
    words: [word('again', 0.1, 0.4)]
  })
  return applyCommand(project, { type: 'deleteRange', start: 2.5, end: 3.0, source: 'manual' })
}

describe('multi-take interchange', () => {
  test('OTIO / FCPXML / MLT / Premiere point take 2 at its own file and local in-point', () => {
    const project = twoTakeReel()
    const length = programLength(project)

    const otio = JSON.parse(projectToOtio(project)) as {
      metadata: { speechedit: { takes: Array<{ path: string; sourceOffset: number }> } }
      tracks: { children: Array<{ kind?: string; name?: string; children: Array<{
        source_range: { start_time: { value: number; rate: number } }
        media_reference: { target_url?: string }
      }> }> }
    }
    expect(otio.metadata.speechedit.takes.map((take) => take.path)).toEqual(['/tmp/take1.mp4', '/tmp/take2.mp4'])
    const picture = otio.tracks.children.find((track) => track.name === 'V1 Picture')
    const take2 = picture?.children.filter((clip) => clip.media_reference.target_url === '/tmp/take2.mp4') ?? []
    expect(take2.length).toBeGreaterThan(0)
    expect(take2[0].source_range.start_time.value / take2[0].source_range.start_time.rate).toBeCloseTo(0, 2)

    const fcpxml = projectToFcpxml(project)
    expect(fcpxml).toContain('src="/tmp/take1.mp4"')
    expect(fcpxml).toContain('src="/tmp/take2.mp4"')
    expect(fcpxml).toContain('ref="r2"')
    expect(fcpxml).toMatch(/ref="r2"[^>]*start="0\/30s"|start="0\/30s"[^>]*ref="r2"/)

    const mlt = projectToMlt(project)
    expect(mlt).toContain('/tmp/take2.mp4')
    expect(mlt).toContain('producer="src_b"')
    expect(mlt).toContain('<entry producer="src"')

    const premiere = projectToPremiere(project)
    expect(premiere).toContain('file:///tmp/take2.mp4')
    expect(premiere).toContain('<file id="file2">')
    expect(premiere).toMatch(/<in>0<\/in>[\s\S]*?<file id="file2">/)

    const formats = [
      ['reel.otio', projectToOtio(project)],
      ['reel.fcpxml', fcpxml],
      ['reel.mlt', mlt],
      ['reel.xml', premiere]
    ] as const
    for (const [name, body] of formats) {
      const next = applyInterchange(project, name, body)
      expect(programLength(next)).toBeCloseTo(length, 1)
      expect(next.cuts.some((cut) => Math.abs(cut.start - 2.5) < 0.08 && Math.abs(cut.end - 3) < 0.08)).toBe(true)
    }

    const stripped = JSON.parse(projectToOtio(project)) as { metadata: { speechedit: { cuts?: unknown } } }
    delete stripped.metadata.speechedit.cuts
    const fromBare = applyInterchange(project, 'bare.otio', JSON.stringify(stripped))
    expect(programLength(fromBare)).toBeCloseTo(length, 1)
    expect(fromBare.cuts.some((cut) => Math.abs(cut.start - 2.5) < 0.08 && Math.abs(cut.end - 3) < 0.08)).toBe(true)
  })
})
