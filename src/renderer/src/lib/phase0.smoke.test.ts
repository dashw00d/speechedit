import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { applyCommand, programLength } from './commands'
import { buildExportJob } from './exportJob'
import { host } from '../host'
import { importRecording } from './importMedia'
import { openDocumentFromRaw, serializeDocument } from './projectDocument'
import { transcriptIsPlaceholder } from './transcript'

const RUN = '/tmp/speechedit-phase0'

async function installNativeMediaHost(): Promise<() => void> {
  const { probe, waveform, thumbnails, detectSilence, detectScenes, detectLoudness } = await import(
    '../../../main/ffmpeg.ts'
  )
  const { transcribeMedia } = await import('../../../main/transcribe.ts')
  const prev = {
    probe: host.probe,
    waveform: host.waveform,
    thumbnails: host.thumbnails,
    silence: host.silence,
    scenes: host.scenes,
    loudness: host.loudness,
    analyze: host.analyze,
    transcribe: host.transcribe,
    makeProxy: host.makeProxy
  }
  host.probe = probe
  host.waveform = (file) => waveform(file)
  host.thumbnails = (file) => thumbnails(file)
  host.silence = detectSilence
  host.scenes = detectScenes
  host.loudness = detectLoudness
  host.analyze = async (file) => ({
    silence: await detectSilence(file),
    scenes: await detectScenes(file),
    loudness: await detectLoudness(file)
  })
  host.transcribe = (file, opts) => transcribeMedia(file, opts)
  host.makeProxy = async () => ''
  return () => {
    Object.assign(host, prev)
  }
}

describe('Phase 0 known sample', () => {
  let restoreHost: (() => void) | undefined
  afterEach(() => {
    restoreHost?.()
    restoreHost = undefined
  })

  test('import JFK → real words → save/reopen → export', async () => {
    const { checkMediaTools } = await import('../../../main/mediaTools.ts')
    const { resolveAppIdentity } = await import('../../../main/appIdentity.ts')
    const { ensureLocalWhisper } = await import('../../../main/asrLocal.ts')
    const { exportProgram, probe } = await import('../../../main/ffmpeg.ts')

    const tools = await checkMediaTools()
    expect(tools.ok).toBe(true)
    expect(tools.ffmpeg.version).toMatch(/^\d+\.\d+/)

    const identity = await resolveAppIdentity({
      version: '0.1.0',
      packaged: false,
      electron: '',
      platform: process.platform,
      arch: process.arch
    })
    expect(identity.commit).toMatch(/^[0-9a-f]{7,}$/i)

    const ready = await ensureLocalWhisper({ sample: true })
    expect(ready.sample).toBeTruthy()
    const ffmpeg = Bun.which('ffmpeg')
    if (!ffmpeg) throw new Error('ffmpeg required')

    await mkdir(RUN, { recursive: true })
    const source = join(RUN, 'jfk.mp4')
    const projectPath = join(RUN, 'jfk.speechedit.json')
    const output = join(RUN, 'jfk-export.mp4')
    await Bun.$`${ffmpeg} -y -f lavfi -i color=c=black:s=320x240:r=25 -i ${ready.sample!} -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac ${source}`.quiet()

    restoreHost = await installNativeMediaHost()
    const imported = await importRecording(source)
    expect(transcriptIsPlaceholder(imported.transcript.words)).toBe(false)
    const spoken = imported.transcript.words.map((word) => word.text).join(' ')
    expect(spoken).toMatch(/america|american|fellow|ask|country/i)
    expect(imported.transcript.words[0].end).toBeGreaterThan(imported.transcript.words[0].start)
    expect(imported.transcript.words.some((word) => word.origin === 'island')).toBe(false)

    const first = imported.transcript.words[0]
    const cut = applyCommand(imported, { type: 'toggleWords', wordIds: [first.id], lift: false })
    expect(cut.transcript.words[0].deleted).toBe(true)
    expect(programLength(cut)).toBeLessThan(programLength(imported))

    await Bun.write(projectPath, JSON.stringify(serializeDocument(cut, projectPath), null, 2))
    const reopened = openDocumentFromRaw(JSON.parse(await Bun.file(projectPath).text()), projectPath)
    expect(reopened.project.transcript.words.map((word) => word.text)).toEqual(
      cut.transcript.words.map((word) => word.text)
    )
    expect(reopened.project.transcript.words[0].deleted).toBe(true)
    expect(Object.values(reopened.project.assets)[0]?.path).toContain('jfk.mp4')

    const job = buildExportJob(reopened.project, output)
    if (!job) throw new Error('reopened project could not export')
    job.encoder = 'libx264'
    job.normalize = false
    await exportProgram(job)
    const info = await probe(output)
    expect(info.hasVideo).toBe(true)
    expect(info.hasAudio).toBe(true)
    expect(info.duration).toBeGreaterThan(1)
    expect(info.duration).toBeLessThan(programLength(imported) + 0.4)

    await Bun.write(
      join(RUN, 'snapshot.json'),
      JSON.stringify(
        {
          identity,
          tools: {
            ffmpeg: { path: tools.ffmpeg.path, version: tools.ffmpeg.version },
            ffprobe: { path: tools.ffprobe.path, version: tools.ffprobe.version }
          },
          words: imported.transcript.words.length,
          spoken: spoken.slice(0, 240),
          sourceDuration: imported.sourceDuration,
          exportDuration: info.duration,
          projectPath,
          output
        },
        null,
        2
      )
    )
  }, 180000)
})
