export type TrackType = 'video' | 'audio' | 'overlay' | 'caption'
export type SuggestionType =
  | 'silence'
  | 'filler'
  | 'repeat'
  | 'static'
  | 'low-motion'
  | 'loud'
  | 'pace'
  | 'model'
export type SuggestionAction = 'cut' | 'speed' | 'review' | 'normalize'
export type TagKind = 'keep' | 'demo' | 'note'
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'

export interface Interval {
  start: number
  end: number
}

export interface Asset {
  id: string
  path: string
  name: string
  kind: 'video' | 'audio' | 'image'
  duration: number
  width?: number
  height?: number
  fps?: number
  sampleRate?: number
  waveform: number[]
  thumbnails?: string[]
}

export interface Crop {
  x: number
  y: number
  w: number
  h: number
}

export interface Transform {
  x: number
  y: number
  scale: number
  rotation: number
  opacity: number
  crop: Crop
}

export interface Keyframe {
  time: number
  transform: Partial<Transform>
  easing: Easing
}

export type TitlePreset = 'title' | 'lower-third' | 'chapter'

export interface CaptionStyle {
  fontSize: number
  align: 'left' | 'center' | 'right'
  fill: string
  stroke: string
  position: 'lower' | 'center' | 'upper'
}

export interface Clip {
  id: string
  trackId: string
  assetId?: string
  start: number
  duration: number
  inPoint: number
  outPoint: number
  linkedClipId?: string
  transform: Transform
  volume: number
  muted: boolean
  speed: number
  fadeIn: number
  fadeOut: number
  keyframes: Keyframe[]
  text?: string
  style?: CaptionStyle
  effect?: 'none' | 'blur'
}

export interface Track {
  id: string
  type: TrackType
  name: string
  locked: boolean
  muted: boolean
  hidden: boolean
  clips: Clip[]
}

export interface Word {
  id: string
  text: string
  start: number
  end: number
  speaker: string
  deleted: boolean
}

export interface Speaker {
  id: string
  name: string
  color: string
}

export interface Cut {
  id: string
  start: number
  end: number
  source: 'transcript' | 'silence' | 'manual' | 'filler' | 'repeat' | 'model'
}

export interface SegmentStyle {
  id: string
  start: number
  end: number
  speed: number
  transform: Transform
  volume: number
  fadeIn: number
  fadeOut: number
  keyframes: Keyframe[]
}

export interface EditSuggestion {
  id: string
  type: SuggestionType
  start: number
  end: number
  action: SuggestionAction
  label: string
  safe: boolean
  applied: boolean
  speed?: number
  blockedBy?: string
}

export interface RangeTag {
  id: string
  start: number
  end: number
  kind: TagKind
  label: string
}

export interface EditorialScene {
  id: string
  start: number
  end: number
  title: string
  summary: string
  kind: 'talk' | 'demo' | 'retake' | 'broll' | 'other'
  takeOf?: string
}

export interface AnalysisCache {
  silence: Interval[]
  staticRegions: Interval[]
  loudness: { start: number; end: number; lufs: number }[]
}

export interface EncoderOption {
  id: string
  label: string
  hardware: boolean
}

export interface Project {
  id: string
  name: string
  fps: number
  width: number
  height: number
  sourceDuration: number
  assets: Record<string, Asset>
  tracks: Track[]
  transcript: {
    words: Word[]
    speakers: Speaker[]
  }
  cuts: Cut[]
  splits: number[]
  styles: SegmentStyle[]
  suggestions: EditSuggestion[]
  scenes: EditorialScene[]
  tags: RangeTag[]
  picture: Transform
  audioMaster: {
    volume: number
    muted: boolean
    fadeIn: number
    fadeOut: number
    normalize: boolean
    eqLow: number
    eqMid: number
    eqHigh: number
    compress: boolean
    duck: number
  }
  cutMargin: number
  encoder: string
  analysis: AnalysisCache
  markIn: number | null
  markOut: number | null
  createdAt: number
  updatedAt: number
}

export const DEFAULT_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 }

export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  crop: { ...DEFAULT_CROP }
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontSize: 42,
  align: 'center',
  fill: '#F4EEE4',
  stroke: '#16140F',
  position: 'lower'
}

export const DEFAULT_AUDIO_MASTER = {
  volume: 1,
  muted: false,
  fadeIn: 0,
  fadeOut: 0,
  normalize: false,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  compress: false,
  duck: 0.45
}

export type Command =
  | { type: 'deleteRange'; start: number; end: number; source?: Cut['source'] }
  | { type: 'restoreRange'; start: number; end: number }
  | { type: 'toggleWords'; wordIds: string[] }
  | { type: 'setWordText'; wordId: string; text: string }
  | { type: 'splitAt'; time: number }
  | { type: 'rippleDelete'; start: number; end: number }
  | { type: 'rippleDeleteMarks' }
  | { type: 'moveClip'; clipId: string; start: number; trackId?: string }
  | { type: 'trimClip'; clipId: string; edge: 'in' | 'out'; time: number }
  | { type: 'trimPrimary'; segmentId: string; edge: 'in' | 'out'; sourceTime: number }
  | { type: 'setTransform'; clipId: string; transform: Partial<Transform> }
  | { type: 'setSegmentStyle'; segmentId: string; patch: Partial<Omit<SegmentStyle, 'id' | 'start' | 'end'>> }
  | { type: 'addKeyframe'; segmentId: string; time: number; transform: Partial<Transform> }
  | { type: 'setVolume'; clipId: string; volume: number }
  | { type: 'setMuted'; clipId: string; muted: boolean }
  | { type: 'setSpeed'; start: number; end: number; speed: number }
  | { type: 'setText'; clipId: string; text: string }
  | { type: 'setCaptionStyle'; clipId: string; style: Partial<CaptionStyle> }
  | { type: 'addCaption'; start: number; duration: number; text: string }
  | {
      type: 'generateCaptions'
      maxWords?: number
      speakerPrefix?: boolean
      emphasize?: boolean
    }
  | { type: 'addTitle'; start: number; duration: number; text: string; preset?: TitlePreset }
  | { type: 'addLowerThirds' }
  | { type: 'setCaptionStyleAll'; style: Partial<CaptionStyle> }
  | { type: 'importCaptions'; filename: string; text: string }
  | { type: 'applyDiarization'; assignments?: { start: number; end: number; speaker: string }[] }
  | { type: 'addOverlay'; start: number; duration: number; text: string }
  | { type: 'addZoom'; start: number; duration: number; scale: number }
  | { type: 'addBroll'; start: number; duration: number; asset: Asset }
  | { type: 'addAudio'; start: number; duration: number; asset: Asset }
  | { type: 'addRedaction'; start: number; duration: number }
  | { type: 'addTrack'; trackType: TrackType; name?: string }
  | { type: 'setFade'; targetId: string; edge: 'in' | 'out'; duration: number }
  | { type: 'setCutMargin'; margin: number }
  | { type: 'dissolveAtPlayhead'; duration: number; time: number }
  | { type: 'setEncoder'; encoder: string }
  | { type: 'removeClip'; clipId: string }
  | { type: 'applySuggestion'; suggestionId: string }
  | { type: 'applySafeSuggestions' }
  | { type: 'dismissSuggestion'; suggestionId: string }
  | { type: 'revertSuggestion'; suggestionId: string }
  | { type: 'revertSuggestionType'; suggestionType: SuggestionType }
  | { type: 'addTag'; start: number; end: number; kind: TagKind; label?: string }
  | { type: 'eraseTag'; start: number; end: number; kind?: TagKind }
  | { type: 'removeTag'; tagId: string }
  | { type: 'setMarks'; markIn?: number | null; markOut?: number | null }
  | { type: 'setPicture'; transform: Partial<Transform> }
  | { type: 'setAudioMaster'; patch: Partial<Project['audioMaster']> }
  | { type: 'setName'; name: string }
  | { type: 'replaceProject'; project: Project }
  | { type: 'setSpeaker'; wordIds: string[]; speakerId: string }
  | { type: 'addSpeaker'; name?: string }
  | { type: 'renameSpeaker'; speakerId: string; name: string }
  | { type: 'rebuildSuggestions' }
  | { type: 'cutSentence'; wordId: string }
  | { type: 'cutPreviousSentence'; wordId: string }
  | { type: 'tightenRange'; start: number; end: number }
  | { type: 'setScenes'; scenes: EditorialScene[] }
  | { type: 'mergeIntelligence'; scenes?: EditorialScene[]; suggestions?: EditSuggestion[] }
  | { type: 'revertAt'; start: number; end: number }

export function emptyClipFields(): Pick<Clip, 'fadeIn' | 'fadeOut' | 'keyframes' | 'effect'> {
  return { fadeIn: 0, fadeOut: 0, keyframes: [], effect: 'none' }
}

export const DEFAULT_ANALYSIS: AnalysisCache = { silence: [], staticRegions: [], loudness: [] }
