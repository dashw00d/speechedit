import { host } from '../host'
import type { Asset, Project, Word } from '../types'
import { buildSuggestions, speechIslands } from './analysis'
import { wordsFromAsr } from './asr'
import { inferScenesLocal } from './sceneAnalysis'
import { loadSettings } from './settings'
import { createEmptyProject } from './demo'
import { parseSrt } from './transcript'
import { uid } from './time'
import { wordsFromIslands } from './transcript'

export async function importRecording(
  file: string,
  onStage?: (stage: string) => void
): Promise<Project> {
  onStage?.('probe')
  const info = await host.probe(file)
  onStage?.('waveform')
  const peaks = await host.waveform(file)
  onStage?.('thumbnails')
  const thumbs = await host.thumbnails(file).catch(() => [])
  onStage?.('analyze')
  const analysis = await host.analyze(file).catch(async () => ({
    silence: await host.silence(file),
    scenes: { times: [], staticRegions: [] },
    loudness: []
  }))
  onStage?.('transcript')
  const stopProgress = host.onTranscribeProgress((info) => {
    onStage?.(`transcript:${info.stage}`)
  })
  let words: Word[] = []
  try {
    const whispered = await host.transcribe(file, loadSettings().transcript).catch(() => null)
    words = wordsFromAsr(whispered)
    if (!words.length) {
      onStage?.('transcript:islands')
      words = wordsFromIslands(speechIslands(info.duration, analysis.silence))
    }
  } finally {
    stopProgress()
  }

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
  return {
    ...draft,
    scenes: intel.scenes,
    suggestions: [...draft.suggestions, ...intel.suggestions]
  }
}

export { parseSrt }
