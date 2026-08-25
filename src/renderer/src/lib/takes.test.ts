import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createEmptyProject } from './demo'
import { buildExportJob } from './exportJob'
import { buildProgramGraph, buildSegmentFilters } from './exportGraph'
import { sampleProgram } from './programLook'
import { resolveSegments, sourceToProgramOf } from './resolver'
import { localSourceTime, primaryAssetAt, primaryTakes, sourceOffsetOf } from './takes'
import type { Asset, Project, Word } from '../types'

function takeAsset(id: string, path: string, duration: number, offset?: number): Asset {
  return {
    id,
    path,
    name: `${id}.mp4`,
    kind: 'video',
    duration,
    waveform: [0.2, 0.4],
    ...(offset != null ? { sourceOffset: offset } : {})
  }
}

function word(text: string, start: number, end: number): Word {
  return { id: `w_${text}_${start}`, text, start, end, speaker: 'ryan' }
}

function seeded(name: string, duration: number, path: string): Project {
  return {
    ...createEmptyProject(name),
    sourceDuration: duration,
    assets: { a: takeAsset('a', path, duration, 0) },
    transcript: {
      ...createEmptyProject(name).transcript,
      words: [word('hello', 0.1, 0.4)]
    }
  }
}

function channel(rgb: [number, number, number]): 'r' | 'g' | 'b' {
  const [r, g, b] = rgb
  if (r >= g && r >= b) return 'r'
  if (g >= r && g >= b) return 'g'
  return 'b'
}

async function sampleRgb(file: string, at: number): Promise<[number, number, number]> {
  const ffmpeg = Bun.which('ffmpeg')
  if (!ffmpeg) throw new Error('ffmpeg required to sample a frame')
  const proc = Bun.spawn(
    [
      ffmpeg,
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      file,
      '-ss',
      at.toFixed(3),
      '-frames:v',
      '1',
      '-vf',
      'scale=1:1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1'
    ],
    { stdout: 'pipe', stderr: 'pipe' }
  )
  const buf = Buffer.from(await new Response(proc.stdout).arrayBuffer())
  const code = await proc.exited
  if (code !== 0 || buf.length < 3) {
    const err = await new Response(proc.stderr).text()
    throw new Error(err || `Could not sample ${file} at ${at}`)
  }
  return [buf[0], buf[1], buf[2]]
}

describe('append take', () => {
  test('appendTake extends the source reel without replacing the first take', () => {
    const first = seeded('reel', 2, '/tmp/take1.mp4')
    const next = applyCommand(first, {
      type: 'appendTake',
      asset: takeAsset('b', '/tmp/take2.mp4', 1.5),
      words: [word('again', 0.1, 0.5)],
      analysis: {
        silence: [{ start: 0.8, end: 1.4 }],
        staticRegions: [],
        loudness: []
      }
    })
    expect(next.sourceDuration).toBeCloseTo(3.5, 5)
    expect(primaryTakes(next).map((take) => take.id)).toEqual(['a', 'b'])
    expect(sourceOffsetOf(next.assets.b)).toBeCloseTo(2, 5)
    expect(next.transcript.words.map((w) => [w.text, w.start])).toEqual([
      ['hello', 0.1],
      ['again', 2.1]
    ])
    expect(next.analysis.silence.some((row) => row.start >= 2.8 && row.end <= 3.4)).toBe(true)
    expect(resolveSegments(next).some((seg) => Math.abs(seg.inPoint - 2) < 0.02)).toBe(true)
    expect(sourceToProgramOf(next, 2.1)).toBeCloseTo(2.1, 5)
    expect(primaryAssetAt(next, 2.1)?.id).toBe('b')
    expect(localSourceTime(2.1, next.assets.b)).toBeCloseTo(0.1, 5)
  })

  test('export job maps take 2 to input 1 and local trim', () => {
    const project = applyCommand(seeded('reel', 2, '/tmp/take1.mp4'), {
      type: 'appendTake',
      asset: takeAsset('b', '/tmp/take2.mp4', 2),
      words: []
    })
    const job = buildExportJob(project, '/tmp/two-takes.mp4')!
    expect(job.inputs?.map((row) => row.path)).toEqual(['/tmp/take1.mp4', '/tmp/take2.mp4'])
    const late = job.segments.find((seg) => (seg.sourceOffset ?? 0) > 0)
    expect(late?.input).toBe('/tmp/take2.mp4')
    expect(late?.inputIndex).toBe(1)
    expect(late?.start).toBeGreaterThanOrEqual(2)
    const filters = buildSegmentFilters(job, late!, job.segments.indexOf(late!))
    expect(filters.vf).toContain('trim=start=0.000')
    const program = buildProgramGraph(job)
    expect(program.filterComplex).toContain('[1:v]')
    expect(program.filterComplex).toContain('[0:v]')
    const look = sampleProgram(job, 2.2)
    expect(look.sourceTime).toBeCloseTo(2.2, 5)
    expect(look.incomingSource).toBeCloseTo(0.2, 5)
    expect(look.incomingInput).toBe('/tmp/take2.mp4')

    const withMix = applyCommand(project, {
      type: 'addBroll',
      start: 0.2,
      duration: 0.6,
      asset: {
        id: 'still1',
        path: '/tmp/se-still.png',
        name: 'still.png',
        kind: 'image',
        duration: 1,
        waveform: []
      }
    })
    const mixed = buildExportJob(withMix, '/tmp/two-takes-mix.mp4')!
    const mixedGraph = buildProgramGraph(mixed)
    expect(mixedGraph.filterComplex).toContain('[0:v]')
    expect(mixedGraph.filterComplex).toContain('[1:v]')
    expect(mixedGraph.filterComplex).toContain('[2:v]')
    expect(mixedGraph.extraInputs.some((input) => input.path === '/tmp/se-still.png')).toBe(true)
  })

  test('two color takes export as red then green, not the first file twice', async () => {
    const ffmpeg = Bun.which('ffmpeg')
    const ffprobe = Bun.which('ffprobe')
    if (!ffmpeg || !ffprobe) throw new Error('ffmpeg/ffprobe required for two-take smoke')

    await Bun.$`${ffmpeg} -y -f lavfi -i color=c=red:s=160x120:r=30:d=1 -f lavfi -i sine=frequency=440:sample_rate=48000:d=1 -pix_fmt yuv420p -c:a aac /tmp/se-take1.mp4`.quiet()
    await Bun.$`${ffmpeg} -y -f lavfi -i color=c=green:s=160x120:r=30:d=1 -f lavfi -i sine=frequency=330:sample_rate=48000:d=1 -pix_fmt yuv420p -c:a aac /tmp/se-take2.mp4`.quiet()

    let project = seeded('two-takes', 1, '/tmp/se-take1.mp4')
    project = {
      ...project,
      width: 160,
      height: 120,
      fps: 30,
      assets: {
        a: { ...project.assets.a, duration: 1, width: 160, height: 120 }
      }
    }
    project = applyCommand(project, {
      type: 'appendTake',
      asset: takeAsset('b', '/tmp/se-take2.mp4', 1),
      words: []
    })
    const job = buildExportJob(project, '/tmp/se-two-takes.mp4')!
    job.encoder = 'libx264'
    job.normalize = false
    const { exportProgram, probe } = await import('../../../main/ffmpeg.ts')
    await exportProgram(job)
    const info = await probe('/tmp/se-two-takes.mp4')
    expect(info.duration).toBeGreaterThan(1.6)
    expect(info.duration).toBeLessThan(2.4)
    expect(channel(await sampleRgb('/tmp/se-two-takes.mp4', 0.3))).toBe('r')
    expect(channel(await sampleRgb('/tmp/se-two-takes.mp4', 1.3))).toBe('g')
  }, 90000)
})
