import { captionDefaults } from './lib/theme'

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
export type SuggestionAction = 'cut' | 'speed' | 'review' | 'normalize' | 'volume'
export type TagKind = 'keep' | 'demo' | 'note' | 'hook' | 'cta'
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
  /** Preview-only file. Playback uses this when set; export always uses path. */
  proxyPath?: string
  /** Camera display rotation in quarter turns. Coded width/height may be swapped. */
  displayRotation?: 0 | 90 | 180 | 270
  /** Source codec from probe. Used to remake a preview proxy after reopen or relink. */
  codec?: string
  vfr?: boolean
  /** Where this take sits on the unified source timeline. Overlay/B-roll assets omit it. */
  sourceOffset?: number
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

export interface ClipLook {
  transform: Transform
  volume: number
  muted: boolean
  speed: number
  fadeIn: number
  fadeOut: number
  pan?: number
}

export type InsertKind = 'black' | 'silence' | 'hold'

/** Program-time hold. May sit on V1 after a lift or an insert-gap. */
export interface ProgramInsert {
  id: string
  programStart: number
  duration: number
  kind: InsertKind
  holdSourceTime?: number
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
  /** Stereo balance −1 left … 1 right. */
  pan?: number
  text?: string
  style?: CaptionStyle
  effect?: 'none' | 'blur'
  /** Derived primary holds use `slug`. Overlay clips omit this. */
  kind?: 'media' | 'slug'
  /** Built from the transcript. Import may refresh these until the user edits or undoes. */
  auto?: boolean
}

export interface Track {
  id: string
  type: TrackType
  name: string
  locked: boolean
  muted: boolean
  hidden: boolean
  /** Hear this lane only. Other tracks mute for preview and export. */
  solo?: boolean
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
  pan?: number
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
  volume?: number
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
  takeIndex?: number
}

export interface AnalysisCache {
  silence: Interval[]
  staticRegions: Interval[]
  /** Scene-change timestamps from look analysis. Empty means no visual evidence. */
  sceneTimes?: number[]
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
  inserts?: ProgramInsert[]
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
  get fill() {
    return captionDefaults().fill
  },
  get stroke() {
    return captionDefaults().stroke
  },
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
  | { type: 'deleteRange'; start: number; end: number; source?: Cut['source']; lift?: boolean }
  | { type: 'restoreRange'; start: number; end: number }
  | { type: 'toggleWords'; wordIds: string[]; lift?: boolean }
  | { type: 'setWordText'; wordId: string; text: string }
  | { type: 'replaceWords'; pairs: { wordId: string; text: string }[] }
  | { type: 'splitAt'; time: number }
  | { type: 'rippleDelete'; start: number; end: number }
  | { type: 'rippleDeleteMarks' }
  | { type: 'liftMarks' }
  | { type: 'insertGap'; time: number; duration: number }
  | { type: 'removeInsert'; insertId: string }
  | { type: 'moveClip'; clipId: string; start: number; trackId?: string }
  | { type: 'trimClip'; clipId: string; edge: 'in' | 'out'; time: number }
  | { type: 'trimPrimary'; segmentId: string; edge: 'in' | 'out'; sourceTime: number; lift?: boolean }
  | { type: 'rippleTrimToPlayhead'; edge: 'in' | 'out'; time: number; lift?: boolean }
  | { type: 'replaceClipMedia'; clipId: string; asset: Asset }
  | { type: 'setPan'; clipId: string; pan: number }
  | { type: 'setTransform'; clipId: string; transform: Partial<Transform> }
  | { type: 'setSegmentStyle'; segmentId: string; patch: Partial<Omit<SegmentStyle, 'id' | 'start' | 'end'>> }
  | { type: 'addKeyframe'; segmentId: string; time: number; transform: Partial<Transform> }
  | { type: 'setVolume'; clipId: string; volume: number }
  | { type: 'setMuted'; clipId: string; muted: boolean }
  | { type: 'setSpeed'; start: number; end: number; speed: number }
  | { type: 'setRangeVolume'; start: number; end: number; volume: number }
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
  | {
      type: 'addBroll'
      start: number
      duration: number
      asset: Asset
      inPoint?: number
      transform?: Transform
      muted?: boolean
      volume?: number
    }
  | {
      type: 'addAudio'
      start: number
      duration: number
      asset: Asset
      inPoint?: number
      fadeIn?: number
      fadeOut?: number
    }
  | { type: 'addRedaction'; start: number; duration: number }
  | { type: 'addTrack'; trackType: TrackType; name?: string }
  | { type: 'removeTrack'; trackId: string }
  | { type: 'setFade'; targetId: string; edge: 'in' | 'out'; duration: number }
  | { type: 'setCutMargin'; margin: number }
  | { type: 'dissolveAtPlayhead'; duration: number; time: number }
  | { type: 'setEncoder'; encoder: string }
  | { type: 'removeClip'; clipId: string }
  | { type: 'applySuggestion'; suggestionId: string }
  | { type: 'resolveSuggestion'; suggestionId: string; resolution: 'cut' | 'speed' | 'demo' | 'keep' }
  | { type: 'applySuggestions'; suggestionIds: string[] }
  | { type: 'applySafeSuggestions' }
  | { type: 'dismissSuggestion'; suggestionId: string }
  | { type: 'dismissSuggestions'; suggestionIds: string[] }
  | { type: 'dismissPendingSuggestions' }
  | { type: 'applySuggestionsByType'; suggestionType: SuggestionType }
  | { type: 'revertSuggestion'; suggestionId: string }
  | { type: 'revertSuggestionType'; suggestionType: SuggestionType }
  | { type: 'duplicateClip'; clipId: string; start?: number }
  | { type: 'pasteClip'; clip: Clip; start: number; trackId?: string }
  | { type: 'applyClipLook'; clipIds: string[]; look: ClipLook }
  | { type: 'slipClip'; clipId: string; delta: number }
  | { type: 'rollClip'; clipId: string; edge: 'in' | 'out'; time: number }
  | { type: 'slideClip'; clipId: string; start: number }
  | { type: 'extendClip'; clipId: string; time: number }
  | { type: 'nudgeClips'; clipIds: string[]; delta: number }
  | { type: 'removeClips'; clipIds: string[] }
  | { type: 'setSceneBounds'; sceneId: string; start?: number; end?: number }
  | { type: 'setCanvas'; width: number; height: number }
  | { type: 'splitScene'; sceneId: string; time: number }
  | { type: 'mergeScenes'; sceneId: string; otherId: string }
  | { type: 'addTag'; start: number; end: number; kind: TagKind; label?: string }
  | { type: 'setTagLabel'; tagId: string; label: string }
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
  | { type: 'removeSpeaker'; speakerId: string }
  | { type: 'renameScene'; sceneId: string; title?: string; summary?: string }
  | { type: 'rebuildSuggestions' }
  | { type: 'setTranscript'; words: Word[] }
  | { type: 'cutSentence'; wordId: string }
  | { type: 'cutPreviousSentence'; wordId: string }
  | { type: 'tightenRange'; start: number; end: number }
  | { type: 'setScenes'; scenes: EditorialScene[] }
  | { type: 'mergeIntelligence'; scenes?: EditorialScene[]; suggestions?: EditSuggestion[] }
  | { type: 'revertAt'; start: number; end: number }
  | { type: 'inferScenes' }
  | { type: 'rebuildIntelligence' }
  | { type: 'collapseRetakes' }
  | { type: 'keepTake'; sceneId: string }
  | { type: 'applyModelSuggestions' }
  | { type: 'setTrackFlag'; trackId: string; patch: Partial<Pick<Track, 'muted' | 'hidden' | 'locked' | 'name' | 'solo'>> }
  | { type: 'relinkAsset'; assetId: string; path: string }
  | { type: 'setAssetProxy'; assetId: string; proxyPath: string | null }
  | {
      type: 'setAssetLooks'
      assetId: string
      waveform?: number[]
      thumbnails?: string[]
      proxyPath?: string | null
    }
  | {
      type: 'setAnalysis'
      silence?: AnalysisCache['silence']
      staticRegions?: AnalysisCache['staticRegions']
      sceneTimes?: AnalysisCache['sceneTimes']
      loudness?: AnalysisCache['loudness']
    }
  | {
      type: 'appendTake'
      asset: Asset
      words: Word[]
      analysis?: Pick<AnalysisCache, 'silence' | 'staticRegions' | 'loudness'> & {
        sceneTimes?: number[]
      }
    }
  | {
      type: 'attachTakeIntel'
      assetId: string
      words?: Word[]
      analysis?: Pick<AnalysisCache, 'silence' | 'staticRegions' | 'loudness'> & {
        sceneTimes?: number[]
      }
      whispered?: { text: string; start: number; end: number; speaker?: string }[] | null
    }

export function emptyClipFields(): Pick<Clip, 'fadeIn' | 'fadeOut' | 'keyframes' | 'effect'> {
  return { fadeIn: 0, fadeOut: 0, keyframes: [], effect: 'none' }
}

export const DEFAULT_ANALYSIS: AnalysisCache = { silence: [], staticRegions: [], sceneTimes: [], loudness: [] }
