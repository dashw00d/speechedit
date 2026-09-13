import { ShareSheet } from './components/ShareSheet'
import { WorkflowSheet } from './components/WorkflowSheet'
import { useEffect, useRef, useState } from 'react'
import { ConfirmSheet } from './components/ConfirmSheet'
import { ExportSheet } from './components/ExportSheet'
import { PreferencesSheet } from './components/PreferencesSheet'
import { ContextMenuHost, useContextMenu } from './components/ContextMenu'
import { Inspector } from './components/Inspector'
import { MenuBar } from './components/MenuBar'
import { Monitor } from './components/Monitor'
import { Palette } from './components/Palette'
import { ShortcutsOverlay } from './components/ShortcutsOverlay'
import { Suggestions } from './components/Suggestions'
import { Timeline } from './components/Timeline'
import { Transcript } from './components/Transcript'
import { findMovableClip, programLength } from './lib/commands'
import { toastForCommand, toastForEdit } from './lib/contextActions'
import { copySelectedClip, pasteClipboard } from './lib/clipClipboard'
import { copyQuoteFromContext } from './lib/quote'
import { cutPreviousFromContext } from './lib/cutPrevious'
import { cutThisFromContext } from './lib/cutSentence'
import { hopNote, movableIds, notesSorted } from './lib/clipEdit'
import { describeNoteHop } from './lib/noteEdit'
import {
  discardRecovery,
  hydrateWorkspace,
  recoveryCopy,
  refreshMissingAssets,
  relinkAllMissing,
  relinkAssetInteractive,
  relinkToast,
  restoreRecovery,
  saveCurrentDocument
} from './lib/documentIo'
import { currentWord } from './lib/edl'
import { programToSourceOf, sourceToProgramOf } from './lib/resolver'
import {
  bladeAtWord,
  cutParagraphFromContext,
  playInOutOrSelection,
  selectParagraphFromContext
} from './lib/scriptActions'
import { markClipFromContext } from './lib/marks'
import { startSceneRename } from './lib/sceneRename'
import { removeSceneFromContext } from './lib/sceneRemove'
import { startSpeakerRename } from './lib/speakerRename'
import { protectFromContext } from './lib/protect'
import { neighborScene } from './lib/sceneChip'
import {
  extendSelection,
  isParagraphSelection,
  shrinkSelection,
  wordRange
} from './lib/transcriptEdit'
import { cancelExport, cancelImport, mediaBusyToast } from './lib/mediaJobs'
import { currentProgramDuration, flushWorkspace, useEditor, usePlayback } from './store'
import { useClearSelection } from './useClearSelection'
import { activeThemeId, subscribeTheme } from './lib/theme'
import { host, isElectron } from './host'
import {
  isWorkspacePane,
  WORKSPACE_PANES,
  workspacePaneFromHotkey,
  type WorkspacePane
} from '../../shared/windowLayout'
import { formatAppIdentity, loadAppIdentity } from './lib/appIdentity'
import { loadMediaHealth } from './lib/mediaHealth'
import type { MediaToolsHealth } from '../../shared/mediaTools'
import { shouldPreventWindowClose } from './lib/windowClose'
import { runTool } from './lib/mcpTools'
import { loadSettings } from './lib/settings'
import { currentEditorSession } from './lib/editorSession'
import { openAssistant } from './lib/assistantNavigation'
import { ActivityStrip } from './components/ActivityPanel'
import { syncModelActivities } from './lib/activity'
import { blocksEditorShortcut } from './lib/keyboard'
import { isTypingTarget } from './lib/selectionSurface'
import { preloadBrowserWhisper } from './lib/browserWhisper'

const WORKSPACE_PANE_LABELS: Record<WorkspacePane, string> = {
  preview: 'Preview',
  review: 'Review',
  script: 'Transcript',
  timeline: 'Timeline'
}

export function App() {
  const [, setThemeId] = useState(activeThemeId)
  const [toast, setToast] = useState<string | null>(null)
  const [mediaHealth, setMediaHealth] = useState<MediaToolsHealth | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const [mobilePane, setMobilePane] = useState<WorkspacePane>('script')
  const mcpPolling = useRef(false)
  const { menu: contextMenu, closeMenu: closeContextMenu } = useContextMenu()
  useClearSelection()
  const exporting = useEditor((s) => s.exporting)
  const recoveryOffer = useEditor((s) => s.recoveryOffer)
  const missingAssets = useEditor((s) => s.missingAssets)
  const selectedSuggestionId = useEditor((s) => s.selectedSuggestionId)
  const emptyReel = useEditor(
    (s) =>
      s.project.sourceDuration <= 0 &&
      Object.keys(s.project.assets).length === 0 &&
      s.project.transcript.words.length === 0
  )

  useEffect(() => subscribeTheme(setThemeId), [])

  useEffect(() => {
    if (!isElectron) void preloadBrowserWhisper().catch(() => undefined)
  }, [])

  useEffect(() => {
    void host.modelQueueStatus().then(syncModelActivities).catch(() => undefined)
    return host.onModelQueue(syncModelActivities)
  }, [])

  useEffect(() => {
    void loadMediaHealth().then(setMediaHealth)
    void loadAppIdentity().then((identity) => {
      document.title = formatAppIdentity(identity)
    })
  }, [])

  useEffect(() => {
    if (!isElectron) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      if (stopped || mcpPolling.current) return
      mcpPolling.current = true
      try {
        const requests = await host.pollMcp()
        for (const request of requests) {
          try {
            const before = useEditor.getState().project
            const result = await runTool(
              before,
              request.name,
              request.args,
              loadSettings().intelligence,
              currentEditorSession()
            )
            if (result.project !== before) {
              useEditor.getState().dispatch({ type: 'replaceProject', project: result.project })
              setToast(`MCP · ${result.message}`)
            }
            await host.resolveMcp({ id: request.id, message: result.message, data: result.data })
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            await host.resolveMcp({ id: request.id, message, isError: true }).catch(() => undefined)
            setToast(`MCP failed · ${message}`)
          }
        }
      } catch {
        /* bridge is optional */
      } finally {
        mcpPolling.current = false
        if (!stopped) timer = setTimeout(() => void poll(), 400)
      }
    }
    void poll()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (selectedSuggestionId) setMobilePane('review')
  }, [selectedSuggestionId])

  useEffect(() => {
    const showAssistant = () => setMobilePane('review')
    const showPane = (event: Event) => {
      const pane = (event as CustomEvent<unknown>).detail
      if (isWorkspacePane(pane)) {
        setMobilePane(pane)
        requestAnimationFrame(() => {
          const selector = { script: '.script', preview: '.monitor', timeline: '.timeline-panel', review: '.inspector' }[pane]
          const panel = document.querySelector<HTMLElement>(selector)
          if (panel) {
            if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1
            panel.focus({ preventScroll: true })
          }
        })
      }
    }
    window.addEventListener('speechedit:assistant', showAssistant)
    window.addEventListener('speechedit:project-settings', showAssistant)
    window.addEventListener('speechedit:workspace-pane', showPane)
    return () => {
      window.removeEventListener('speechedit:assistant', showAssistant)
      window.removeEventListener('speechedit:project-settings', showAssistant)
      window.removeEventListener('speechedit:workspace-pane', showPane)
    }
  }, [])

  useEffect(() => {
    void hydrateWorkspace()
      .then((result) => {
        if (result.recovery) setToast('Crash recovery is available — restore unsaved edits or keep the last save.')
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      flushWorkspace()
      if (!shouldPreventWindowClose(useEditor.getState().dirty, isElectron)) return
      e.preventDefault()
      e.returnValue = ''
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushWorkspace()
    }
    window.addEventListener('beforeunload', onLeave)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flushWorkspace)
    return () => {
      window.removeEventListener('beforeunload', onLeave)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flushWorkspace)
    }
  }, [])

  useEffect(() => {
    if (!toast || exporting) return
    const sticky = /failed|missing|cannot|need/i.test(toast)
    const id = setTimeout(() => setToast(null), sticky ? 14000 : Math.min(12000, Math.max(6000, toast.length * 60)))
    return () => clearTimeout(id)
  }, [toast, exporting])

  useHotkeys(setToast, () => setKeysOpen((open) => !open), setMobilePane)

  function onExportClick() {
    const editor = useEditor.getState()
    if (editor.exporting) {
      void cancelExport()
      return
    }
    const busy = mediaBusyToast(false, editor.analyzing)
    if (busy) {
      setToast(busy)
      return
    }
    if (!isElectron) {
      setExportOpen(true)
      return
    }
    void loadMediaHealth().then((health) => {
      setMediaHealth(health)
      if (!health.ok) {
        setToast(health.message ?? 'FFmpeg did not start.')
        return
      }
      setExportOpen(true)
    })
  }

  useEffect(() => {
    const onExportEvent = () => onExportClick()
    const onKeys = () => setKeysOpen(true)
    const onWorkflow = () => setWorkflowOpen(true)
    const onToastEvent = (event: Event) => {
      const message = (event as CustomEvent<string>).detail
      if (message) setToast(message)
    }
    window.addEventListener('speechedit:export', onExportEvent)
    window.addEventListener('speechedit:shortcuts', onKeys)
    window.addEventListener('speechedit:quick-edit', onWorkflow)
    window.addEventListener('speechedit:toast', onToastEvent)
    return () => {
      window.removeEventListener('speechedit:export', onExportEvent)
      window.removeEventListener('speechedit:shortcuts', onKeys)
      window.removeEventListener('speechedit:quick-edit', onWorkflow)
      window.removeEventListener('speechedit:toast', onToastEvent)
    }
  }, [])

  return (
    <div className="app" data-empty={emptyReel || undefined} data-mobile-pane={mobilePane}>
      <MenuBar
        onToast={setToast}
        onShare={() => setShareOpen(true)}
        onExport={onExportClick}
        exporting={exporting}
        onShortcuts={() => setKeysOpen(true)}
      />
      <nav className="mobile-workspace-nav" aria-label="Editor view">
        {WORKSPACE_PANES.map((id) => (
          <button
            key={id}
            type="button"
            data-on={mobilePane === id || undefined}
            aria-pressed={mobilePane === id}
            onClick={() => setMobilePane(id)}
          >
            {WORKSPACE_PANE_LABELS[id]}
          </button>
        ))}
      </nav>
      <div className="stage">
        <ActivityStrip />
        {(recoveryOffer || missingAssets.length > 0 || (isElectron && mediaHealth && !mediaHealth.ok)) && (
          <div className="doc-banners">
            {isElectron && mediaHealth && !mediaHealth.ok && (
              <div className="doc-banner" data-kind="missing">
                <span>{mediaHealth.message}</span>
                <button
                  type="button"
                  onClick={() => {
                    void loadMediaHealth(true).then((next) => {
                      setMediaHealth(next)
                      if (next.ok) setToast(`${next.ffmpeg.version ? `FFmpeg ${next.ffmpeg.version}` : 'FFmpeg'} is ready.`)
                    })
                  }}
                >
                  Check again
                </button>
              </div>
            )}
            {recoveryOffer && (
              <div className="doc-banner" data-kind="recovery">
                <span>{recoveryCopy(recoveryOffer)} — restore them or keep the last save.</span>
                <button
                  type="button"
                  onClick={() => {
                    void restoreRecovery().then(() => setToast('Restored unsaved edits.'))
                  }}
                >
                  Restore
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void discardRecovery().then(() => setToast('Kept the last save.'))
                  }}
                >
                  Keep saved
                </button>
              </div>
            )}
            {missingAssets.length > 0 && (
              <div className="doc-banner" data-kind="missing">
                <span>
                  {missingAssets.length === 1
                    ? missingAssets[0].path.startsWith('blob:')
                      ? `Reconnect after browser reload: ${missingAssets[0].name}`
                      : `Media missing: ${missingAssets[0].name}`
                    : `${missingAssets.length} media files are missing`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void relinkAssetInteractive(missingAssets[0].id).then((result) => {
                      if (result) {
                        void refreshMissingAssets()
                        setToast(relinkToast(missingAssets[0].name, result.nearby))
                      }
                    })
                  }}
                >
                  {missingAssets[0].path.startsWith('blob:') ? 'Reconnect…' : 'Relink…'}
                </button>
                {missingAssets.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      void relinkAllMissing((name) => setToast(`Relinked ${name}.`)).then((n) => {
                        if (n) setToast(`Relinked ${n} file${n === 1 ? '' : 's'}.`)
                      })
                    }}
                  >
                    Relink all…
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <main className="workspace">
          <Transcript onToast={setToast} />
          <Monitor onToast={setToast} />
          <Inspector onToast={setToast} />
        </main>
      </div>
      <Timeline onToast={setToast} />
      {toast && (
        <div className="toast">
          <span role="status" aria-live="polite">{toast}</span>
          <button type="button" className="chip" aria-label="Dismiss message" onClick={() => setToast(null)}>Dismiss</button>
        </div>
      )}
      <Suggestions onToast={setToast} />
      <Palette onToast={setToast} />
      <WorkflowSheet open={workflowOpen} onClose={() => setWorkflowOpen(false)} onToast={setToast} />
      <ConfirmSheet />
      <PreferencesSheet />
      {shareOpen && <ShareSheet onClose={() => setShareOpen(false)} onToast={setToast} />}
      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} onToast={setToast} />
      <ShortcutsOverlay open={keysOpen} onClose={() => setKeysOpen(false)} />
      <ContextMenuHost menu={contextMenu} onClose={closeContextMenu} />
    </div>
  )
}

function useHotkeys(
  setToast: (msg: string) => void,
  toggleKeys: () => void,
  setMobilePane: (pane: WorkspacePane) => void
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (blocksEditorShortcut(e)) return
      // Holding a destructive shortcut must not repeatedly edit the project.
      if (e.repeat && !['ArrowLeft', 'ArrowRight', 'j', 'l'].includes(e.key)) return
      const meta = e.metaKey || e.ctrlKey
      const typing = isTypingTarget(e.target)
      const editor = useEditor.getState()
      const playback = usePlayback.getState()
      const pane = workspacePaneFromHotkey(e)
      if (pane && !typing) {
        e.preventDefault()
        setMobilePane(pane)
        return
      }
      if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !typing && !meta) {
        e.preventDefault()
        toggleKeys()
        return
      }

      if (e.key === 'Escape' && (editor.exporting || editor.analyzing) && !editor.palette) {
        e.preventDefault()
        if (editor.exporting) void cancelExport()
        else void cancelImport()
        return
      }
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        editor.setPalette(!editor.palette)
        return
      }
      if (meta && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        openAssistant()
        return
      }
      if (e.code === 'Space' && !typing) {
        e.preventDefault()
        playback.toggle()
        return
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        editor.redo()
        return
      }
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? editor.redo() : editor.undo()
        return
      }
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (isTypingTarget(e.target)) (e.target as HTMLElement).blur()
        void saveCurrentDocument({ saveAs: e.shiftKey }).then(
          (path) => {
            if (path) setToast(`Saved ${path.split(/[\\/]/).pop()}.`)
          },
          (err: unknown) => {
            setToast(err instanceof Error ? err.message : 'Save failed.')
          }
        )
        return
      }
      if (e.altKey && !['ArrowLeft', 'ArrowRight'].includes(e.key)) return
      if (e.key === 'Home' && !typing) {
        playback.seekProgram(0)
        return
      }
      if (e.key === 'End' && !typing) {
        playback.seekProgram(currentProgramDuration())
        return
      }
      if ((e.key === '\\' || e.code === 'Backslash') && !typing && !meta) {
        e.preventDefault()
        playback.fitTimeline()
        setToast('Timeline fits the reel.')
        return
      }
      if ((e.key === 'q' || e.key === 'Q') && !typing && !meta) {
        e.preventDefault()
        editor.dispatch({
          type: 'rippleTrimToPlayhead',
          edge: 'in',
          time: playback.programTime,
          lift: !editor.ripple
        })
        setToast('Trimmed the start up to here.')
        return
      }
      if ((e.key === 'w' || e.key === 'W') && !typing && !meta) {
        e.preventDefault()
        editor.dispatch({
          type: 'rippleTrimToPlayhead',
          edge: 'out',
          time: playback.programTime,
          lift: !editor.ripple
        })
        setToast('Trimmed the end back to here.')
        return
      }
      if ((e.key === 'c' || e.key === 'C') && meta && !typing) {
        e.preventDefault()
        if (editor.selectedWordIds.length) {
          setToast(copyQuoteFromContext().toast)
          return
        }
        if (copySelectedClip(e.shiftKey ? 'look' : 'clip')) {
          setToast(e.shiftKey ? 'Copied clip look (transform, volume, fades).' : 'Copied clip. ⌘V pastes at the playhead.')
        }
        return
      }
      if ((e.key === 'v' || e.key === 'V') && meta && !typing) {
        e.preventDefault()
        if (pasteClipboard(e.shiftKey ? 'look' : 'clip')) {
          setToast(e.shiftKey ? 'Pasted look onto the selected clip.' : 'Pasted the clip at the playhead.')
        }
        return
      }
      if ((e.key === 'n' || e.key === 'N') && !typing && !meta) {
        const note = hopNote(editor.project, programToSourceOf(editor.project, playback.programTime), e.shiftKey ? -1 : 1)
        if (note) {
          e.preventDefault()
          playback.seekSource(note.start)
          setToast(describeNoteHop(note.label, notesSorted(editor.project).length))
        }
        return
      }
      if ((e.key === 'e' || e.key === 'E') && !typing && !meta) {
        const movable = findMovableClip(editor.project, editor.selectedClipId)
        if (movable) {
          e.preventDefault()
          editor.dispatch({ type: 'extendClip', clipId: movable.id, time: playback.programTime })
          setToast('Extended the clip to the playhead.')
        }
        return
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !typing && !meta) {
        e.preventDefault()
        const dir = e.key === 'ArrowRight' ? 1 : -1
        const frame = 1 / Math.max(1, editor.project.fps)
        const ids = movableIds(
          editor.project,
          editor.selectedClipIds.length ? editor.selectedClipIds : editor.selectedClipId ? [editor.selectedClipId] : []
        )
        if (ids.length) {
          const step = e.shiftKey ? 1 : e.altKey ? frame * 10 : frame
          editor.dispatch({ type: 'nudgeClips', clipIds: ids, delta: dir * step })
          return
        }
        const step = e.shiftKey ? 1 : frame
        playback.seekProgram(Math.max(0, playback.programTime + dir * step))
        return
      }
      if ((e.key === 'i' || e.key === 'I') && !typing && !meta) {
        const span = wordRange(editor.project.transcript.words, editor.selectedWordIds)
        editor.dispatch({
          type: 'setMarks',
          markIn: span ? sourceToProgramOf(editor.project, span.start) : playback.programTime
        })
        return
      }
      if ((e.key === 'o' || e.key === 'O') && !typing && !meta) {
        const span = wordRange(editor.project.transcript.words, editor.selectedWordIds)
        editor.dispatch({
          type: 'setMarks',
          markOut: span ? sourceToProgramOf(editor.project, span.end) : playback.programTime
        })
        return
      }
      if ((e.key === 'm' || e.key === 'M') && !typing && !meta) {
        const hadMarks = editor.project.markIn != null || editor.project.markOut != null
        const result = markClipFromContext()
        if (result.marked || hadMarks) {
          e.preventDefault()
          setToast(result.toast)
        }
        return
      }
      if (e.key === '/' && !typing && !meta) {
        e.preventDefault()
        usePlayback.setState({ loop: !playback.loop })
        setToast(playback.loop ? 'Loop off' : 'Loop the marked range — or the whole reel if marks are empty.')
        return
      }
      if ((e.key === 'g' || e.key === 'G') && !typing && !meta) {
        e.preventDefault()
        const next = editor.tool === 'guard' ? 'select' : 'guard'
        editor.setTool(next)
        if (e.shiftKey) editor.setGuardKind('demo')
        setToast(
          next === 'guard'
            ? e.shiftKey
              ? 'Protecting as silent demo — drag words. Esc or Done to stop.'
              : 'Protecting — drag words so Auto Edit skips them. Shift = silent demo. Esc to stop.'
            : 'Done protecting'
        )
        return
      }
      if ((e.key === '.' || e.key === '>') && !typing && !meta) {
        e.preventDefault()
        const result = cutThisFromContext()
        if (result.toast) setToast(result.toast)
        return
      }
      if ((e.key === ',' || e.key === '<') && !typing && !meta) {
        const wordId =
          editor.selectedWordIds[0] ??
          currentWord(editor.project.transcript.words, programToSourceOf(editor.project, playback.programTime))?.id
        if (wordId) {
          e.preventDefault()
          if (!editor.selectedWordIds.length) editor.selectWords([wordId])
          const result = cutPreviousFromContext()
          if (result.toast) setToast(result.toast)
        }
        return
      }
      if ((e.key === 't' || e.key === 'T') && !typing && !meta) {
        const span =
          wordRange(editor.project.transcript.words, editor.selectedWordIds) ??
          (editor.project.markIn != null && editor.project.markOut != null
            ? {
                start: programToSourceOf(editor.project, Math.min(editor.project.markIn, editor.project.markOut)),
                end: programToSourceOf(editor.project, Math.max(editor.project.markIn, editor.project.markOut))
              }
            : null)
        if (span) {
          e.preventDefault()
          editor.dispatch({ type: 'tightenRange', start: span.start, end: span.end })
          setToast('Tightened pauses. Protected demo stayed.')
        }
        return
      }
      if ((e.key === 'p' || e.key === 'P') && !typing && !meta) {
        e.preventDefault()
        playInOutOrSelection()
        setToast(
          editor.project.markIn != null && editor.project.markOut != null
            ? 'Playing the marked range.'
            : editor.selectedWordIds.length
              ? 'Playing the selection.'
              : 'Playing from the playhead.'
        )
        return
      }
      if ((e.key === 'c' || e.key === 'C') && !typing && !meta) {
        const before = editor.project.splits?.length ?? 0
        e.preventDefault()
        bladeAtWord()
        const after = useEditor.getState().project.splits?.length ?? 0
        if (after !== before) setToast('Bladed at the word.')
        return
      }
      if ((e.key === 'a' || e.key === 'A') && !typing && !meta) {
        e.preventDefault()
        setToast(selectParagraphFromContext().toast)
        return
      }
      if ((e.key === 'x' || e.key === 'X') && !typing && !meta && editor.selectedWordIds.length) {
        e.preventDefault()
        if (isParagraphSelection(editor.project.transcript.words, editor.selectedWordIds)) {
          setToast(cutParagraphFromContext().toast)
          return
        }
        const cut = { type: 'toggleWords' as const, wordIds: editor.selectedWordIds, lift: !editor.ripple }
        const toast = toastForEdit(editor.project, cut)
        editor.dispatch(cut)
        if (toast) setToast(toast)
        return
      }
      if ((e.key === 'u' || e.key === 'U') && !typing && !meta) {
        e.preventDefault()
        const removedIds = editor.project.transcript.words.filter((word) => word.deleted && editor.selectedWordIds.includes(word.id)).map((word) => word.id)
        if (removedIds.length) {
          editor.dispatch({ type: 'toggleWords', wordIds: removedIds })
          setToast('Restored the selected words.')
          return
        }
        if (editor.selectedSuggestionId) {
          editor.dispatch({ type: 'revertSuggestion', suggestionId: editor.selectedSuggestionId })
        }
        return
      }
      if ((e.key === 'b' || e.key === 'B') && !typing && !meta) {
        const result = protectFromContext(e.shiftKey ? 'demo' : 'keep')
        if (result.started) e.preventDefault()
        setToast(result.toast)
        return
      }
      if (e.key === 'F2' && !typing && !meta) {
        if (editor.selectedSceneId) {
          e.preventDefault()
          startSceneRename(editor.selectedSceneId)
          return
        }
        if (startSpeakerRename().started) {
          e.preventDefault()
          return
        }
      }
      if ((e.key === '[' || e.key === ']') && !typing && !meta) {
        e.preventDefault()
        const sceneStep = e.key === ']' ? 1 : -1
        const hop =
          editor.selectedSceneId && neighborScene(editor.project.scenes ?? [], editor.selectedSceneId, sceneStep)
        if (hop) {
          editor.selectScene(hop.id)
          playback.seekSource(hop.start)
          playback.playLoop(
            sourceToProgramOf(editor.project, hop.start),
            sourceToProgramOf(editor.project, hop.end)
          )
          return
        }
        editor.selectWords(
          e.key === '['
            ? shrinkSelection(editor.project.transcript.words, editor.selectedWordIds)
            : extendSelection(editor.project.transcript.words, editor.selectedWordIds, 1)
        )
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && !meta) {
        if (editor.selectedSceneId) {
          e.preventDefault()
          setToast(removeSceneFromContext(editor.selectedSceneId).toast)
          return
        }
        if (editor.selectedWordIds.length) {
          e.preventDefault()
          if (!editor.project.transcript.words.some((word) => editor.selectedWordIds.includes(word.id) && !word.deleted)) {
            setToast('These words are already removed. Use Restore words or Undo to put them back.')
            return
          }
          if (isParagraphSelection(editor.project.transcript.words, editor.selectedWordIds)) {
            setToast(cutParagraphFromContext().toast)
            return
          }
          const cut = { type: 'toggleWords' as const, wordIds: editor.selectedWordIds, lift: !editor.ripple }
          const toast = toastForEdit(editor.project, cut)
          editor.dispatch(cut)
          if (toast) setToast(toast)
          return
        }
        if (editor.project.markIn != null && editor.project.markOut != null) {
          e.preventDefault()
          editor.dispatch({ type: editor.ripple ? 'rippleDeleteMarks' : 'liftMarks' })
          return
        }
        const clipIds = editor.selectedClipIds.length
          ? editor.selectedClipIds
          : editor.selectedClipId
            ? [editor.selectedClipId]
            : []
        if (clipIds.length) {
          e.preventDefault()
          editor.dispatch({ type: 'removeClips', clipIds })
        }
        return
      }
      if (e.key.toLowerCase() === 's' && !typing && !meta) {
        editor.dispatch({
          type: 'splitAt',
          time: programToSourceOf(editor.project, playback.programTime)
        })
        return
      }
      if (e.key.toLowerCase() === 'k' && !typing && !meta) playback.toggle()
      if (e.key.toLowerCase() === 'j' && !typing && !meta) {
        playback.seekProgram(Math.max(0, playback.programTime - 2))
      }
      if (e.key.toLowerCase() === 'l' && !typing && !meta) {
        playback.seekProgram(Math.min(programLength(editor.project), playback.programTime + 2))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setToast, toggleKeys])
}
