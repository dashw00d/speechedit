import { host, isElectron } from '../host'
import { useEditor, usePlayback } from '../store'
import type { Asset, Project } from '../types'
import { wordsFromAsr } from './asr'
import { startActivity, updateActivity, finishActivity, failActivity } from './activity'
import { createImportSignal, importBusyToast, isJobCancelled, throwIfAborted } from './mediaJobs'
import { primaryAssetAt, primaryTakes, sourceOffsetOf } from './takes'
import { programToSourceOf } from './resolver'
import { isPlaceholderWord } from './transcript'
import { loadSettings } from './settings'

export function transcriptionTarget(project: Project, programTime: number): Asset | undefined {
  const missing = primaryTakes(project).find(asset => asset.path && !project.transcript.words.some(word =>
    !isPlaceholderWord(word) && word.start >= sourceOffsetOf(asset) && word.start < sourceOffsetOf(asset) + asset.duration
  ))
  return missing ?? primaryAssetAt(project, programToSourceOf(project, programTime))
}

/** Shared by transcript recovery and Project settings; updates only the chosen recording. */
export async function transcribeCurrentRecording(onToast: (message: string) => void): Promise<void> {
  const editor = useEditor.getState()
  const blocked = importBusyToast(editor.exporting, editor.analyzing)
  if (blocked) { onToast(blocked); return }
  const project = editor.project
  const asset = transcriptionTarget(project, usePlayback.getState().programTime)
  if (!asset?.path) { onToast('Open a recording first.'); return }
  const settings = loadSettings().transcript
  if (isElectron && settings.kind === 'off') { onToast('Choose a Whisper provider in Project settings first.'); return }
  const signal = createImportSignal()
  const originalTranscript = project.transcript
  const stillCurrent = () => {
    const current = useEditor.getState().project
    return current.id === project.id && current.assets[asset.id] === asset && current.transcript === originalTranscript
  }
  editor.setAnalyzing('transcript')
  startActivity({ id: 'media:transcribe', label: 'Whisper transcription', detail: asset.name, ratio: 0, cancellable: 'import' })
  const stopProgress = host.onTranscribeProgress(info => {
    if (!stillCurrent() || signal.aborted) return
    useEditor.getState().setAnalyzing(`transcript:${info.stage}`)
    updateActivity('media:transcribe', { ratio: info.ratio, detail: info.stage === 'run' ? 'Recognizing words' : 'Preparing transcript' })
  })
  let failed = false
  try {
    await host.beginJob('import')
    const cues = await host.transcribe(asset.path, { ...settings, force: true })
    throwIfAborted(signal, 'import')
    if (!stillCurrent()) { onToast('The recording or transcript changed. Run transcription again to include those changes.'); return }
    const words = wordsFromAsr(cues, project.transcript.speakers[0]?.id ?? 'ryan')
    if (!words.length) throw new Error('Whisper found no spoken words. Try another recording or import a transcript.')
    useEditor.getState().dispatch({ type: 'attachTakeIntel', assetId: asset.id, words, whispered: cues, complete: true })
    onToast(`Transcript ready · ${words.length} words · ${useEditor.getState().project.scenes.length} chapters. Undo restores the previous transcript.`)
  } catch (error) {
    failed = !isJobCancelled(error)
    const message = isJobCancelled(error) ? 'Transcription cancelled.' : error instanceof Error ? error.message : 'Transcription failed.'
    if (failed) failActivity('media:transcribe', message)
    onToast(message)
  } finally {
    stopProgress()
    await host.endJob('import').catch(() => undefined)
    if (useEditor.getState().project.id === project.id) useEditor.getState().setAnalyzing(null)
    if (!failed) finishActivity('media:transcribe')
  }
}
