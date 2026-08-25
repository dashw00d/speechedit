import {
  DEFAULT_ANALYSIS,
  DEFAULT_AUDIO_MASTER,
  DEFAULT_CROP,
  DEFAULT_TRANSFORM,
  emptyClipFields,
  type Project,
  type Transform
} from '../types'
import { annotateProtected } from './analysis'
import { defaultSpeakerColor } from './theme'
import { normalizeScenes } from './sceneAnalysis'
import { ensurePrimaryOffsets } from './takes'

function normalizeTransform(t?: Partial<Transform>): Transform {
  return {
    ...DEFAULT_TRANSFORM,
    ...t,
    crop: { ...DEFAULT_CROP, ...t?.crop }
  }
}

export function normalizeProject(project: Project): Project {
  return {
    ...project,
    splits: project.splits ?? [],
    styles: (project.styles ?? []).map((style) => ({
      ...style,
      transform: normalizeTransform(style.transform)
    })),
    picture: normalizeTransform(project.picture),
    tags: project.tags ?? [],
    inserts: project.inserts ?? [],
    scenes: normalizeScenes(project.scenes),
    suggestions: annotateProtected(project.suggestions ?? [], project.tags ?? []),
    audioMaster: { ...DEFAULT_AUDIO_MASTER, ...project.audioMaster },
    cutMargin: project.cutMargin ?? 0.12,
    encoder: project.encoder ?? 'auto',
    analysis: {
      silence: project.analysis?.silence ?? DEFAULT_ANALYSIS.silence,
      staticRegions: project.analysis?.staticRegions ?? DEFAULT_ANALYSIS.staticRegions,
      loudness: project.analysis?.loudness ?? DEFAULT_ANALYSIS.loudness
    },
    transcript: {
      words: (project.transcript?.words ?? []).map((w) => ({
        ...w,
        speaker: w.speaker || 'ryan'
      })),
      speakers: project.transcript?.speakers?.length
        ? project.transcript.speakers
        : [{ id: 'ryan', name: 'Speaker 1', color: defaultSpeakerColor() }]
    },
    markIn: project.markIn ?? null,
    markOut: project.markOut ?? null,
    assets: ensurePrimaryOffsets({
      tracks: project.tracks ?? [],
      assets: Object.fromEntries(
        Object.entries(project.assets ?? {}).map(([id, asset]) => [
          id,
          { ...asset, waveform: asset.waveform ?? [] }
        ])
      )
    }),
    tracks: project.tracks.map((track) => ({
      ...track,
      solo: Boolean(track.solo),
      clips: track.clips.map((clip) => ({
        ...emptyClipFields(),
        ...clip,
        transform: normalizeTransform(clip.transform),
        keyframes: clip.keyframes ?? []
      }))
    }))
  }
}
