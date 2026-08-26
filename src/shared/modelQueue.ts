export type ModelQueueJobState = 'waiting' | 'running' | 'done' | 'error'

export interface ModelQueueJob {
  id: string
  label: string
  state: ModelQueueJobState
  queuedAt: number
  startedAt?: number
  finishedAt?: number
  error?: string
}

export interface ModelQueueStatus {
  active: boolean
  pending: number
  jobs: ModelQueueJob[]
}

export interface ModelQueueOptions {
  label?: string
}

interface QueueEntry<T> {
  job: ModelQueueJob
  run: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

const HISTORY_MS = 15_000
const MAX_HISTORY = 5

function errorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason)
  return message.trim().slice(0, 160) || 'Unknown model error'
}

/** A process-wide FIFO with enough state to explain model activity to a person. */
export class ModelQueue {
  private current: QueueEntry<unknown> | undefined
  private readonly entries: QueueEntry<unknown>[] = []
  private readonly history: ModelQueueJob[] = []
  private nextId = 1

  constructor(private readonly changed: (status: ModelQueueStatus) => void = () => undefined) {}

  status(): ModelQueueStatus {
    const jobs = [
      ...(this.current ? [this.current.job] : []),
      ...this.entries.map((entry) => entry.job),
      ...this.history
    ].map((job) => ({ ...job }))
    return { active: Boolean(this.current), pending: this.entries.length, jobs }
  }

  enqueue<T>(run: () => Promise<T>, options: ModelQueueOptions = {}): Promise<T> {
    const job: ModelQueueJob = {
      id: `model-${this.nextId++}`,
      label: options.label?.trim() || 'Assistant request',
      state: 'waiting',
      queuedAt: Date.now()
    }
    const promise = new Promise<T>((resolve, reject) => {
      this.entries.push({ job, run, resolve, reject } as QueueEntry<unknown>)
    })
    this.emit()
    void this.pump()
    return promise
  }

  private emit(): void {
    this.changed(this.status())
  }

  private remember(job: ModelQueueJob): void {
    this.history.unshift(job)
    this.history.splice(MAX_HISTORY)
    const timer = setTimeout(() => {
      const index = this.history.findIndex((item) => item.id === job.id)
      if (index < 0) return
      this.history.splice(index, 1)
      this.emit()
    }, HISTORY_MS)
    ;(timer as unknown as { unref?: () => void }).unref?.()
  }

  private async pump(): Promise<void> {
    if (this.current) return
    const entry = this.entries.shift()
    if (!entry) return
    this.current = entry
    entry.job.state = 'running'
    entry.job.startedAt = Date.now()
    this.emit()
    try {
      const result = await entry.run()
      entry.job.state = 'done'
      entry.resolve(result)
    } catch (err) {
      entry.job.state = 'error'
      entry.job.error = errorMessage(err)
      entry.reject(err)
    } finally {
      entry.job.finishedAt = Date.now()
      this.current = undefined
      this.remember(entry.job)
      this.emit()
      void this.pump()
    }
  }
}
