import { isSharedEditor } from './sharedSession'
import { host, isElectron, mediaDisplayName, registerBrowserMedia } from '../host'
import { assetNeedsProxy } from '../../../shared/proxy'
import { applyInterchange, pickInterchange } from './interchange'
import {
  inspectRecording,
  importedLooksCommands,
  importedProxyCommands,
  importedWordsCommands,
  projectFromTake,
  type InspectedTake
} from './importMedia'
import {
  confirmLoseWork,
  currentDocumentTitle,
  hydrateMedia,
  rememberSavedDocument,
  refreshMissingAssets
} from './documentIo'
import { classifyDrop, droppedFilePath, refineJsonKind } from './dropIntake'
import {
  cancelImport,
  createImportSignal,
  explainImportError,
  importBusyToast,
  isJobCancelled,
  whisperMissingMessage
} from './mediaJobs'
import { mediaToolsBlocker } from './mediaHealth'
import { openDocumentFromRaw } from './projectDocument'
import { forgetRecent, rememberRecent } from './recents'
import {
  applyAutoCaptions,
  applySafeFirstEdit,
  applyStreamingFirstEdit,
  describeFirstEditResult,
  dismissLeftoverBreaths,
  emptyCaptionSession,
  looksSafeSpans,
  offeredWordSpans,
  startLeftoverReview,
  startRetakeReview,
  describeRetakeReview,
  type CaptionAutoSession,
  type FirstEditPhase
} from './firstEdit'
import { parseAnyTranscript } from './transcript'
import { useEditor } from '../store'
import type { Command } from '../types'
import { finishActivity, startActivity } from './activity'

function leftoverReviewToast(kind: 'activity' | 'still' | 'static' | 'loud'): string {
  if (kind === 'activity') return 'Quiet picture changes need a listen. Silent demo, Speed, or Cut.'
  if (kind === 'still') return 'Silent stills need a listen. Cut, Silent demo, or Speed.'
  if (kind === 'static') return 'Static screens can be sped up. Speed or Keep.'
  return 'Hot audio can be quieted. Quiet or Keep.'
}

function leftoverReviewMessage(session: { reviewToast?: boolean }): string | null {
  dismissLeftoverBreaths()
  const kind = startLeftoverReview()
  if (kind) {
    if (session.reviewToast) return null
    session.reviewToast = true
    return leftoverReviewToast(kind)
  }
  const scene = startRetakeReview()
  if (!scene || session.reviewToast) return null
  session.reviewToast = true
  return describeRetakeReview(useEditor.getState().project, scene)
}

function toastAfterIntel(
  onToast: ToastFn,
  fallback: string,
  phase: FirstEditPhase = 'all',
  skip: { start: number; end: number }[] = [],
  session: CaptionAutoSession & { reviewToast?: boolean } = emptyCaptionSession()
): void {
  // One toast per import: merge the notes so a later caption/leftover line cannot
  // clobber the undo invitation the automatic first edit just offered.
  const result = applySafeFirstEdit(phase, skip) ?? session.lastEdit ?? null
  const notes: string[] = []
  if (result) notes.push(describeFirstEditResult(result, phase))
  if (applyAutoCaptions(session) && !session.captionsToast) {
    session.captionsToast = true
    notes.push('Captions from the transcript.')
  }
  const leftover = leftoverReviewMessage(session)
  if (leftover) notes.push(leftover)
  onToast(notes.length ? notes.join(' ') : fallback)
}

export type ToastFn = (msg: string) => void

function replayCommands(commands: Command[]): void {
  for (const command of commands) useEditor.getState().replay(command)
}

function inspectStageHandler(
  onToast: ToastFn,
  opened: () => boolean,
  whisperNote: { current: string | null },
  label: 'Opening' | 'Analyzing take'
): (stage: string) => void {
  return (stage) => {
    if (stage === 'transcript:missing') {
      whisperNote.current = isElectron
        ? whisperMissingMessage()
        : 'Local browser Whisper did not return words. Try Transcribe again, or drop Whisper JSON here.'
      useEditor.getState().setAnalyzing('transcript')
      return
    }
    if (stage === 'transcript:install') {
      useEditor.getState().setAnalyzing('whisper')
      onToast('Installing local Whisper… Cancel import to skip.')
      return
    }
    useEditor.getState().setAnalyzing(stage)
    const readable =
      stage === 'probe'
        ? 'Reading media'
        : stage === 'proxy' || stage === 'preview'
          ? 'Building preview'
          : stage === 'looks'
            ? 'Analyzing picture and sound'
            : stage === 'transcript:islands'
              ? 'Building approximate speech regions'
              : stage.startsWith('transcript:')
                ? 'Whisper transcription'
                : stage === 'transcript'
                  ? 'Transcript ready'
                  : stage
    onToast(opened() ? readable : `${label} · ${readable}`)
  }
}

async function replayInspectedTake(openedId: string, take: InspectedTake): Promise<void> {
  const editor = useEditor.getState()
  if (!editor.project.assets[openedId]) return
  replayCommands(importedProxyCommands(editor.project, take))
  replayCommands(importedLooksCommands(useEditor.getState().project, take))
  replayCommands(importedWordsCommands(useEditor.getState().project, take, true))
}

function inspectMediaCallbacks(
  onToast: ToastFn,
  whisperNote: { current: string | null },
  label: 'Opening' | 'Analyzing take',
  onOpened: (partial: InspectedTake) => void
) {
  const openedId = { current: '' }
  const released = { current: false }
  const looksFirstEdit = {
    done: false,
    skip: [] as { start: number; end: number }[],
    wordsUndo: false,
    wordsToast: false,
    captionsUndo: false,
    skipCaptions: false,
    captionCount: 0,
    captionsToast: false,
    reviewToast: false
  }
  let pendingLooks = true
  let pendingProxy = false

  async function releaseFfmpegAfterLooks() {
    if (pendingLooks || released.current) return
    released.current = true
    await host.endJob('import')
    useEditor.getState().setAnalyzing(pendingProxy ? 'preview' : 'transcript')
  }

  return {
    openedId,
    released,
    looksFirstEdit,
    opts: {
      onReady: (partial: InspectedTake) => {
        pendingProxy = assetNeedsProxy(partial.asset) && !partial.asset.proxyPath
        openedId.current = partial.asset.id
        onOpened(partial)
      },
      onProxy: async (partial: InspectedTake) => {
        pendingProxy = false
        if (openedId.current && useEditor.getState().project.assets[openedId.current]) {
          replayCommands(importedProxyCommands(useEditor.getState().project, partial))
        }
        const stage = useEditor.getState().analyzing
        if (stage === 'preview') useEditor.getState().setAnalyzing('transcript')
      },
      onLooks: async (partial: InspectedTake) => {
        pendingLooks = false
        if (openedId.current && useEditor.getState().project.assets[openedId.current]) {
          replayCommands(importedLooksCommands(useEditor.getState().project, partial))
        }
        looksFirstEdit.done = true
        looksFirstEdit.skip = looksSafeSpans(useEditor.getState().project)
        const notes: string[] = []
        const result = applySafeFirstEdit('looks')
        if (result) notes.push(describeFirstEditResult(result, 'looks'))
        const leftover = leftoverReviewMessage(looksFirstEdit)
        if (leftover) notes.push(leftover)
        if (notes.length) onToast(notes.join(' '))
        await releaseFfmpegAfterLooks()
      },
      onWords: (partial: InspectedTake) => {
        if (!openedId.current || !useEditor.getState().project.assets[openedId.current]) return
        replayCommands(importedWordsCommands(useEditor.getState().project, partial))
        if (!looksFirstEdit.done) return
        const captioned = applyAutoCaptions(looksFirstEdit)
        if (captioned && !looksFirstEdit.captionsToast) {
          looksFirstEdit.captionsToast = true
          onToast('Captions from the transcript.')
        }
        const offered = offeredWordSpans(useEditor.getState().project, looksFirstEdit.skip)
        const result = applyStreamingFirstEdit(looksFirstEdit.skip, looksFirstEdit)
        looksFirstEdit.skip = [...looksFirstEdit.skip, ...offered]
        if (result && !looksFirstEdit.wordsToast) {
          looksFirstEdit.wordsToast = true
          onToast(`${describeFirstEditResult(result, 'fillers')} Still transcribing.`)
        }
      },
      onStage: inspectStageHandler(onToast, () => Boolean(openedId.current), whisperNote, label)
    }
  }
}

export async function importMediaFromPath(file: string, onToast: ToastFn): Promise<void> {
  if (isSharedEditor()) return appendTakeAction(onToast, file)
  const editor = useEditor.getState()
  const busy = importBusyToast(editor.exporting, editor.analyzing)
  if (busy) {
    onToast(busy)
    return
  }
  if (isElectron) {
    const blocked = await mediaToolsBlocker()
    if (blocked) {
      onToast(blocked)
      return
    }
  }
  const signal = createImportSignal()
  startActivity({
    id: 'media:import',
    label: 'Opening media',
    detail: mediaDisplayName(file),
    cancellable: 'import'
  })
  const whisperNote = { current: null as string | null }
  const inspect = inspectMediaCallbacks(onToast, whisperNote, 'Opening', (partial) => {
    useEditor.getState().loadProject(projectFromTake(partial), { path: null, clean: false })
    onToast(`${partial.asset.name} · playing · still analyzing`)
  })
  try {
    await host.beginJob('import')
    const take = await inspectRecording(file, { signal, ...inspect.opts })
    if (inspect.openedId.current) await replayInspectedTake(inspect.openedId.current, take)
    else useEditor.getState().loadProject(projectFromTake(take), { path: null, clean: false })
    const next = useEditor.getState().project
    toastAfterIntel(
      onToast,
      whisperNote.current
        ? `${next.name} · ${next.transcript.words.length} island words. ${whisperNote.current}`
        : `${next.name} · ${next.suggestions.length} suggestions · ${next.transcript.words.length} words`,
      inspect.looksFirstEdit.done ? 'words' : 'all',
      inspect.looksFirstEdit.skip,
      inspect.looksFirstEdit
    )
  } catch (err) {
    onToast(isJobCancelled(err) ? 'Import cancelled.' : err instanceof Error ? err.message : 'Import failed.')
  } finally {
    if (!inspect.released.current) await host.endJob('import').catch(() => undefined)
    useEditor.getState().setAnalyzing(null)
    finishActivity('media:import')
  }
}

export async function importMediaAction(onToast: ToastFn): Promise<void> {
  if (isSharedEditor()) return appendTakeAction(onToast)
  const editor = useEditor.getState()
  const busy = importBusyToast(editor.exporting, editor.analyzing)
  if (busy) {
    onToast(busy)
    return
  }
  if (isElectron) {
    const blocked = await mediaToolsBlocker()
    if (blocked) {
      onToast(blocked)
      return
    }
  }
  if (!(await confirmLoseWork())) return
  const file = await host.openMedia()
  if (!file) {
    onToast('No file selected.')
    return
  }
  await importMediaFromPath(file, onToast)
}

export async function appendTakeAction(onToast: ToastFn, providedFile?: string): Promise<void> {
  const editor = useEditor.getState()
  const busy = importBusyToast(editor.exporting, editor.analyzing)
  if (busy) {
    onToast(busy)
    return
  }
  if (isElectron) {
    const blocked = await mediaToolsBlocker()
    if (blocked) {
      onToast(blocked)
      return
    }
  }
  const file = providedFile || await host.openMedia()
  if (!file) {
    onToast('No file selected.')
    return
  }
  const signal = createImportSignal()
  startActivity({
    id: 'media:import',
    label: 'Adding take',
    detail: mediaDisplayName(file),
    cancellable: 'import'
  })
  const whisperNote = { current: null as string | null }
  const inspect = inspectMediaCallbacks(onToast, whisperNote, 'Analyzing take', (partial) => {
    useEditor.getState().dispatch({ type: 'appendTake', asset: partial.asset, words: [] })
    onToast(`${partial.asset.name} · take added · still analyzing`)
  })
  try {
    await host.beginJob('import')
    const take = await inspectRecording(file, { signal, ...inspect.opts })
    if (inspect.openedId.current) await replayInspectedTake(inspect.openedId.current, take)
    else {
      useEditor.getState().dispatch({
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
    const next = useEditor.getState().project
    const takes = Object.values(next.assets).filter((asset) => asset.sourceOffset != null).length
    toastAfterIntel(
      onToast,
      whisperNote.current
        ? `Take ${takes} · ${next.transcript.words.length} words. ${whisperNote.current}`
        : `Take ${takes} · ${next.suggestions.length} suggestions · ${next.transcript.words.length} words`,
      inspect.looksFirstEdit.done ? 'words' : 'all',
      inspect.looksFirstEdit.skip,
      inspect.looksFirstEdit
    )
  } catch (err) {
    onToast(isJobCancelled(err) ? 'Import cancelled.' : err instanceof Error ? err.message : 'Could not add that take.')
  } finally {
    if (!inspect.released.current) await host.endJob('import').catch(() => undefined)
    useEditor.getState().setAnalyzing(null)
    finishActivity('media:import')
  }
}

export async function openTranscriptAction(onToast: ToastFn): Promise<void> {
  try {
    const result = await host.openTranscript()
    if (!result) return
    const words = parseAnyTranscript(result.name, result.text)
    useEditor.getState().loadTranscript(words)
    toastAfterIntel(onToast, `Transcript · ${words.length} words`)
  } catch (err) {
    onToast(err instanceof Error ? err.message : 'Transcript import failed.')
  }
}

export async function importTimelineAction(onToast: ToastFn): Promise<void> {
  const picked = isElectron ? await host.openInterchange() : await pickInterchange()
  if (!picked) return
  try {
    const next = applyInterchange(useEditor.getState().project, picked.name, picked.text)
    useEditor.getState().dispatch({ type: 'replaceProject', project: next })
    onToast(`Imported ${picked.name}`)
  } catch (err) {
    onToast(err instanceof Error ? err.message : 'Import failed.')
  }
}

export async function openProjectAction(onToast: ToastFn): Promise<void> {
  if (!(await confirmLoseWork())) return
  try {
    const { openCurrentDocument } = await import('./documentIo')
    const path = await openCurrentDocument()
    if (path) {
      rememberRecent(path, currentDocumentTitle())
      onToast(`Opened ${currentDocumentTitle()}.`)
    }
  } catch (err) {
    onToast(err instanceof Error ? err.message : 'Open failed.')
  }
}

export async function openRecentAction(path: string, onToast: ToastFn): Promise<void> {
  if (!(await confirmLoseWork())) return
  try {
    const file = await host.readProject(path)
    if (!file) {
      forgetRecent(path)
      onToast('Could not open that project — it may have moved. Use File → Open project…')
      return
    }
    const opened = openDocumentFromRaw(file.project, file.path)
    useEditor.getState().loadProject(opened.project, {
      path: file.path,
      clean: true,
      lastSavedAt: opened.savedAt
    })
    rememberRecent(file.path, currentDocumentTitle(), opened.savedAt)
    await refreshMissingAssets()
    await hydrateMedia()
    onToast(`Opened ${currentDocumentTitle()}.`)
  } catch (err) {
    forgetRecent(path)
    onToast(err instanceof Error ? err.message : 'Open failed.')
  }
}

export async function ingestDroppedFile(file: File, onToast: ToastFn): Promise<void> {
  const editor = useEditor.getState()
  let kind = classifyDrop(file.name, file.type)
  let text: string | undefined
  if (kind === 'transcript' && file.name.toLowerCase().endsWith('.json')) {
    text = await file.text()
    try {
      kind = refineJsonKind(JSON.parse(text))
    } catch {
      /* keep transcript — parseAnyTranscript explains */
    }
  }

  if (kind === 'media' || kind === 'project') {
    const busy = importBusyToast(editor.exporting, editor.analyzing)
    if (busy) {
      onToast(busy)
      return
    }
  }

  if (kind === 'media') {
    const path = droppedFilePath(file) ?? (await registerBrowserMedia(file))
    if (!isSharedEditor() && !(await confirmLoseWork('Replace this reel with the dropped recording?'))) return
    await importMediaFromPath(path, onToast)
    return
  }

  if (kind === 'project') {
    if (isSharedEditor()) { onToast('Open your workspace in another tab to switch projects.'); return }
    if (!(await confirmLoseWork('Replace this reel with the dropped project?'))) return
    const raw = text ?? (await file.text())
    const path = droppedFilePath(file) || file.name
    const opened = openDocumentFromRaw(JSON.parse(raw), path)
    useEditor.getState().loadProject(opened.project, {
      path: droppedFilePath(file),
      clean: true,
      lastSavedAt: opened.savedAt
    })
    rememberSavedDocument(droppedFilePath(file), opened.savedAt)
    await refreshMissingAssets()
    await hydrateMedia()
    onToast(`Opened ${currentDocumentTitle()}.`)
    return
  }

  if (kind === 'interchange') {
    const body = text ?? (await file.text())
    const next = applyInterchange(useEditor.getState().project, file.name, body)
    useEditor.getState().dispatch({ type: 'replaceProject', project: next })
    onToast(`Imported ${file.name}`)
    return
  }

  if (kind === 'unknown') {
    onToast('Drop a recording, transcript, SpeechEdit project, or timeline file.')
    return
  }

  const words = parseAnyTranscript(file.name, text ?? (await file.text()))
  useEditor.getState().loadTranscript(words)
  toastAfterIntel(onToast, `Transcript · ${words.length} words`)
}

export function wireFileEvents(onToast: ToastFn): () => void {
  const onOpenMedia = () => {
    void importMediaAction(onToast)
  }
  const onOpenTranscript = () => {
    void openTranscriptAction(onToast)
  }
  const onOpenProject = () => {
    void openProjectAction(onToast)
  }
  const onDropFile = (e: Event) => {
    const file = (e as CustomEvent<{ file?: File }>).detail?.file
    if (file) void ingestDroppedFile(file, onToast)
  }
  const onAddTake = () => {
    void appendTakeAction(onToast)
  }
  window.addEventListener('speechedit:open-media', onOpenMedia)
  window.addEventListener('speechedit:add-take', onAddTake)
  window.addEventListener('speechedit:open-transcript', onOpenTranscript)
  window.addEventListener('speechedit:open-project', onOpenProject)
  window.addEventListener('speechedit:drop-file', onDropFile)
  return () => {
    window.removeEventListener('speechedit:open-media', onOpenMedia)
    window.removeEventListener('speechedit:add-take', onAddTake)
    window.removeEventListener('speechedit:open-transcript', onOpenTranscript)
    window.removeEventListener('speechedit:open-project', onOpenProject)
    window.removeEventListener('speechedit:drop-file', onDropFile)
  }
}

export { cancelImport }
