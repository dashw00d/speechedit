import { host } from '../host'
import type { Asset, Project, Word } from '../types'
import { buildSuggestions, speechIslands } from './analysis'
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
  const whispered = await host.transcribe(file, loadSettings().transcript).catch(() => null)
  let words: Word[] = []
  if (whispered?.length) {
    const wordLike = whispered.filter((c) => !/\s/.test(c.text.trim())).length >= whispered.length * 0.6
    words = whispered.flatMap((seg) => {
      const tokens = wordLike ? [seg.text.trim()] : seg.text.split(/\s+/).filter(Boolean)
      return tokens.map((text, i) => ({
        id: uid('w'),
        text,
        start: seg.start + ((seg.end - seg.start) * i) / Math.max(1, tokens.length),
        end: seg.start + ((seg.end - seg.start) * (i + 1)) / Math.max(1, tokens.length),
        speaker: 'ryan',
        deleted: false
      }))
    })
  } else {
    words = wordsFromIslands(speechIslands(info.duration, analysis.silence))
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
  const draft: Project = {
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
