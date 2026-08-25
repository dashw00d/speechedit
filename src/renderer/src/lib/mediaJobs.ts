import { host } from '../host'
import { busyMessage } from '../../../shared/mediaJob'

export {
  JobBusy,
  JobCancelled,
  JobGate,
  busyMessage,
  explainImportError,
  isJobBusy,
  isJobCancelled,
  isWhisperUnavailable,
  whisperMissingMessage
} from '../../../shared/mediaJob'

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

export function mediaBusyToast(exporting: boolean, analyzing: string | null): string | null {
  if (exporting) return busyMessage('export')
  if (analyzing) return busyMessage('import')
  return null
}
