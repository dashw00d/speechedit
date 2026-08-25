/** One media job at a time. Main kills children; renderer tracks busy/cancel. */

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

export function explainImportError(err: unknown): string {
  if (isJobCancelled(err)) return err instanceof Error ? err.message : 'Import cancelled.'
  if (isJobBusy(err)) return err instanceof Error ? err.message : busyMessage('import')
  if (isWhisperUnavailable(err)) return whisperMissingMessage()
  const msg = err instanceof Error ? err.message : String(err)
  if (/ffmpeg|ffprobe/i.test(msg) && /ENOENT|not found|did not start|spawn /i.test(msg)) {
    return 'FFmpeg did not start. Install ffmpeg 4.4+ (and ffprobe) and keep them on PATH.'
  }
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
