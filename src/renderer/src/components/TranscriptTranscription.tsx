import { isElectron } from '../host'
import { useEditor } from '../store'
import { useBrowserWhisperState } from '../lib/browserWhisper'
import { useActivityJobs } from '../lib/activity'
import { cancelImport } from '../lib/mediaJobs'
import { primaryTakes } from '../lib/takes'
import { transcribeCurrentRecording } from '../lib/transcribeAction'
import { transcriptIsPlaceholder } from '../lib/transcript'

export function TranscriptTranscription({ onToast = () => undefined }: { onToast?: (message: string) => void }) {
  const project = useEditor(s => s.project)
  const analyzing = useEditor(s => s.analyzing)
  const exporting = useEditor(s => s.exporting)
  const whisper = useBrowserWhisperState()
  const jobs = useActivityJobs()
  const job = jobs.find(row => row.id === 'media:transcribe')
  const missing = !project.transcript.words.length || transcriptIsPlaceholder(project.transcript.words)
  const transcribing = Boolean(analyzing && /transcript|whisper/.test(analyzing))
  if (!primaryTakes(project).some(asset => asset.path) || (!missing && !transcribing)) return null
  return (
    <section className="transcript-transcription" aria-label="Transcribe recording">
      <strong>{transcribing ? 'Transcribing your recording' : analyzing ? 'Preparing your recording' : 'Turn this recording into words and chapters'}</strong>
      <p role="status">
        {job?.state === 'error' ? job.detail
          : transcribing && !isElectron && whisper.state === 'loading' ? whisper.detail
            : transcribing ? 'Whisper is running. Words and chapters will appear when it finishes.'
              : 'Transcription starts automatically on import. Use Transcribe to retry or transcribe this recording now.'}
      </p>
      {!isElectron && <small>{whisper.fallbackReason
        ? 'Using your CPU for private transcription. A GPU is optional; this may take longer.'
        : 'Your recording stays on this device.'}</small>}
      <button className="transcript-transcribe-button" disabled={Boolean(analyzing) || exporting}
        onClick={() => void transcribeCurrentRecording(onToast)}>
        {transcribing ? 'Transcribing…' : analyzing ? 'Preparing…' : 'TRANSCRIBE'}
      </button>
      {transcribing && <button className="chip" onClick={() => void cancelImport().catch(error => onToast(String(error)))}>Cancel transcription</button>}
    </section>
  )
}
