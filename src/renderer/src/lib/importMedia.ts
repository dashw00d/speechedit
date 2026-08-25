import { host } from '../host'
import type { Asset, Project, Word } from '../types'
import { buildSuggestions, speechIslands } from './analysis'
import { wordsFromAsr } from './asr'
import { applyCommand } from './commands'
import { assignmentsFromCues, hasProviderSpeakers } from './diarize'
import { inferScenesLocal } from './sceneAnalysis'
import { loadSettings } from './settings'
import { createEmptyProject } from './demo'
import { parseSrt } from './transcript'
import { uid } from './time'
import { wordsFromIslands } from './transcript'
import {
  explainImportError,
  isJobCancelled,
  isWhisperUnavailable,
  throwIfAborted,
  whisperMissingMessage
} from '../../../shared/mediaJob'

export interface ImportRecordingOpts {
  onStage?: (stage: string) => void
  signal?: AbortSignal
}

function asOpts(arg?: ((stage: string) => void) | ImportRecordingOpts): ImportRecordingOpts {
  if (!arg) return {}
  if (typeof arg === 'function') return { onStage: arg }
  return arg
}

export async function importRecording(
  file: string,
  onStageOrOpts?: ((stage: string) => void) | ImportRecordingOpts
): Promise<Project> {
  const { onStage, signal } = asOpts(onStageOrOpts)
  throwIfAborted(signal, 'import')
  if (!file) throw new Error('Pick a media file to import.')

  onStage?.('probe')
  const info = await host.probe(file).catch((err) => {
    if (isJobCancelled(err)) throw err
    throw new Error(explainImportError(err))
  })
  throwIfAborted(signal, 'import')

  onStage?.('waveform')
  const peaks = await host.waveform(file).catch((err) => {
    if (isJobCancelled(err)) throw err
    throw new Error(explainImportError(err))
  })
  throwIfAborted(signal, 'import')

  onStage?.('thumbnails')
  const thumbs = await host.thumbnails(file).catch((err) => {
    if (isJobCancelled(err)) throw err
    return []
  })
  throwIfAborted(signal, 'import')

  onStage?.('analyze')
  const analysis = await host.analyze(file).catch(async (err) => {
    if (isJobCancelled(err)) throw err
    const silence = await host.silence(file).catch((inner) => {
      if (isJobCancelled(inner)) throw inner
      throw new Error(explainImportError(err))
    })
    return { silence, scenes: { times: [], staticRegions: [] }, loudness: [] }
  })
  throwIfAborted(signal, 'import')

  onStage?.('transcript')
  const stopProgress = host.onTranscribeProgress((info) => {
    onStage?.(`transcript:${info.stage}`)
  })
  let words: Word[] = []
  let whispered: { text: string; start: number; end: number; speaker?: string }[] | null = null
  const kind = loadSettings().transcript.kind
  try {
    try {
      whispered = await host.transcribe(file, loadSettings().transcript)
    } catch (err) {
      if (isJobCancelled(err)) throw err
      const explained = explainImportError(err)
      if (/FFmpeg did not start|Can't open that recording/i.test(explained)) throw new Error(explained)
      if (isWhisperUnavailable(err) || kind !== 'off') {
        onStage?.('transcript:missing')
        whispered = null
      } else {
        throw new Error(explained)
      }
    }
    words = wordsFromAsr(whispered)
    if (!words.length) {
      if (kind && kind !== 'off' && !whispered) onStage?.('transcript:missing')
      onStage?.('transcript:islands')
      words = wordsFromIslands(speechIslands(info.duration, analysis.silence))
    }
  } finally {
    stopProgress()
  }
  throwIfAborted(signal, 'import')

  const name = file.split(/[\\/]/).pop() ?? 'Recording'
  const asset: Asset = {
    id: uid('asset'),
    path: file,
    name,
    kind: info.hasVideo ? 'video' : 'audio',
    duration: info.duration,
    width: info.width,
    height: info.height,
    fps: info.fps,
    sampleRate: info.sampleRate,
    waveform: peaks,
    thumbnails: thumbs
  }
  const base = createEmptyProject(name.replace(/\.[^.]+$/, ''))
  const draft = {
    ...base,
    sourceDuration: info.duration,
    width: info.width ?? 1920,
    height: info.height ?? 1080,
    fps: info.fps && info.fps < 120 ? Math.round(info.fps) : 30,
    assets: { [asset.id]: asset },
    transcript: { ...base.transcript, words },
    analysis: {
      silence: analysis.silence,
      staticRegions: analysis.scenes.staticRegions,
      loudness: analysis.loudness
    },
    suggestions: buildSuggestions({
      duration: info.duration,
      silence: analysis.silence,
      scenes: analysis.scenes.times,
      sceneHits: analysis.scenes.staticRegions,
      loudnessWindows: analysis.loudness,
      words,
      margin: base.cutMargin
    })
  }
  const intel = inferScenesLocal(draft)
  const withScenes = {
    ...draft,
    scenes: intel.scenes,
    suggestions: [...draft.suggestions, ...intel.suggestions]
  }
  if (whispered && hasProviderSpeakers(whispered)) {
    return applyCommand(withScenes, {
      type: 'applyDiarization',
      assignments: assignmentsFromCues(whispered)
    })
  }
  return withScenes
}

export { parseSrt, whisperMissingMessage }
