import { describe, expect, test } from 'bun:test'
import {
  activityJobs,
  finishActivity,
  startActivity,
  subscribeActivity,
  syncModelActivities,
  updateActivity
} from './activity'

describe('unified activity feed', () => {
  test('publishes concurrent media work with progress and cancellation ownership', () => {
    let updates = 0
    const stop = subscribeActivity(() => { updates += 1 })
    startActivity({ id: 'test:waveform', label: 'Drawing waveform', cancellable: 'import' })
    startActivity({ id: 'test:whisper', label: 'Whisper transcription', ratio: 0.1, cancellable: 'import' })
    updateActivity('test:whisper', { ratio: 0.6, detail: 'Recognizing words' })

    expect(activityJobs().filter((job) => job.id.startsWith('test:')).map((job) => job.label)).toEqual([
      'Drawing waveform',
      'Whisper transcription'
    ])
    expect(activityJobs().find((job) => job.id === 'test:whisper')).toMatchObject({
      ratio: 0.6,
      detail: 'Recognizing words',
      cancellable: 'import'
    })
    expect(updates).toBeGreaterThanOrEqual(3)

    finishActivity('test:waveform')
    finishActivity('test:whisper')
    stop()
  })

  test('folds the process-wide model queue into the same feed', () => {
    syncModelActivities({
      active: true,
      pending: 1,
      jobs: [
        { id: 'a', label: 'Plan scene edit', state: 'running', queuedAt: 10, startedAt: 11 },
        { id: 'b', label: 'Follow-up', state: 'waiting', queuedAt: 12 }
      ]
    })
    expect(activityJobs().filter((job) => job.id.startsWith('model:')).map((job) => job.state)).toEqual([
      'running',
      'waiting'
    ])

    syncModelActivities({ active: false, pending: 0, jobs: [] })
    expect(activityJobs().some((job) => job.id.startsWith('model:'))).toBe(false)
  })
})
