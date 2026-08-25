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
import { wordRange } from './lib/transcriptEdit'
import type { Command, Project, TagKind, Word } from './types'

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
  'setCutMargin'
])
let lastCoalesce: { type: string; clipId?: string; at: number } | null = null

export interface EditorState {
  project: Project
  past: Project[]
  future: Project[]
  selectedWordIds: string[]
  selectedClipId: string | null
  selectedSuggestionId: string | null
  inspectorTab: 'transform' | 'audio' | 'caption' | 'project' | 'agent'
  reviewing: boolean
  palette: boolean
  agentOpen: boolean
  dirty: boolean
  analyzing: string | null
  exporting: boolean
  snap: boolean
  ripple: boolean
  tool: 'select' | 'guard' | 'blade'
  guardKind: Extract<TagKind, 'keep' | 'demo'>
  documentPath: string | null
  lastSavedAt: number | null
  recoveryOffer: RecoveryRecord | null
  missingAssets: MediaRef[]
  dispatch: (command: Command) => void
  undo: () => void
  redo: () => void
  selectWords: (ids: string[], additive?: boolean) => void
  selectClip: (id: string | null) => void
  selectSuggestion: (id: string | null) => void
  setInspectorTab: (tab: EditorState['inspectorTab']) => void
  setReviewing: (value: boolean) => void
  setPalette: (value: boolean) => void
  setAgentOpen: (value: boolean) => void
  setAnalyzing: (value: string | null) => void
  setExporting: (value: boolean) => void
  setSnap: (value: boolean) => void
  setRipple: (value: boolean) => void
  setTool: (tool: EditorState['tool']) => void
  setGuardKind: (kind: EditorState['guardKind']) => void
  loadProject: (
    project: Project,
    opts?: { path?: string | null; clean?: boolean; lastSavedAt?: number | null }
  ) => void
  newProject: () => void
  loadDemo: () => void
  loadTranscript: (words: Word[]) => void
  markClean: (info?: { path?: string; savedAt?: number }) => void
  bindDocument: (path: string | null, savedAt?: number | null) => void
  setRecoveryOffer: (offer: RecoveryRecord | null) => void
  setMissingAssets: (assets: MediaRef[]) => void
}

export interface PersistMeta {
  dirty: boolean
  documentPath: string | null
  lastSavedAt: number | null
}

const PROJECT_CACHE = 'speechedit:project'
const RECOVERY_CACHE = 'speechedit:recovery'
const SESSION_CACHE = 'speechedit:session'
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

function bootProject(): Project {
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
  'project' | 'past' | 'future' | 'selectedWordIds' | 'selectedClipId' | 'dirty' | 'documentPath' | 'lastSavedAt' | 'recoveryOffer'
> {
  persist(next, extra, extra.persistNow ?? true)
  return {
    project: next,
    past: [],
    future: [],
    selectedWordIds: [],
    selectedClipId: null,
    dirty: extra.dirty,
    documentPath: extra.documentPath,
    lastSavedAt: extra.lastSavedAt,
    recoveryOffer: null
  }
}

const bootedSession = bootSession()

export const useEditor = create<EditorState>((set, get) => ({
  project: bootProject(),
  past: [],
  future: [],
  selectedWordIds: [],
  selectedClipId: null,
  selectedSuggestionId: null,
  inspectorTab: 'project',
  reviewing: false,
  palette: false,
  agentOpen: false,
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
      COALESCE.has(command.type) &&
      lastCoalesce &&
      lastCoalesce.type === command.type &&
      lastCoalesce.clipId === clipId &&
      now - lastCoalesce.at < 500
    lastCoalesce = { type: command.type, clipId, at: now }
    persist(next, { dirty: true })
    set({
      project: next,
      past: coalesce ? past : [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true
    })
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
    set((state) => ({
      selectedWordIds: additive ? Array.from(new Set([...state.selectedWordIds, ...ids])) : ids,
      selectedClipId: null,
      selectedSuggestionId: null
    })),
  selectClip: (id) => {
    const clip = get().project.tracks.flatMap((t) => t.clips).find((c) => c.id === id)
    const tab = clip?.text ? 'caption' : id ? 'transform' : 'project'
    set({ selectedClipId: id, selectedWordIds: [], selectedSuggestionId: null, inspectorTab: tab })
  },
  selectSuggestion: (id) => set({ selectedSuggestionId: id }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setReviewing: (value) => set({ reviewing: value }),
  setPalette: (value) => set({ palette: value }),
  setAgentOpen: (value) => set({ agentOpen: value }),
  setAnalyzing: (value) => set({ analyzing: value }),
  setExporting: (value) => set({ exporting: value }),
  setSnap: (value) => set({ snap: value }),
  setRipple: (value) => set({ ripple: value }),
  setTool: (tool) => set({ tool }),
  setGuardKind: (kind) => set({ guardKind: kind }),
  loadProject: (project, opts) => {
    const next = normalizeProject(project)
    const documentPath = opts && 'path' in opts ? opts.path ?? null : null
    const dirty = !(opts?.clean ?? true)
    const lastSavedAt = opts?.lastSavedAt ?? (dirty ? get().lastSavedAt : next.updatedAt)
    set(
      resetView(next, {
        dirty,
        documentPath,
        lastSavedAt,
        persistNow: true
      })
    )
  },
  newProject: () => {
    set(
      resetView(createEmptyProject(), {
        dirty: false,
        documentPath: null,
        lastSavedAt: null,
        persistNow: true
      })
    )
  },
  loadDemo: () => {
    set(
      resetView(createDemoProject(), {
        dirty: false,
        documentPath: null,
        lastSavedAt: null,
        persistNow: true
      })
    )
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
  setMissingAssets: (assets) => set({ missingAssets: assets })
}))

export interface PlaybackState {
  playing: boolean
  programTime: number
  loop: boolean
  playUntil: number | null
  pixelsPerSecond: number
  play: () => void
  pause: () => void
  toggle: () => void
  seekProgram: (time: number) => void
  seekSource: (time: number) => void
  playFromSource: (time: number) => void
  playRange: (start: number, end: number) => void
  playSelectionOrMarks: () => void
  setPixelsPerSecond: (value: number) => void
  tickTo: (time: number) => void
}

export const usePlayback = create<PlaybackState>((set, get) => ({
  playing: false,
  programTime: 0,
  loop: false,
  playUntil: null,
  pixelsPerSecond: 72,
  play: () => set({ playing: true }),
  pause: () => set({ playing: false, playUntil: null }),
  toggle: () => set((s) => ({ playing: !s.playing, playUntil: s.playing ? null : s.playUntil })),
  seekProgram: (time) => set({ programTime: Math.max(0, time), playing: false, playUntil: null }),
  seekSource: (time) => {
    const project = useEditor.getState().project
    set({ programTime: sourceToProgramOf(project, time), playing: false, playUntil: null })
  },
  playFromSource: (time) => {
    const project = useEditor.getState().project
    set({ programTime: sourceToProgramOf(project, time), playing: true, playUntil: null })
  },
  playRange: (start, end) => {
    const a = Math.min(start, end)
    const b = Math.max(start, end)
    set({ programTime: a, playing: true, playUntil: b })
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
  setPixelsPerSecond: (value) => set({ pixelsPerSecond: Math.min(280, Math.max(18, value)) }),
  tickTo: (time) => set({ programTime: time })
}))

export function currentSourceTime(): number {
  return programToSourceOf(useEditor.getState().project, usePlayback.getState().programTime)
}

export function currentProgramDuration(): number {
  return programLength(useEditor.getState().project)
}
