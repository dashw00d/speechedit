import { host, mediaDisplayName } from '../host'
import { browserMediaKeyForPath } from './browserMediaStore'
import { displaySize, quarterTurn } from '../../../shared/mediaOrient'
import { needsProxy } from '../../../shared/proxy'
import type { Asset, Command, Project, Word } from '../types'
import type { AsrCue } from '../../../shared/asr'
import { buildSuggestions, speechIslands } from './analysis'
import { wordsFromAsr } from './asr'
import { applyCommand } from './commands'
import { assignmentsFromCues, hasProviderSpeakers } from './diarize'
import { inferScenesLocal } from './sceneAnalysis'
import { loadSettings } from './settings'
import { createEmptyProject } from './demo'
import { parseSrt } from './transcript'
import { uid } from './time'
import { failActivity, finishActivity, startActivity, updateActivity } from './activity'
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
  onReady?: (take: InspectedTake) => void | Promise<void>
  onProxy?: (take: InspectedTake) => void | Promise<void>
  onLooks?: (take: InspectedTake) => void | Promise<void>
  onWords?: (take: InspectedTake) => void | Promise<void>
}

export interface InspectedTake {
  asset: Asset
  words: Word[]
  whispered: { text: string; start: number; end: number; speaker?: string }[] | null
  analysis: {
    silence: { start: number; end: number }[]
    scenes: { times: number[]; staticRegions: { start: number; end: number }[] }
    loudness: { start: number; end: number; lufs: number }[]
  }
}

function asOpts(arg?: ((stage: string) => void) | ImportRecordingOpts): ImportRecordingOpts {
  if (!arg) return {}
  if (typeof arg === 'function') return { onStage: arg }
  return arg
}

function emptyIntel(): Pick<InspectedTake, 'words' | 'whispered' | 'analysis'> {
  return {
    words: [],
    whispered: null,
    analysis: { silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] }
  }
}

export async function inspectRecording(
  file: string,
  onStageOrOpts?: ((stage: string) => void) | ImportRecordingOpts
): Promise<InspectedTake> {
  const { onStage, signal, onReady, onProxy, onLooks, onWords } = asOpts(onStageOrOpts)
  throwIfAborted(signal, 'import')
  if (!file) throw new Error('Pick a media file to import.')

  onStage?.('probe')
  const displayName = mediaDisplayName(file)
  startActivity({ id: 'media:probe', label: 'Reading media', detail: displayName })
  const info = await host.probe(file).catch((err) => {
    if (isJobCancelled(err)) throw err
    throw new Error(explainImportError(err))
  }).finally(() => finishActivity('media:probe'))
  throwIfAborted(signal, 'import')

  const name = displayName
  const shown = displaySize(info.width, info.height, info.rotation)
  const displayRotation = quarterTurn(info.rotation)
  const baseAsset: Asset = {
    id: uid('asset'),
    path: file,
    name,
    kind: info.hasVideo ? 'video' : 'audio',
    duration: info.duration,
    width: shown.width,
    height: shown.height,
    fps: info.fps,
    sampleRate: info.sampleRate,
    waveform: [],
    sourceOffset: 0,
    ...(browserMediaKeyForPath(file) ? { browserMediaKey: browserMediaKeyForPath(file) } : {}),
    ...(displayRotation ? { displayRotation } : {}),
    ...(info.codec ? { codec: info.codec } : {}),
    ...(info.vfr ? { vfr: true } : {})
  }
  await onReady?.({
    asset: baseAsset,
    ...emptyIntel()
  })

  const wantProxy = Boolean(info.hasVideo && needsProxy(info))
  let proxyPath = ''
  let looksFinished = false
  let proxyFinished = !wantProxy
  let latestAsset = baseAsset
  let latestAnalysis = emptyIntel().analysis

  const emitWords = (cues: AsrCue[]) => {
    const words = wordsFromAsr(cues)
    if (!words.length) return
    void onWords?.({
      asset: latestAsset,
      words,
      whispered: cues,
      analysis: latestAnalysis
    })
  }

  const proxyP = (async () => {
    if (!wantProxy) return ''
    startActivity({ id: 'media:proxy', label: 'Building preview', detail: 'Smaller editing copy' })
    if (!looksFinished) onStage?.('proxy')
    throwIfAborted(signal, 'import')
    const path = await host.makeProxy(file).catch((err) => {
      if (isJobCancelled(err)) throw err
      return ''
    }).finally(() => finishActivity('media:proxy'))
    throwIfAborted(signal, 'import')
    proxyPath = path
    proxyFinished = true
    await onProxy?.({
      asset: { ...baseAsset, ...(path ? { proxyPath: path } : {}) },
      ...emptyIntel()
    })
    if (!looksFinished) onStage?.('looks')
    return path
  })()

  const looksP = (async () => {
    if (proxyFinished) onStage?.('looks')
    throwIfAborted(signal, 'import')
    startActivity({ id: 'media:analysis', label: 'Analyzing picture and sound', detail: 'Pauses, motion, and loudness' })
    const stopAnalyzeProgress = host.onAnalyzeProgress((info) => {
      updateActivity('media:analysis', { ratio: info.ratio, detail: info.stage })
    })
    const analysisP = host.analyze(file).catch(async (err) => {
      if (isJobCancelled(err)) throw err
      const silence = await host.silence(file).catch((inner) => {
        if (isJobCancelled(inner)) throw inner
        throw new Error(explainImportError(err))
      })
      return { silence, scenes: { times: [], staticRegions: [] }, loudness: [] }
    }).finally(() => {
      stopAnalyzeProgress()
      finishActivity('media:analysis')
    })
    startActivity({ id: 'media:waveform', label: 'Drawing waveform', detail: 'One audio pass' })
    const peaksP = host.waveform(file).catch((err) => {
      if (isJobCancelled(err)) throw err
      throw new Error(explainImportError(err))
    }).finally(() => finishActivity('media:waveform'))
    startActivity({ id: 'media:thumbnails', label: 'Generating thumbnails', detail: 'Timeline preview frames' })
    const thumbsP = host.thumbnails(file).catch((err) => {
      if (isJobCancelled(err)) throw err
      return []
    }).finally(() => finishActivity('media:thumbnails'))
    const [peaks, thumbs, analysis] = await Promise.all([peaksP, thumbsP, analysisP])
    throwIfAborted(signal, 'import')
    looksFinished = true
    const withLooks: InspectedTake = {
      asset: {
        ...baseAsset,
        waveform: peaks,
        thumbnails: thumbs,
        ...(proxyPath ? { proxyPath } : {})
      },
      words: [],
      whispered: null,
      analysis
    }
    latestAsset = withLooks.asset
    latestAnalysis = withLooks.analysis
    await onLooks?.(withLooks)
    return withLooks
  })()

  const asrP = (async () => {
    startActivity({ id: 'media:transcribe', label: 'Whisper transcription', detail: 'Preparing audio', ratio: 0.05 })
    let keepErrorVisible = false
    const stopProgress = host.onTranscribeProgress((info) => {
      const stage = {
        prepare: 'Preparing audio',
        install: 'Installing local Whisper',
        audio: 'Extracting speech audio',
        run: info.chunk ? `Transcribing chunk ${info.chunk.finished} of ${info.chunk.total}` : 'Recognizing words',
        parse: 'Building word timings',
        done: 'Transcript ready'
      }[info.stage]
      updateActivity('media:transcribe', { ratio: info.ratio, detail: stage })
      if (looksFinished) onStage?.(`transcript:${info.stage}`)
      if (info.cues?.length) emitWords(info.cues)
    })
    const kind = loadSettings().transcript.kind
    try {
      try {
        return await host.transcribe(file, loadSettings().transcript)
      } catch (err) {
        if (isJobCancelled(err)) throw err
        const explained = explainImportError(err)
        if (/FFmpeg did not start|Can't open that recording/i.test(explained)) throw new Error(explained)
        if (isWhisperUnavailable(err) || kind !== 'off') {
          failActivity('media:transcribe', explained)
          keepErrorVisible = true
          return null
        }
        throw new Error(explained)
      }
    } finally {
      stopProgress()
      if (!keepErrorVisible) finishActivity('media:transcribe')
    }
  })()

  const [withLooks, madeProxy] = await Promise.all([looksP, proxyP])
  const kind = loadSettings().transcript.kind
  let whispered: InspectedTake['whispered']
  try {
    whispered = await asrP
  } catch (err) {
    if (isJobCancelled(err)) throw err
    throw err
  }
  throwIfAborted(signal, 'import')
  if (!whispered && kind && kind !== 'off') onStage?.('transcript:missing')
  else onStage?.('transcript')
  let words = wordsFromAsr(whispered)
  if (!words.length) {
    if (kind && kind !== 'off' && !whispered) onStage?.('transcript:missing')
    onStage?.('transcript:islands')
    words = wordsFromIslands(speechIslands(info.duration, withLooks.analysis.silence))
  }

  return {
    asset: {
      ...withLooks.asset,
      ...(madeProxy ? { proxyPath: madeProxy } : {})
    },
    words,
    whispered,
    analysis: withLooks.analysis
  }
}

export function projectFromTake(take: InspectedTake): Project {
  const { asset, words, whispered, analysis } = take
  const base = createEmptyProject(asset.name.replace(/\.[^.]+$/, ''))
  const draft = {
    ...base,
    sourceDuration: asset.duration,
    width: asset.width ?? 1920,
    height: asset.height ?? 1080,
    fps: asset.fps && asset.fps < 120 ? Math.round(asset.fps) : 30,
    assets: { [asset.id]: asset },
    transcript: { ...base.transcript, words },
    analysis: {
      silence: analysis.silence,
      staticRegions: analysis.scenes.staticRegions,
      sceneTimes: analysis.scenes.times,
      loudness: analysis.loudness
    },
    suggestions: buildSuggestions({
      duration: asset.duration,
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

export function importedProxyCommands(project: Project, take: InspectedTake): Command[] {
  if (!project.assets[take.asset.id] || !take.asset.proxyPath) return []
  return [{ type: 'setAssetProxy', assetId: take.asset.id, proxyPath: take.asset.proxyPath }]
}

export function importedLooksCommands(project: Project, take: InspectedTake): Command[] {
  if (!project.assets[take.asset.id]) return []
  return [
    {
      type: 'setAssetLooks',
      assetId: take.asset.id,
      waveform: take.asset.waveform,
      thumbnails: take.asset.thumbnails,
      ...(take.asset.proxyPath ? { proxyPath: take.asset.proxyPath } : {})
    },
    {
      type: 'attachTakeIntel',
      assetId: take.asset.id,
      analysis: {
        silence: take.analysis.silence,
        staticRegions: take.analysis.scenes.staticRegions,
        sceneTimes: take.analysis.scenes.times,
        loudness: take.analysis.loudness
      }
    }
  ]
}

export function importedWordsCommands(project: Project, take: InspectedTake, complete = false): Command[] {
  if (!project.assets[take.asset.id] || !take.words.length) return []
  return [
    {
      type: 'attachTakeIntel',
      assetId: take.asset.id,
      words: take.words,
      whispered: take.whispered,
      complete
    }
  ]
}

export function importedTakeCommands(project: Project, take: InspectedTake): Command[] {
  return [...importedLooksCommands(project, take), ...importedWordsCommands(project, take, true)]
}

export function fillImportedTake(project: Project, take: InspectedTake): Project {
  return importedTakeCommands(project, take).reduce((next, command) => applyCommand(next, command), project)
}

export async function importRecording(
  file: string,
  onStageOrOpts?: ((stage: string) => void) | ImportRecordingOpts
): Promise<Project> {
  return projectFromTake(await inspectRecording(file, onStageOrOpts))
}

export async function appendTakeFromFile(
  project: Project,
  file: string,
  onStageOrOpts?: ((stage: string) => void) | ImportRecordingOpts
): Promise<Project> {
  const opts = asOpts(onStageOrOpts)
  let next = project
  let opened = false
  const take = await inspectRecording(file, {
    ...opts,
    onReady: (partial) => {
      opened = true
      next = applyCommand(next, { type: 'appendTake', asset: partial.asset, words: [] })
      opts.onReady?.(partial)
    },
    onProxy: (partial) => {
      if (partial.asset.proxyPath) {
        next = applyCommand(next, {
          type: 'setAssetProxy',
          assetId: partial.asset.id,
          proxyPath: partial.asset.proxyPath
        })
      }
      opts.onProxy?.(partial)
    }
  })
  if (opened) return fillImportedTake(next, take)
  return applyCommand(next, {
    type: 'appendTake',
    asset: take.asset,
    words: take.words,
    analysis: {
      silence: take.analysis.silence,
      staticRegions: take.analysis.scenes.staticRegions,
      sceneTimes: take.analysis.scenes.times,
      loudness: take.analysis.loudness
    }
  })
}

export { parseSrt, whisperMissingMessage }
