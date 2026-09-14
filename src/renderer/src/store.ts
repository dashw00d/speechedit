import { isSharedEditor, sharedSession } from './lib/sharedSession'
import { mergeSharedProjects } from '../../shared/collaboration'
import { create } from 'zustand'
import { host } from './host'
import { applyCommand, programLength } from './lib/commands'
import { createDemoProject, createEmptyProject } from './lib/demo'
import { normalizeProject } from './lib/normalize'
import {
  makeRecovery,
  parseProjectDocument,
  parseSession,
  serializeDocument,
  slimProjectForCache,
  type MediaRef,
  type RecoveryRecord
} from './lib/projectDocument'
import { programToSourceOf, sourceToProgramOf } from './lib/resolver'
import { clampReviewRate } from './lib/reviewRate'
import { wordRange } from './lib/transcriptEdit'
import type { Clip, ClipLook, Command, Project, TagKind, Word } from './types'

const HISTORY_LIMIT = 80
const COALESCE = new Set([
  'moveClip',
  'trimClip',
  'trimPrimary',
  'setTransform',
  'setVolume',
  'setText',
  'setPicture',
  'setFade',
  'setAudioMaster',
  'setCutMargin',
  'slipClip',
  'rollClip',
  'slideClip',
  'nudgeClips',
  'setSceneBounds',
  'setCanvas'
])
const SELECT_NEW_CLIP = new Set([
  'addCaption',
  'addZoom',
  'addTitle',
  'addRedaction',
  'addBroll',
  'addAudio',
  'generateCaptions',
  'addLowerThirds',
  'duplicateClip',
  'pasteClip'
])
let lastCoalesce: { type: string; clipId?: string; at: number } | null = null
let historyGroup: { base: Project; depth: number; dirty: boolean } | null = null
let resetPlaybackForProjectChange: () => void = () => undefined

function firstAddedClipId(before: Project, after: Project): string | undefined {
  const beforeIds = new Set(before.tracks.flatMap((track) => track.clips.map((clip) => clip.id)))
  for (const track of after.tracks) {
    for (const clip of track.clips) {
      if (!beforeIds.has(clip.id)) return clip.id
    }
  }
  return undefined
}

export interface EditorState {
  project: Project
  past: Project[]
  future: Project[]
  selectedWordIds: string[]
  selectedSceneId: string | null
  selectedClipId: string | null
  selectedClipIds: string[]
  clipClipboard: { kind: 'clip' | 'look'; clip?: Clip; look: ClipLook } | null
  showSafeZone: boolean
  selectedSuggestionId: string | null
  selectedGap: { start: number; end: number } | null
  inspectorTab: 'transform' | 'audio' | 'caption' | 'project' | 'agent'
  reviewing: boolean
  previewSafeCuts: boolean
  showNowWord: boolean
  palette: boolean
  dirty: boolean
  analyzing: string | null
  exporting: boolean
  snap: boolean
  ripple: boolean
  tool: 'select' | 'guard' | 'blade'
  guardKind: TagKind
  documentPath: string | null
  lastSavedAt: number | null
  recoveryOffer: RecoveryRecord | null
  missingAssets: MediaRef[]
  dispatch: (command: Command) => void
  replay: (command: Command) => void
  /** Apply a command to the current project only — no undo entry, history snapshots unchanged. */
  patch: (command: Command) => void
  /** Start an undo group: dispatched commands inside it share one history entry. */
  beginHistoryGroup: () => void
  /** Close the undo group; records one snapshot only if a dispatch changed the project. */
  endHistoryGroup: () => void
  undo: () => void
  redo: () => void
  selectWords: (ids: string[], additive?: boolean) => void
  selectScene: (id: string | null) => void
  selectClip: (id: string | null, opts?: { additive?: boolean }) => void
  selectClips: (ids: string[]) => void
  setClipClipboard: (value: EditorState['clipClipboard']) => void
  setShowSafeZone: (value: boolean) => void
  selectSuggestion: (id: string | null) => void
  selectGap: (gap: { start: number; end: number } | null) => void
  clearSelection: () => void
  setInspectorTab: (tab: EditorState['inspectorTab']) => void
  setReviewing: (value: boolean) => void
  setPreviewSafeCuts: (value: boolean) => void
  setShowNowWord: (value: boolean) => void
  followPlayhead: boolean
  setFollowPlayhead: (value: boolean) => void
  setPalette: (value: boolean) => void
  setAnalyzing: (value: string | null) => void
  setExporting: (value: boolean) => void
  setSnap: (value: boolean) => void
  setRipple: (value: boolean) => void
  setTool: (tool: EditorState['tool']) => void
  setGuardKind: (kind: EditorState['guardKind']) => void
  loadProject: (
    project: Project,
    opts?: { path?: string | null; clean?: boolean; lastSavedAt?: number | null; persist?: boolean }
  ) => void
  applySharedProject: (project: Project, clean: boolean) => void
  newProject: () => void
  loadDemo: () => void
  loadTranscript: (words: Word[]) => void
  markClean: (info?: { path?: string; savedAt?: number }) => void
  bindDocument: (path: string | null, savedAt?: number | null) => void
  setRecoveryOffer: (offer: RecoveryRecord | null) => void
  setMissingAssets: (assets: MediaRef[]) => void
  hydrateLooks: (assets: Project['assets']) => void
}

export interface PersistMeta {
  dirty: boolean
  documentPath: string | null
  lastSavedAt: number | null
}

const PROJECT_CACHE = 'speechedit:project'
const RECOVERY_CACHE = 'speechedit:recovery'
const SESSION_CACHE = 'speechedit:session'
const UI_PREFS = 'speechedit:ui'
const PERSIST_WAIT = 400

let persistTimer: ReturnType<typeof setTimeout> | null = null
let persistPending: { project: Project; meta: PersistMeta } | null = null

function writeLocalCache(project: Project, meta: PersistMeta) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PROJECT_CACHE, JSON.stringify(slimProjectForCache(project)))
    localStorage.setItem(
      RECOVERY_CACHE,
      JSON.stringify(makeRecovery(slimProjectForCache(project), meta))
    )
    localStorage.setItem(
      SESSION_CACHE,
      JSON.stringify({ lastDocumentPath: meta.documentPath, lastSavedAt: meta.lastSavedAt })
    )
  } catch {
    /* quota — disk recovery still has the full reel */
  }
}

function persistMeta(extra?: Partial<PersistMeta>): PersistMeta {
  let live: PersistMeta = { dirty: false, documentPath: null, lastSavedAt: null }
  try {
    const state = useEditor.getState()
    live = {
      dirty: state.dirty,
      documentPath: state.documentPath,
      lastSavedAt: state.lastSavedAt
    }
  } catch {
    /* store not ready */
  }
  return {
    dirty: extra?.dirty ?? live.dirty,
    documentPath: extra?.documentPath !== undefined ? extra.documentPath : live.documentPath,
    lastSavedAt: extra?.lastSavedAt !== undefined ? extra.lastSavedAt : live.lastSavedAt
  }
}

async function flushPending() {
  if (!persistPending) return
  const { project, meta } = persistPending
  persistPending = null
  const envelope = serializeDocument(project)
  const recovery = makeRecovery(project, meta)
  const session = { lastDocumentPath: meta.documentPath, lastSavedAt: meta.lastSavedAt }
  await host.syncWorkspace({ project: envelope, recovery, session }).catch(() => undefined)
}

function persist(project: Project, extra?: Partial<PersistMeta>, immediate = false) {
  if (isSharedEditor()) { sharedSession.persist?.(project); return }
  const meta = persistMeta(extra)
  writeLocalCache(project, meta)
  persistPending = { project, meta }
  if (persistTimer) clearTimeout(persistTimer)
  if (immediate) {
    persistTimer = null
    void flushPending()
    return
  }
  persistTimer = setTimeout(() => {
    persistTimer = null
    void flushPending()
  }, PERSIST_WAIT)
}

export function flushWorkspace() {
  if (isSharedEditor()) { sharedSession.persist?.(useEditor.getState().project); return }
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  const state = useEditor.getState()
  persistPending = {
    project: state.project,
    meta: {
      dirty: state.dirty,
      documentPath: state.documentPath,
      lastSavedAt: state.lastSavedAt
    }
  }
  writeLocalCache(persistPending.project, persistPending.meta)
  void flushPending()
}

type UiPrefs = {
  showNowWord?: boolean
  followPlayhead?: boolean
  reviewRate?: number
  showSafeZone?: boolean
}

function readUiPrefs(): UiPrefs {
  if (typeof localStorage === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(UI_PREFS) ?? '{}') as UiPrefs
  } catch {
    return {}
  }
}

function writeUiPrefs(patch: UiPrefs) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(UI_PREFS, JSON.stringify({ ...readUiPrefs(), ...patch }))
  } catch {
    /* ignore */
  }
}

function bootShowNowWord(): boolean {
  return readUiPrefs().showNowWord !== false
}

function writeShowNowWord(value: boolean) {
  writeUiPrefs({ showNowWord: value })
}

function bootFollowPlayhead(): boolean {
  return readUiPrefs().followPlayhead !== false
}

function bootShowSafeZone(): boolean {
  return readUiPrefs().showSafeZone === true
}

function bootReviewRate(): number {
  return clampReviewRate(readUiPrefs().reviewRate ?? 1)
}

function bootProject(): Project {
  if (isSharedEditor()) return createDemoProject()
  if (typeof localStorage === 'undefined') return createDemoProject()
  try {
    const raw = localStorage.getItem(PROJECT_CACHE)
    if (raw) return parseProjectDocument(JSON.parse(raw) as unknown).project
  } catch {
    /* ignore */
  }
  return createDemoProject()
}

function bootSession(): PersistMeta {
  if (isSharedEditor()) return { dirty: false, documentPath: null, lastSavedAt: null }
  if (typeof localStorage === 'undefined') {
    return { dirty: false, documentPath: null, lastSavedAt: null }
  }
  try {
    const session = parseSession(JSON.parse(localStorage.getItem(SESSION_CACHE) ?? 'null'))
    return { dirty: false, documentPath: session.lastDocumentPath, lastSavedAt: session.lastSavedAt }
  } catch {
    return { dirty: false, documentPath: null, lastSavedAt: null }
  }
}

function resetView(
  next: Project,
  extra: PersistMeta & { persistNow?: boolean }
): Pick<
  EditorState,
  | 'project'
  | 'past'
  | 'future'
  | 'selectedWordIds'
  | 'selectedSceneId'
  | 'selectedClipId'
  | 'selectedClipIds'
  | 'selectedSuggestionId'
  | 'selectedGap'
  | 'dirty'
  | 'documentPath'
  | 'lastSavedAt'
  | 'recoveryOffer'
  | 'previewSafeCuts'
> {
  persist(next, extra, extra.persistNow ?? true)
  return {
    project: next,
    past: [],
    future: [],
    selectedWordIds: [],
    selectedSceneId: null,
    selectedClipId: null,
    selectedClipIds: [],
    selectedSuggestionId: null,
    selectedGap: null,
    dirty: extra.dirty,
    documentPath: extra.documentPath,
    lastSavedAt: extra.lastSavedAt,
    recoveryOffer: null,
    previewSafeCuts: false
  }
}

const bootedSession = bootSession()

export const useEditor = create<EditorState>((set, get) => ({
  project: bootProject(),
  past: [],
  future: [],
  selectedWordIds: [],
  selectedSceneId: null,
  selectedClipId: null,
  selectedClipIds: [],
  clipClipboard: null,
  showSafeZone: bootShowSafeZone(),
  selectedSuggestionId: null,
  selectedGap: null,
  inspectorTab: 'project',
  reviewing: false,
  previewSafeCuts: false,
  showNowWord: bootShowNowWord(),
  followPlayhead: bootFollowPlayhead(),
  palette: false,
  dirty: false,
  analyzing: null,
  exporting: false,
  snap: true,
  ripple: true,
  tool: 'select',
  guardKind: 'keep',
  documentPath: bootedSession.documentPath,
  lastSavedAt: bootedSession.lastSavedAt,
  recoveryOffer: null,
  missingAssets: [],
  dispatch: (command) => {
    const { project, past } = get()
    const next = applyCommand(project, command)
    if (next === project) return
    const clipId = 'clipId' in command ? command.clipId : undefined
    const now = Date.now()
    const coalesce =
      !historyGroup &&
      COALESCE.has(command.type) &&
      lastCoalesce &&
      lastCoalesce.type === command.type &&
      lastCoalesce.clipId === clipId &&
      now - lastCoalesce.at < 500
    if (!historyGroup) lastCoalesce = { type: command.type, clipId, at: now }
    if (historyGroup) historyGroup.dirty = true
    persist(next, { dirty: true })
    const addedClipId = SELECT_NEW_CLIP.has(command.type) ? firstAddedClipId(project, next) : undefined
    const addedClip = addedClipId
      ? next.tracks.flatMap((track) => track.clips).find((clip) => clip.id === addedClipId)
      : undefined
    set({
      project: next,
      past: historyGroup || coalesce ? past : [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      ...(command.type === 'applySafeSuggestions' ? { previewSafeCuts: false } : {}),
      ...(addedClipId
        ? {
            selectedClipId: addedClipId,
            selectedClipIds: [addedClipId],
            selectedWordIds: [],
            selectedSceneId: null,
            selectedSuggestionId: null,
            selectedGap: null,
            inspectorTab: addedClip?.text && !addedClip.assetId ? 'caption' : 'transform'
          }
        : {})
    })
  },
  replay: (command) => {
    const { project, past, future } = get()
    const next = applyCommand(project, command)
    if (next === project) return
    persist(next, { dirty: true })
    set({
      project: next,
      past: past.map((snapshot) => applyCommand(snapshot, command)),
      future: future.map((snapshot) => applyCommand(snapshot, command)),
      dirty: true
    })
  },
  patch: (command) => {
    const { project } = get()
    const next = applyCommand(project, command)
    if (next === project) return
    persist(next, { dirty: true })
    set({ project: next, dirty: true })
  },
  beginHistoryGroup: () => {
    if (historyGroup) {
      historyGroup.depth += 1
      return
    }
    historyGroup = { base: get().project, depth: 1, dirty: false }
  },
  endHistoryGroup: () => {
    if (!historyGroup) return
    historyGroup.depth -= 1
    if (historyGroup.depth > 0) return
    const group = historyGroup
    historyGroup = null
    lastCoalesce = null
    if (!group.dirty || get().project === group.base) return
    set({ past: [...get().past, group.base].slice(-HISTORY_LIMIT), future: [] })
  },
  undo: () => {
    const { past, project, future } = get()
    const prev = past[past.length - 1]
    if (!prev) return
    persist(prev, { dirty: true })
    set({
      project: prev,
      past: past.slice(0, -1),
      future: [project, ...future].slice(0, HISTORY_LIMIT),
      dirty: true
    })
  },
  redo: () => {
    const { future, project, past } = get()
    const next = future[0]
    if (!next) return
    persist(next, { dirty: true })
    set({
      project: next,
      past: [...past, project].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      dirty: true
    })
  },
  selectWords: (ids, additive) =>
    set((state) => {
      const order = new Map(state.project.transcript.words.map((w, i) => [w.id, i]))
      const merged = additive ? Array.from(new Set([...state.selectedWordIds, ...ids])) : ids
      const sorted = [...merged].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
      return {
        selectedWordIds: sorted,
        selectedSceneId: null,
        selectedClipId: null,
        selectedClipIds: [],
        selectedSuggestionId: null,
        selectedGap: null
      }
    }),
  selectScene: (id) => {
    const scene = id ? get().project.scenes?.find((s) => s.id === id) : undefined
    const wordIds = scene
      ? get()
          .project.transcript.words.filter((w) => w.start >= scene.start && w.end <= scene.end)
          .map((w) => w.id)
      : []
    set({
      selectedSceneId: id,
      selectedWordIds: wordIds,
      selectedClipId: null,
      selectedClipIds: [],
      selectedSuggestionId: null,
      selectedGap: null,
      inspectorTab: 'project'
    })
  },
  selectClip: (id, opts) => {
    const clip = get().project.tracks.flatMap((t) => t.clips).find((c) => c.id === id)
    const tab = clip?.text && !clip.assetId ? 'caption' : id ? 'transform' : 'project'
    const existing = get().selectedClipIds
    const selectedClipIds = !id
      ? []
      : opts?.additive
        ? existing.includes(id)
          ? existing.filter((row) => row !== id)
          : [...existing, id]
        : [id]
    set({
      selectedClipId: selectedClipIds[selectedClipIds.length - 1] ?? null,
      selectedClipIds,
      selectedWordIds: [],
      selectedSceneId: null,
      selectedSuggestionId: null,
      selectedGap: null,
      inspectorTab: tab
    })
  },
  selectClips: (ids) => {
    const unique = [...new Set(ids)]
    const last = unique[unique.length - 1] ?? null
    const clip = last ? get().project.tracks.flatMap((t) => t.clips).find((c) => c.id === last) : undefined
    set({
      selectedClipId: last,
      selectedClipIds: unique,
      selectedWordIds: [],
      selectedSceneId: null,
      selectedSuggestionId: null,
      selectedGap: null,
      inspectorTab: clip?.text && !clip.assetId ? 'caption' : last ? 'transform' : 'project'
    })
  },
  setClipClipboard: (value) => set({ clipClipboard: value }),
  setShowSafeZone: (value) => {
    writeUiPrefs({ showSafeZone: value })
    set({ showSafeZone: value })
  },
  selectSuggestion: (id) =>
    set({
      selectedSuggestionId: id,
      selectedWordIds: [],
      selectedSceneId: null,
      selectedClipId: null,
      selectedClipIds: [],
      selectedGap: null
    }),
  selectGap: (gap) =>
    set({
      selectedGap: gap,
      selectedWordIds: [],
      selectedSceneId: null,
      selectedClipId: null,
      selectedClipIds: [],
      selectedSuggestionId: null
    }),
  clearSelection: () =>
    set({
      selectedWordIds: [],
      selectedSceneId: null,
      selectedClipId: null,
      selectedClipIds: [],
      selectedSuggestionId: null,
      selectedGap: null
    }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setReviewing: (value) => set({ reviewing: value }),
  setPreviewSafeCuts: (value) => set({ previewSafeCuts: value }),
  setShowNowWord: (value) => {
    writeShowNowWord(value)
    set({ showNowWord: value })
  },
  setFollowPlayhead: (value) => {
    writeUiPrefs({ followPlayhead: value })
    set({ followPlayhead: value })
  },
  setPalette: (value) => set({ palette: value }),
  setAnalyzing: (value) => set({ analyzing: value }),
  setExporting: (value) => set({ exporting: value }),
  setSnap: (value) => set({ snap: value }),
  setRipple: (value) => set({ ripple: value }),
  setTool: (tool) => set({ tool }),
  setGuardKind: (kind) => set({ guardKind: kind }),
  applySharedProject: (project, clean) => {
    const before = get().project
    // Carry only the incoming delta into every snapshot. Keeping old snapshots
    // unchanged would let Undo silently erase a collaborator's saved work.
    // Incoming values win where a peer has superseded a historical local edit.
    const rebase = (snapshot: Project) => mergeSharedProjects(before, project, snapshot).project
    const past = get().past.map(rebase), future = get().future.map(rebase)
    if (historyGroup) historyGroup.base = rebase(historyGroup.base)
    lastCoalesce = null
    set({ project, past, future, dirty: !clean })
  },
  loadProject: (project, opts) => {
    if (isSharedEditor() && sharedSession.projectId && project.id !== sharedSession.projectId) throw new Error('Open another workspace tab to switch projects.')
    const next = normalizeProject(project)
    const documentPath = opts && 'path' in opts ? opts.path ?? null : null
    const dirty = !(opts?.clean ?? true)
    const lastSavedAt = opts?.lastSavedAt ?? (dirty ? get().lastSavedAt : next.updatedAt)
    set(
      resetView(next, {
        dirty,
        documentPath,
        lastSavedAt,
        persistNow: opts?.persist ?? true
      })
    )
    resetPlaybackForProjectChange()
  },
  newProject: () => {
    if (isSharedEditor()) { window.open('/', '_blank', 'noopener'); return }
    set(
      resetView(createEmptyProject(), {
        dirty: false,
        documentPath: null,
        lastSavedAt: null,
        persistNow: true
      })
    )
    resetPlaybackForProjectChange()
  },
  loadDemo: () => {
    if (isSharedEditor()) { window.open('/', '_blank', 'noopener'); return }
    set(
      resetView(createDemoProject(), {
        dirty: false,
        documentPath: null,
        lastSavedAt: null,
        persistNow: true
      })
    )
    resetPlaybackForProjectChange()
  },
  loadTranscript: (words) => {
    get().dispatch({ type: 'setTranscript', words })
    set({ selectedWordIds: [] })
  },
  markClean: (info) => {
    const documentPath = info?.path ?? get().documentPath
    const lastSavedAt = info?.savedAt ?? Date.now()
    set({ dirty: false, documentPath, lastSavedAt })
    persist(get().project, { dirty: false, documentPath, lastSavedAt }, true)
  },
  bindDocument: (path, savedAt) => {
    const lastSavedAt = savedAt ?? get().lastSavedAt
    set({ documentPath: path, lastSavedAt })
    persist(get().project, { documentPath: path, lastSavedAt, dirty: get().dirty }, true)
  },
  setRecoveryOffer: (offer) => set({ recoveryOffer: offer }),
  setMissingAssets: (assets) => set({ missingAssets: assets }),
  hydrateLooks: (assets) => {
    const project = get().project
    set({ project: { ...project, assets } })
  }
}))

export interface PlaybackState {
  playing: boolean
  programTime: number
  loop: boolean
  playUntil: number | null
  loopFrom: number | null
  reviewRate: number
  pixelsPerSecond: number
  fitPixelsPerSecond: number
  setReviewRate: (value: number) => void
  play: () => void
  pause: () => void
  toggle: () => void
  seekProgram: (time: number) => void
  seekSource: (time: number) => void
  playFromSource: (time: number) => void
  playRange: (start: number, end: number) => void
  playLoop: (start: number, end: number) => void
  playSelectionOrMarks: () => void
  setPixelsPerSecond: (value: number) => void
  setFitPixelsPerSecond: (value: number) => void
  fitTimeline: () => void
  tickTo: (time: number) => void
}

export const usePlayback = create<PlaybackState>((set, get) => ({
  playing: false,
  programTime: 0,
  loop: false,
  playUntil: null,
  loopFrom: null,
  reviewRate: bootReviewRate(),
  pixelsPerSecond: 72,
  fitPixelsPerSecond: 60,
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  toggle: () => {
    const s = get()
    if (s.playing) {
      set({ playing: false })
      return
    }
    if (s.loopFrom != null && s.playUntil != null) {
      set({ playing: true, programTime: s.loopFrom })
      return
    }
    set({ playing: true })
  },
  seekProgram: (time) =>
    set({ programTime: Math.max(0, time), playing: false, playUntil: null, loopFrom: null }),
  seekSource: (time) => {
    const project = useEditor.getState().project
    set({
      programTime: sourceToProgramOf(project, time),
      playing: false,
      playUntil: null,
      loopFrom: null
    })
  },
  playFromSource: (time) => {
    const project = useEditor.getState().project
    set({
      programTime: sourceToProgramOf(project, time),
      playing: true,
      playUntil: null,
      loopFrom: null
    })
  },
  playRange: (start, end) => {
    const a = Math.min(start, end)
    const b = Math.max(start, end)
    set({ programTime: a, playing: true, playUntil: b, loopFrom: null })
  },
  playLoop: (start, end) => {
    const a = Math.min(start, end)
    const b = Math.max(start, end)
    set({ programTime: a, playing: true, playUntil: b, loopFrom: a })
  },
  playSelectionOrMarks: () => {
    const project = useEditor.getState().project
    const selected = useEditor.getState().selectedWordIds
    const span = wordRange(project.transcript.words, selected)
    if (project.markIn != null && project.markOut != null) {
      const a = Math.min(project.markIn, project.markOut)
      const b = Math.max(project.markIn, project.markOut)
      set({ programTime: a, playing: true, playUntil: get().loop ? null : b })
      return
    }
    if (span) {
      set({
        programTime: sourceToProgramOf(project, span.start),
        playing: true,
        playUntil: sourceToProgramOf(project, span.end)
      })
      return
    }
    set({ playing: true, playUntil: null })
  },
  setReviewRate: (value) => {
    const reviewRate = clampReviewRate(value)
    writeUiPrefs({ reviewRate })
    set({ reviewRate })
  },
  setPixelsPerSecond: (value) => set({ pixelsPerSecond: Math.min(280, Math.max(18, value)) }),
  setFitPixelsPerSecond: (value) => set({ fitPixelsPerSecond: Math.min(280, Math.max(18, value)) }),
  fitTimeline: () => {
    const pps = get().fitPixelsPerSecond
    set({ pixelsPerSecond: Math.min(280, Math.max(18, pps)) })
  },
  tickTo: (time) => set({ programTime: time })
}))

resetPlaybackForProjectChange = () => usePlayback.getState().seekProgram(0)

export function currentSourceTime(): number {
  return programToSourceOf(useEditor.getState().project, usePlayback.getState().programTime)
}

export function currentProgramDuration(): number {
  return programLength(useEditor.getState().project)
}
