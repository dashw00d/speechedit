import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createEmptyProject } from './demo'
import { buildExportJob } from './exportJob'
import { buildMixGraph, buildSegmentFilters } from './exportGraph'
import {
  SOURCE_SEEK_PREROLL,
  primaryReadArgs,
  sourceReadArgs,
  sourceSeekInputArgs,
  sourceTrimFilters
} from '../../../shared/sourceSeek'

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

describe('accurate source seek', () => {
  test('preroll input -ss is before the cut, never the cut itself', () => {
    expect(sourceSeekInputArgs(0.4)).toEqual([])
    expect(sourceSeekInputArgs(SOURCE_SEEK_PREROLL)).toEqual([])
    expect(sourceSeekInputArgs(45)).toEqual(['-ss', (45 - SOURCE_SEEK_PREROLL).toFixed(3)])
    expect(sourceTrimFilters(45, 46)).toEqual({
      vf: 'trim=start=45.000:end=46.000,setpts=PTS-STARTPTS',
      af: 'atrim=start=45.000:end=46.000,asetpts=PTS-STARTPTS'
    })
    expect(primaryReadArgs('/tmp/take.mp4', 45)).toEqual([
      '-noautorotate',
      '-ss',
      (45 - SOURCE_SEEK_PREROLL).toFixed(3),
      '-i',
      '/tmp/take.mp4',
      '-copyts'
    ])
    const overlay = sourceReadArgs('/tmp/broll.mp4', 10, 1.5)
    expect(overlay.indexOf('-i')).toBeGreaterThan(overlay.indexOf('-ss'))
    expect(overlay[overlay.indexOf('-i') + 1]).toBe('/tmp/broll.mp4')
    expect(overlay.slice(overlay.indexOf('-i') + 2)).toEqual(['-copyts', '-ss', '10.000', '-t', '1.500'])
  })

  test('segment filters trim the keep; mix b-roll does not input-seek the in-point alone', () => {
    let project = createEmptyProject('seek')
    project = {
      ...project,
      sourceDuration: 8,
      assets: {
        src: {
          id: 'src',
          path: '/tmp/take.mp4',
          name: 'take.mp4',
          kind: 'video',
          duration: 8,
          waveform: []
        }
      }
    }
    project = applyCommand(project, { type: 'deleteRange', start: 1, end: 1.1 })
    project = applyCommand(project, {
      type: 'addBroll',
      start: 0.2,
      duration: 0.8,
      asset: {
        id: 'broll',
        path: '/tmp/broll.mp4',
        name: 'broll.mp4',
        kind: 'video',
        duration: 6,
        waveform: []
      }
    })
    const job = buildExportJob(project, '/tmp/out.mp4')!
    const late = job.segments.find((s) => s.start >= 1.05)
    expect(late).toBeTruthy()
    const filters = buildSegmentFilters(job, late!, job.segments.indexOf(late!))
    expect(filters.vf.startsWith(`trim=start=${late!.start.toFixed(3)}:end=${late!.end.toFixed(3)}`)).toBe(true)
    expect(filters.af.startsWith(`atrim=start=${late!.start.toFixed(3)}:end=${late!.end.toFixed(3)}`)).toBe(true)
    const mix = buildMixGraph(job)
    const clip = mix.inputs.find((i) => i.path === '/tmp/broll.mp4')
    expect(clip?.args.includes('-copyts')).toBe(true)
    expect(clip?.args.join(' ')).not.toMatch(/-ss [\d.]+ -t [\d.]+ -i /)
  })

  test('GOP-250 Auto-Edit cut exports the keep colors, not the deleted middle', async () => {
    const ffmpeg = Bun.which('ffmpeg')
    const ffprobe = Bun.which('ffprobe')
    if (!ffmpeg || !ffprobe) throw new Error('ffmpeg/ffprobe required for cut-accuracy smoke')

    const concat = '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]'
    const vmap = '[v]'
    await Bun.$`${ffmpeg} -y -f lavfi -i color=c=red:s=160x120:r=30:d=1 -f lavfi -i color=c=blue:s=160x120:r=30:d=1 -f lavfi -i color=c=green:s=160x120:r=30:d=1 -f lavfi -i sine=frequency=440:sample_rate=48000:d=3 -filter_complex ${concat} -map ${vmap} -map 3:a -c:v libx264 -g 250 -keyint_min 250 -sc_threshold 0 -pix_fmt yuv420p -c:a aac /tmp/se-gop-colors.mp4`.quiet()

    const { exportProgram, probe } = await import('../../../main/ffmpeg.ts')
    let project = createEmptyProject('gop-cut')
    project = {
      ...project,
      sourceDuration: 3,
      width: 160,
      height: 120,
      fps: 30,
      assets: {
        src: {
          id: 'src',
          path: '/tmp/se-gop-colors.mp4',
          name: 'gop.mp4',
          kind: 'video',
          duration: 3,
          waveform: []
        }
      }
    }
    project = applyCommand(project, { type: 'deleteRange', start: 1, end: 2, source: 'manual' })
    const job = buildExportJob(project, '/tmp/se-gop-cut.mp4')!
    job.encoder = 'libx264'
    job.normalize = false
    await exportProgram(job)
    const info = await probe('/tmp/se-gop-cut.mp4')
    expect(info.duration).toBeGreaterThan(1.6)
    expect(info.duration).toBeLessThan(2.4)
    expect(channel(await sampleRgb('/tmp/se-gop-cut.mp4', 0.3))).toBe('r')
    expect(channel(await sampleRgb('/tmp/se-gop-cut.mp4', 1.3))).toBe('g')
  }, 90000)
})
