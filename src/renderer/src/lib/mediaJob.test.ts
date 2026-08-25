import { existsSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import {
  JobBusy,
  JobCancelled,
  JobGate,
  busyMessage,
  explainImportError,
  isJobCancelled,
  isWhisperUnavailable,
  mediaBusyToast,
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
