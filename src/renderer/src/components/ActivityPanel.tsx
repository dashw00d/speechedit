import { useEffect, useState } from 'react'
import { cancelExport, cancelImport } from '../lib/mediaJobs'
import { activityPercent, useActivityJobs } from '../lib/activity'

function elapsed(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function ActivityPanel({ compact = false }: { compact?: boolean }) {
  const jobs = useActivityJobs()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!jobs.length) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [jobs.length])
  if (!jobs.length) return null
  const shown = compact ? jobs.slice(0, 3) : jobs

  return (
    <section className="activity-panel" data-compact={compact || undefined} aria-live="polite">
      <header>
        <span>
          <strong>{jobs.some((job) => job.state !== 'error') ? 'Working' : 'Needs attention'}</strong>
          <small>{jobs.length} {jobs.length === 1 ? 'process' : 'processes'}</small>
        </span>
        {jobs.length > shown.length && <small>+{jobs.length - shown.length} more</small>}
      </header>
      <ol>
        {shown.map((job) => (
          <li key={job.id} data-state={job.state}>
            <i aria-hidden />
            <span>
              <strong>{job.label}</strong>
              <small>{job.detail ?? (job.state === 'waiting' ? 'Waiting' : 'In progress')} · {elapsed(job.startedAt, now)}</small>
              {job.ratio != null && <progress max={1} value={job.ratio} aria-label={activityPercent(job)} />}
            </span>
            {job.ratio != null && <b>{activityPercent(job)}</b>}
            {job.cancellable && (
              <button
                type="button"
                onClick={() => void (job.cancellable === 'export' ? cancelExport() : cancelImport())}
              >
                Cancel
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

export function ActivityStrip() {
  const jobs = useActivityJobs()
  if (!jobs.length) return null
  const first = jobs.find((job) => job.state === 'running') ?? jobs[0]
  return (
    <button
      type="button"
      className="activity-strip"
      data-state={first.state}
      onClick={() => window.dispatchEvent(new Event('speechedit:project-settings'))}
      title="Open Project activity"
    >
      <i aria-hidden />
      <span><strong>{first.label}</strong><small>{first.detail ?? 'In progress'}</small></span>
      {first.ratio != null ? <b>{activityPercent(first)}</b> : <b>{jobs.length > 1 ? `+${jobs.length - 1}` : 'Working'}</b>}
    </button>
  )
}
