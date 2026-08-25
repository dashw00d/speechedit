import { host } from '../host'
import { busyMessage } from '../../../shared/mediaJob'

export {
  JobBusy,
  JobCancelled,
  JobGate,
  ImportLinger,
  beginExportExclusive,
  busyMessage,
  explainImportError,
  isJobBusy,
  isJobCancelled,
  isWhisperUnavailable,
  runWhenExportIdle,
  throwIfAborted,
  whisperMissingMessage
} from '../../../shared/mediaJob'
export type { ImportLingerKind } from '../../../shared/mediaJob'

let importAbort: AbortController | null = null

export function createImportSignal(): AbortSignal {
  importAbort = new AbortController()
  return importAbort.signal
}

export async function cancelImport(): Promise<void> {
  importAbort?.abort()
  await host.cancelJob('import')
}

export async function cancelExport(): Promise<void> {
  await host.cancelJob('export')
}

/** Waveform / analyze hold ffmpeg. Transcript, Whisper, and a lingering preview proxy do not block export. */
export function ffmpegImportBusy(analyzing: string | null): boolean {
  if (!analyzing) return false
  return !/transcript|whisper|islands|preview/i.test(analyzing)
}

export function mediaBusyToast(exporting: boolean, analyzing: string | null): string | null {
  if (exporting) return busyMessage('export')
  if (ffmpegImportBusy(analyzing)) return busyMessage('import')
  return null
}

export function importBusyToast(exporting: boolean, analyzing: string | null): string | null {
  if (exporting) return busyMessage('export')
  if (analyzing) return busyMessage('import')
  return null
}
