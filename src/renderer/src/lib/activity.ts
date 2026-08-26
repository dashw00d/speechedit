import { useSyncExternalStore } from 'react'
import type { ModelQueueStatus } from '../../../shared/modelQueue'

export type ActivityState = 'waiting' | 'running' | 'error'

export interface ActivityJob {
  id: string
  label: string
  detail?: string
  ratio?: number
  state: ActivityState
  startedAt: number
  cancellable?: 'import' | 'export'
}

let snapshot: ActivityJob[] = []
const listeners = new Set<() => void>()
const errorTimers = new Map<string, ReturnType<typeof setTimeout>>()

function publish(next: ActivityJob[]): void {
  snapshot = [...next].sort((a, b) => a.startedAt - b.startedAt)
  for (const listener of listeners) listener()
}

export function activityJobs(): ActivityJob[] {
  return snapshot
}

export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useActivityJobs(): ActivityJob[] {
  return useSyncExternalStore(subscribeActivity, activityJobs, activityJobs)
}

export function startActivity(job: Omit<ActivityJob, 'state' | 'startedAt'> & Partial<Pick<ActivityJob, 'state' | 'startedAt'>>): void {
  const previous = snapshot.find((row) => row.id === job.id)
  const next: ActivityJob = {
    state: 'running',
    startedAt: previous?.startedAt ?? Date.now(),
    ...previous,
    ...job
  }
  publish([...snapshot.filter((row) => row.id !== job.id), next])
}

export function updateActivity(id: string, patch: Partial<Omit<ActivityJob, 'id' | 'startedAt'>>): void {
  const current = snapshot.find((row) => row.id === id)
  if (!current) return
  publish([...snapshot.filter((row) => row.id !== id), { ...current, ...patch }])
}

export function finishActivity(id: string): void {
  const timer = errorTimers.get(id)
  if (timer) clearTimeout(timer)
  errorTimers.delete(id)
  if (!snapshot.some((row) => row.id === id)) return
  publish(snapshot.filter((row) => row.id !== id))
}

export function failActivity(id: string, detail: string): void {
  updateActivity(id, { state: 'error', detail, ratio: undefined })
  const prior = errorTimers.get(id)
  if (prior) clearTimeout(prior)
  const timer = setTimeout(() => finishActivity(id), 12_000)
  errorTimers.set(id, timer)
}

export function syncModelActivities(status: ModelQueueStatus): void {
  const nonModel = snapshot.filter((job) => !job.id.startsWith('model:'))
  const modelJobs: ActivityJob[] = status.jobs.flatMap((job) => {
    if (job.state === 'done') return []
    return [{
      id: `model:${job.id}`,
      label: job.label,
      detail:
        job.state === 'waiting'
          ? 'Waiting for the previous model request'
          : job.state === 'error'
            ? job.error ?? 'Model request failed'
            : 'Assistant model is working',
      state: job.state === 'error' ? 'error' : job.state,
      startedAt: job.startedAt ?? job.queuedAt
    }]
  })
  publish([...nonModel, ...modelJobs])
}

export function activityPercent(job: ActivityJob): string {
  return job.ratio == null ? '' : `${Math.round(Math.max(0, Math.min(1, job.ratio)) * 100)}%`
}
