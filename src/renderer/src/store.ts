import { create } from 'zustand'
import { host } from './host'
import { applyCommand, programLength } from './lib/commands'
import { createDemoProject, createEmptyProject } from './lib/demo'
import { normalizeProject } from './lib/normalize'
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
  inspectorTab: 'transform' | 'audio' | 'caption' | 'project'
  reviewing: boolean
  palette: boolean
  dirty: boolean
  analyzing: string | null
  snap: boolean
  ripple: boolean
  tool: 'select' | 'guard'
  guardKind: Extract<TagKind, 'keep' | 'demo'>
  dispatch: (command: Command) => void
  undo: () => void
  redo: () => void
  selectWords: (ids: string[], additive?: boolean) => void
  selectClip: (id: string | null) => void
  selectSuggestion: (id: string | null) => void
  setInspectorTab: (tab: EditorState['inspectorTab']) => void
  setReviewing: (value: boolean) => void
  setPalette: (value: boolean) => void
  setAnalyzing: (value: string | null) => void
  setSnap: (value: boolean) => void
  setRipple: (value: boolean) => void
  setTool: (tool: EditorState['tool']) => void
  setGuardKind: (kind: EditorState['guardKind']) => void
  loadProject: (project: Project) => void
  newProject: () => void
  loadDemo: () => void
  loadTranscript: (words: Word[]) => void
  markClean: () => void
}

function persist(project: Project) {
  try {
    localStorage.setItem('speechedit:project', JSON.stringify(project))
  } catch {
    /* ignore quota */
  }
  void host.syncProject(project).catch(() => undefined)
}

function bootProject(): Project {
  try {
    const raw = localStorage.getItem('speechedit:project')
    if (raw) return normalizeProject(JSON.parse(raw) as Project)
  } catch {
    /* ignore */
  }
  return createDemoProject()
}

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
  dirty: false,
  analyzing: null,
  snap: true,
  ripple: true,
  tool: 'select',
  guardKind: 'keep',
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
    persist(next)
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
    persist(prev)
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
    persist(next)
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
      selectedClipId: null
    })),
  selectClip: (id) => {
    const clip = get().project.tracks.flatMap((t) => t.clips).find((c) => c.id === id)
    const tab = clip?.text ? 'caption' : id ? 'transform' : 'project'
    set({ selectedClipId: id, selectedWordIds: [], inspectorTab: tab })
  },
  selectSuggestion: (id) => set({ selectedSuggestionId: id }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setReviewing: (value) => set({ reviewing: value }),
  setPalette: (value) => set({ palette: value }),
  setAnalyzing: (value) => set({ analyzing: value }),
  setSnap: (value) => set({ snap: value }),
  setRipple: (value) => set({ ripple: value }),
  setTool: (tool) => set({ tool }),
  setGuardKind: (kind) => set({ guardKind: kind }),
  loadProject: (project) => {
    const next = normalizeProject(project)
    persist(next)
    set({
      project: next,
      past: [],
      future: [],
      selectedWordIds: [],
      selectedClipId: null,
      dirty: false
    })
  },
  newProject: () => {
    const next = createEmptyProject()
    persist(next)
    set({
      project: next,
      past: [],
      future: [],
      selectedWordIds: [],
      selectedClipId: null,
      dirty: false
    })
  },
  loadDemo: () => {
    const next = createDemoProject()
    persist(next)
    set({
      project: next,
      past: [],
      future: [],
      selectedWordIds: [],
      selectedClipId: null,
      dirty: false
    })
  },
  loadTranscript: (words) =>
    set((state) => {
      const project = applyCommand(
        { ...state.project, transcript: { ...state.project.transcript, words } },
        { type: 'rebuildSuggestions' }
      )
      persist(project)
      return { project, dirty: true, selectedWordIds: [] }
    }),
  markClean: () => set({ dirty: false })
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
