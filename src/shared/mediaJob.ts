/** One media job at a time. Main kills children; renderer tracks busy/cancel. */

import { explainMediaToolFailure } from './mediaTools'

export type MediaJobKind = 'export' | 'import'

export class JobCancelled extends Error {
  readonly cancelled = true
  constructor(kind?: MediaJobKind | string) {
    super(kind === 'export' ? 'Export cancelled.' : kind === 'import' ? 'Import cancelled.' : 'Cancelled.')
    this.name = 'JobCancelled'
  }
}

export class JobBusy extends Error {
  readonly busy: MediaJobKind
  constructor(kind: MediaJobKind) {
    super(busyMessage(kind))
    this.name = 'JobBusy'
    this.busy = kind
  }
}

export function busyMessage(kind: MediaJobKind): string {
  return kind === 'export'
    ? 'An export is already running. Cancel it first.'
    : 'Import is still running. Cancel it first.'
}

export function isJobCancelled(err: unknown): boolean {
  if (err instanceof JobCancelled) return true
  const msg = err instanceof Error ? err.message : String(err)
  return /\b(export |import )?cancelled\.?$/i.test(msg)
}

export function isJobBusy(err: unknown): boolean {
  if (err instanceof JobBusy) return true
  const msg = err instanceof Error ? err.message : String(err)
  return /already running|still running/i.test(msg)
}

export function whisperMissingMessage(): string {
  return 'No local Whisper. SpeechEdit looks for whisper.cpp in ~/.speechedit, then whisper / faster-whisper / mlx_whisper on PATH. Drop Whisper JSON on the transcript, or set an OpenAI-compatible URL in Models.'
}

export function isWhisperUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    err instanceof Error && err.name === 'WhisperUnavailable'
  ) || /No local Whisper|Need a ggml Whisper model|Whisper is not on PATH|whisper.*not (found|on PATH)|Set a transcription/i.test(msg)
}

export class WhisperUnavailable extends Error {
  constructor(message = whisperMissingMessage()) {
    super(message)
    this.name = 'WhisperUnavailable'
  }
}

export function throwIfAborted(signal?: AbortSignal, kind?: MediaJobKind): void {
  if (signal?.aborted) throw new JobCancelled(kind)
}

export class JobGate {
  private current: { kind: MediaJobKind; abort: AbortController } | null = null

  get kind(): MediaJobKind | null {
    return this.current?.kind ?? null
  }

  get signal(): AbortSignal | undefined {
    return this.current?.abort.signal
  }

  start(kind: MediaJobKind): AbortSignal {
    if (this.current) throw new JobBusy(this.current.kind)
    const abort = new AbortController()
    this.current = { kind, abort }
    return abort.signal
  }

  cancel(kind?: MediaJobKind): boolean {
    if (!this.current) return false
    if (kind && this.current.kind !== kind) return false
    this.current.abort.abort()
    return true
  }

  finish(kind?: MediaJobKind): void {
    if (!this.current) return
    if (kind && this.current.kind !== kind) return
    this.current = null
  }
}

export type ImportLingerKind = 'proxy' | 'whisper'

/** Minimal child surface so linger park/resume works in tests without spawning. */
export interface ParkableChild {
  pid?: number | undefined
  exitCode: number | null
  signalCode: NodeJS.Signals | string | null
  kill(signal?: NodeJS.Signals | number): boolean
  once(event: 'close', listener: () => void): unknown
}

export type ChildParker = (child: ParkableChild) => void

function defaultPark(child: ParkableChild): void {
  if (child.exitCode != null || child.signalCode != null) return
  if (process.platform === 'win32') return
  try {
    child.kill('SIGSTOP')
  } catch {
    /* gone */
  }
}

function defaultUnpark(child: ParkableChild): void {
  if (child.exitCode != null || child.signalCode != null) return
  if (process.platform === 'win32') return
  try {
    child.kill('SIGCONT')
  } catch {
    /* gone */
  }
}

/** Background import work (Whisper, preview proxy) that must not hold the ffmpeg job gate. */
export class ImportLinger {
  private controllers = new Map<AbortController, ImportLingerKind>()
  private children = new Map<AbortController, Set<ParkableChild>>()
  private parked = new Set<ImportLingerKind>()
  private park: ChildParker = defaultPark
  private unpark: ChildParker = defaultUnpark

  /** Main process swaps in SIGSTOP + Windows priority. Tests can inject a spy. */
  setParker(park: ChildParker, unpark: ChildParker): void {
    this.park = park
    this.unpark = unpark
  }

  get size(): number {
    return this.controllers.size
  }

  sizeOf(kind: ImportLingerKind): number {
    return [...this.controllers.values()].filter((row) => row === kind).length
  }

  isParked(kind: ImportLingerKind): boolean {
    return this.parked.has(kind)
  }

  begin(kind: ImportLingerKind = 'proxy'): AbortSignal {
    const abort = new AbortController()
    this.controllers.set(abort, kind)
    this.children.set(abort, new Set())
    abort.signal.addEventListener(
      'abort',
      () => {
        this.controllers.delete(abort)
        this.children.delete(abort)
      },
      { once: true }
    )
    return abort.signal
  }

  adopt(signal: AbortSignal, child: ParkableChild): void {
    for (const [abort, kind] of this.controllers) {
      if (abort.signal !== signal) continue
      const set = this.children.get(abort) ?? new Set()
      set.add(child)
      this.children.set(abort, set)
      child.once('close', () => set.delete(child))
      if (this.parked.has(kind)) this.park(child)
      return
    }
  }

  pause(kind: ImportLingerKind): void {
    this.parked.add(kind)
    for (const child of this.childrenOf(kind)) this.park(child)
  }

  resume(kind: ImportLingerKind): void {
    this.parked.delete(kind)
    for (const child of this.childrenOf(kind)) this.unpark(child)
  }

  private childrenOf(kind: ImportLingerKind): ParkableChild[] {
    const out: ParkableChild[] = []
    for (const [abort, row] of this.controllers) {
      if (row !== kind) continue
      for (const child of this.children.get(abort) ?? []) out.push(child)
    }
    return out
  }

  finish(signal: AbortSignal): void {
    for (const abort of this.controllers.keys()) {
      if (abort.signal === signal) {
        this.controllers.delete(abort)
        this.children.delete(abort)
        break
      }
    }
  }

  abort(kind?: ImportLingerKind): void {
    if (!kind || kind === 'whisper') this.resume('whisper')
    for (const [abort, row] of [...this.controllers]) {
      if (kind && row !== kind) continue
      this.controllers.delete(abort)
      this.children.delete(abort)
      abort.abort()
    }
  }

  abortAll(): void {
    this.abort()
  }
}

export function beginExportExclusive(jobs: JobGate, lingers: ImportLinger): AbortSignal {
  const signal = jobs.start('export')
  lingers.abort('proxy')
  lingers.pause('whisper')
  return signal
}

/** Drop the export gate and let parked Whisper continue from where it stopped. */
export function endExportExclusive(jobs: JobGate, lingers: ImportLinger): void {
  jobs.finish('export')
  lingers.resume('whisper')
}

export function waitWhileExporting(jobs: JobGate, signal: AbortSignal, intervalMs = 25): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setInterval> | undefined
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      if (timer) clearInterval(timer)
      signal.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = () => finish(() => reject(new JobCancelled('import')))
    if (signal.aborted) {
      reject(new JobCancelled('import'))
      return
    }
    if (jobs.kind !== 'export') {
      resolve()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    timer = setInterval(() => {
      if (signal.aborted) {
        onAbort()
        return
      }
      if (jobs.kind !== 'export') finish(() => resolve())
    }, intervalMs)
  })
}

/** Preview proxy waits for export, and retries if export preempts the encode. */
export async function runWhenExportIdle<T>(
  jobs: JobGate,
  lingers: ImportLinger,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  for (;;) {
    const signal = lingers.begin('proxy')
    try {
      await waitWhileExporting(jobs, signal)
      return await work(signal)
    } catch (err) {
      if (isJobCancelled(err) && jobs.kind === 'export') continue
      throw err
    } finally {
      lingers.finish(signal)
    }
  }
}

export function explainImportError(err: unknown): string {
  if (isJobCancelled(err)) return err instanceof Error ? err.message : 'Import cancelled.'
  if (isJobBusy(err)) return err instanceof Error ? err.message : busyMessage('import')
  if (isWhisperUnavailable(err)) return whisperMissingMessage()
  const msg = err instanceof Error ? err.message : String(err)
  const tools = explainMediaToolFailure(msg)
  if (tools) return tools
  if (/ENOENT|no such file|does not exist|Error opening input|Can't open that recording/i.test(msg)) {
    const path = msg.match(/(?:recording:\n|file: )(.+)/)?.[1]
    return path
      ? `Can't open that recording:\n${path}\nPick a real media file.`
      : `Can't open that recording. Pick a real media file.\n${msg}`
  }
  return msg
}

export function asMediaJobKind(value: unknown): MediaJobKind | null {
  return value === 'export' || value === 'import' ? value : null
}
