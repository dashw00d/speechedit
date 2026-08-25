import { existsSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import {
  JobBusy,
  JobCancelled,
  JobGate,
  ImportLinger,
  beginExportExclusive,
  endExportExclusive,
  busyMessage,
  explainImportError,
  ffmpegImportBusy,
  isJobCancelled,
  isWhisperUnavailable,
  importBusyToast,
  mediaBusyToast,
  runWhenExportIdle,
  throwIfAborted,
  whisperMissingMessage
} from './mediaJobs'
import { host } from '../host'
import { importRecording } from './importMedia'

describe('job gate + errors', () => {
  test('JobGate refuses a second job until finish, and cancel only aborts', () => {
    const gate = new JobGate()
    const signal = gate.start('export')
    expect(gate.kind).toBe('export')
    expect(signal.aborted).toBe(false)
    expect(() => gate.start('import')).toThrow(JobBusy)
    expect(() => gate.start('import')).toThrow(/export is already running/)
    expect(gate.cancel('import')).toBe(false)
    expect(gate.cancel('export')).toBe(true)
    expect(signal.aborted).toBe(true)
    expect(gate.kind).toBe('export')
    expect(() => gate.start('import')).toThrow(/already running/)
    gate.finish('export')
    expect(gate.kind).toBeNull()
    expect(gate.start('import').aborted).toBe(false)
    gate.finish('import')
  })

  test('busy and import errors tell the user what to do', () => {
    expect(busyMessage('export')).toMatch(/Cancel it first/)
    expect(mediaBusyToast(true, null)).toMatch(/export is already running/)
    expect(mediaBusyToast(false, 'probe')).toMatch(/Import is still running/)
    expect(mediaBusyToast(false, 'looks')).toMatch(/Import is still running/)
    expect(mediaBusyToast(false, 'proxy')).toMatch(/Import is still running/)
    expect(mediaBusyToast(false, 'transcript')).toBeNull()
    expect(mediaBusyToast(false, 'preview')).toBeNull()
    expect(ffmpegImportBusy('preview')).toBe(false)
    expect(ffmpegImportBusy('proxy')).toBe(true)
    expect(importBusyToast(false, 'preview')).toMatch(/Import is still running/)
    expect(importBusyToast(false, 'transcript')).toMatch(/Import is still running/)
    expect(mediaBusyToast(false, null)).toBeNull()
    expect(explainImportError(new Error('spawn ffprobe ENOENT'))).toMatch(/Install ffmpeg 4\.4/)
    expect(explainImportError(new Error('ffmpeg did not start (spawn ffmpeg ENOENT)'))).toMatch(/PATH/)
    expect(explainImportError(new Error(`Can't open that recording:\n/no/file.mp4`))).toMatch(/Pick a real media file/)
    expect(explainImportError(new Error('No such file or directory'))).toMatch(/Pick a real media file/)
    expect(isWhisperUnavailable(new Error(whisperMissingMessage()))).toBe(true)
    expect(isJobCancelled(new JobCancelled('export'))).toBe(true)
    expect(isJobCancelled(new Error('Export cancelled.'))).toBe(true)
  })

  test('web host beginJob is busy until endJob', async () => {
    await host.beginJob('export')
    try {
      await expect(host.beginJob('import')).rejects.toThrow(/export is already running/)
    } finally {
      await host.endJob('export')
    }
    await host.beginJob('import')
    await host.endJob('import')
  })

  test('ImportLinger cancel does not hold the job gate', () => {
    const linger = new ImportLinger()
    const whisper = linger.begin('whisper')
    const proxy = linger.begin('proxy')
    expect(linger.size).toBe(2)
    expect(whisper.aborted).toBe(false)
    linger.finish(whisper)
    expect(linger.size).toBe(1)
    linger.abortAll()
    expect(proxy.aborted).toBe(true)
    expect(linger.size).toBe(0)
    const next = linger.begin()
    expect(next.aborted).toBe(false)
    linger.finish(next)
    expect(linger.size).toBe(0)
  })

  test('export preempts the preview proxy linger, not Whisper', () => {
    const jobs = new JobGate()
    const linger = new ImportLinger()
    const whisper = linger.begin('whisper')
    const proxy = linger.begin('proxy')
    const exportSignal = beginExportExclusive(jobs, linger)
    expect(exportSignal.aborted).toBe(false)
    expect(jobs.kind).toBe('export')
    expect(proxy.aborted).toBe(true)
    expect(whisper.aborted).toBe(false)
    expect(linger.sizeOf('whisper')).toBe(1)
    expect(linger.sizeOf('proxy')).toBe(0)
    expect(linger.isParked('whisper')).toBe(true)
    linger.finish(whisper)
    endExportExclusive(jobs, linger)
    expect(linger.isParked('whisper')).toBe(false)
  })

  test('export parks adopted Whisper children and resumes them', () => {
    const jobs = new JobGate()
    const linger = new ImportLinger()
    const signals: string[] = []
    const child = {
      pid: 42,
      exitCode: null as number | null,
      signalCode: null as string | null,
      kill(signal?: string) {
        if (signal) signals.push(signal)
        return true
      },
      once() {
        return this
      }
    }
    const whisper = linger.begin('whisper')
    linger.adopt(whisper, child)
    beginExportExclusive(jobs, linger)
    expect(whisper.aborted).toBe(false)
    expect(signals).toEqual(['SIGSTOP'])
    expect(linger.isParked('whisper')).toBe(true)
    endExportExclusive(jobs, linger)
    expect(signals).toEqual(['SIGSTOP', 'SIGCONT'])
    expect(linger.isParked('whisper')).toBe(false)
    linger.finish(whisper)
  })

  test('a Whisper child that starts during export is parked immediately', () => {
    const jobs = new JobGate()
    const linger = new ImportLinger()
    const signals: string[] = []
    const child = {
      pid: 7,
      exitCode: null as number | null,
      signalCode: null as string | null,
      kill(signal?: string) {
        if (signal) signals.push(signal)
        return true
      },
      once() {
        return this
      }
    }
    beginExportExclusive(jobs, linger)
    const whisper = linger.begin('whisper')
    linger.adopt(whisper, child)
    expect(signals).toEqual(['SIGSTOP'])
    endExportExclusive(jobs, linger)
    expect(signals).toEqual(['SIGSTOP', 'SIGCONT'])
    linger.finish(whisper)
  })

  test('runWhenExportIdle waits until export finishes', async () => {
    const jobs = new JobGate()
    const linger = new ImportLinger()
    jobs.start('export')
    let ran = false
    const done = runWhenExportIdle(jobs, linger, async () => {
      ran = true
      return 'ok'
    })
    await Bun.sleep(40)
    expect(ran).toBe(false)
    endExportExclusive(jobs, linger)
    expect(await done).toBe('ok')
    expect(ran).toBe(true)
    expect(linger.size).toBe(0)
  })

  test('runWhenExportIdle retries after export preempts the proxy', async () => {
    const jobs = new JobGate()
    const linger = new ImportLinger()
    let attempts = 0
    const done = runWhenExportIdle(jobs, linger, async (signal) => {
      attempts += 1
      if (attempts === 1) {
        beginExportExclusive(jobs, linger)
        throwIfAborted(signal, 'import')
      }
      return 'proxy-ready'
    })
    await Bun.sleep(20)
    endExportExclusive(jobs, linger)
    expect(await done).toBe('proxy-ready')
    expect(attempts).toBe(2)
    expect(linger.size).toBe(0)
  })
})

describe('child abort + temp cleanup', () => {
  test('runChild abort kills the child without hanging ffmpeg', async () => {
    const { runChild } = await import('../../../main/childJob.ts')
    const ac = new AbortController()
    let pid = 0
    const done = runChild('sleep', ['30'], {
      signal: ac.signal,
      kind: 'export',
      onSpawn: (child) => {
        pid = child.pid ?? 0
      }
    })
    await Bun.sleep(40)
    expect(pid).toBeGreaterThan(0)
    ac.abort()
    await expect(done).rejects.toBeInstanceOf(JobCancelled)
    expect(() => process.kill(pid, 0)).toThrow()
  })

  test('parked linger child freezes, then continues after export', async () => {
    if (process.platform === 'win32') return
    const { parkChild, unparkChild, killChild } = await import('../../../main/childJob.ts')
    const { spawn } = await import('node:child_process')
    const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'se-park-'))
    const tick = join(dir, 'n')
    await writeFile(tick, '0')
    const child = spawn(
      'bash',
      ['-c', `n=0; while true; do n=$((n+1)); echo $n > "$1"; sleep 0.05; done`, 'tick', tick],
      { stdio: 'ignore' }
    )
    const readN = async () => Number((await readFile(tick, 'utf8').catch(() => '0')).trim()) || 0
    try {
      await Bun.sleep(180)
      const before = await readN()
      expect(before).toBeGreaterThan(0)
      parkChild(child)
      await Bun.sleep(200)
      const frozen = await readN()
      expect(frozen).toBe(before)
      unparkChild(child)
      await Bun.sleep(180)
      expect(await readN()).toBeGreaterThan(frozen)
    } finally {
      killChild(child)
      await new Promise<void>((resolve) => child.once('close', () => resolve()))
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('killChild still reaps a SIGSTOP-parked process', async () => {
    if (process.platform === 'win32') return
    const { parkChild, killChild } = await import('../../../main/childJob.ts')
    const { spawn } = await import('node:child_process')
    const child = spawn('sleep', ['30'], { stdio: 'ignore' })
    const pid = child.pid ?? 0
    expect(pid).toBeGreaterThan(0)
    await Bun.sleep(40)
    parkChild(child)
    killChild(child)
    await new Promise<void>((resolve) => child.once('close', () => resolve()))
    expect(() => process.kill(pid, 0)).toThrow()
  })

  test('already-aborted signal never starts the child', async () => {
    const { runChild } = await import('../../../main/childJob.ts')
    const ac = new AbortController()
    ac.abort()
    let spawned = false
    await expect(
      runChild('sleep', ['30'], {
        signal: ac.signal,
        onSpawn: () => {
          spawned = true
        }
      })
    ).rejects.toThrow(/cancelled/i)
    expect(spawned).toBe(false)
  })

  test('withTempDir removes the dir after throw', async () => {
    const { withTempDir } = await import('../../../main/childJob.ts')
    let seen = ''
    await expect(
      withTempDir('speechedit-jobtest-', async (dir) => {
        seen = dir
        expect(existsSync(dir)).toBe(true)
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(seen).toMatch(/speechedit-jobtest-/)
    expect(existsSync(seen)).toBe(false)
  })
})

describe('export / import cancel without a long encode', () => {
  test('exportProgram with aborted signal throws and skips ffmpeg', async () => {
    const { exportProgram } = await import('../../../main/ffmpeg.ts')
    const ac = new AbortController()
    ac.abort()
    await expect(
      exportProgram(
        {
          input: '/tmp/se-missing-src.mp4',
          output: '/tmp/se-cancel-out.mp4',
          fps: 30,
          width: 320,
          height: 240,
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
          segments: [
            { start: 0, end: 1, speed: 1, scale: 1, x: 0, y: 0, volume: 1, fadeIn: 0, fadeOut: 0 }
          ],
          layers: []
        },
        undefined,
        ac.signal
      )
    ).rejects.toThrow(/cancelled/i)
    expect(existsSync('/tmp/se-cancel-out.mp4')).toBe(false)
  })

  test('importRecording aborted signal fails closed and does not probe', async () => {
    let probed = false
    const prev = host.probe
    host.probe = async () => {
      probed = true
      return { duration: 2, hasVideo: true, hasAudio: true }
    }
    const ac = new AbortController()
    ac.abort()
    try {
      await expect(importRecording('/tmp/se-src.mp4', { signal: ac.signal })).rejects.toThrow(/cancelled/i)
      expect(probed).toBe(false)
    } finally {
      host.probe = prev
    }
  })

  test('importRecording maps missing ffmpeg and bad path to actionable errors', async () => {
    const prev = host.probe
    host.probe = async () => {
      throw new Error('spawn ffprobe ENOENT')
    }
    try {
      await expect(importRecording('/tmp/se-src.mp4')).rejects.toThrow(/Install ffmpeg 4\.4/)
    } finally {
      host.probe = prev
    }

    host.probe = async () => {
      throw new Error(`Can't open that recording:\n/no/such.mp4\nPick a real media file.`)
    }
    try {
      await expect(importRecording('/no/such.mp4')).rejects.toThrow(/Pick a real media file/)
    } finally {
      host.probe = prev
    }
  })

  test('importRecording finally-equivalent: analyze failure still clears a caller flag', async () => {
    const prev = {
      probe: host.probe,
      waveform: host.waveform,
      thumbnails: host.thumbnails,
      analyze: host.analyze,
      silence: host.silence
    }
    host.probe = async () => ({ duration: 2, hasVideo: true, hasAudio: true })
    host.waveform = async () => [0.1]
    host.thumbnails = async () => []
    host.analyze = async () => {
      throw new Error('spawn ffmpeg ENOENT')
    }
    host.silence = async () => {
      throw new Error('spawn ffmpeg ENOENT')
    }
    let analyzing: string | null = 'stale'
    try {
      analyzing = 'probe'
      await expect(importRecording('/tmp/se-src.mp4', (stage) => {
        analyzing = stage
      })).rejects.toThrow(/ffmpeg/i)
    } finally {
      analyzing = null
      Object.assign(host, prev)
    }
    expect(analyzing).toBeNull()
  })
})

describe('b-roll / music pick stays inside the job gate', () => {
  test('inspectPickedMedia does not invent an asset when probe is busy', async () => {
    const { inspectPickedMedia } = await import('./pickFile')
    const prev = { probe: host.probe, waveform: host.waveform }
    host.probe = async () => {
      throw new JobBusy('export')
    }
    host.waveform = async () => {
      throw new Error('waveform should not run')
    }
    try {
      await expect(inspectPickedMedia('/tmp/se-broll.mp4', 'broll')).rejects.toThrow(/export is already running/)
      await expect(inspectPickedMedia('/tmp/se-music.wav', 'audio')).rejects.toThrow(/export is already running/)
    } finally {
      Object.assign(host, prev)
    }
  })

  test('inspectPickedMedia returns probed duration instead of a silent fallback', async () => {
    const { inspectPickedMedia } = await import('./pickFile')
    const prev = { probe: host.probe, waveform: host.waveform }
    host.probe = async () => ({
      duration: 12.5,
      hasVideo: true,
      hasAudio: true,
      width: 1920,
      height: 1080,
      fps: 30,
      sampleRate: 48000
    })
    host.waveform = async () => [0.2, 0.4]
    try {
      const clip = await inspectPickedMedia('/tmp/se-broll.mp4', 'broll')
      expect(clip.duration).toBe(12.5)
      expect(clip.kind).toBe('video')
      const bed = await inspectPickedMedia('/tmp/se-music.wav', 'audio')
      expect(bed.duration).toBe(12.5)
      expect(bed.kind).toBe('audio')
      expect(bed.waveform).toEqual([0.2, 0.4])
    } finally {
      Object.assign(host, prev)
    }
  })
})
