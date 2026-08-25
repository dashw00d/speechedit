import { useEffect, useState } from 'react'
import { ConfirmSheet } from './components/ConfirmSheet'
import { ExportSheet } from './components/ExportSheet'
import { PreferencesSheet } from './components/PreferencesSheet'
import { ContextMenuHost, useContextMenu } from './components/ContextMenu'
import { AgentPanel } from './components/AgentPanel'
import { Inspector } from './components/Inspector'
import { MenuBar } from './components/MenuBar'
import { Monitor } from './components/Monitor'
import { Palette } from './components/Palette'
import { ShortcutsOverlay } from './components/ShortcutsOverlay'
import { Suggestions } from './components/Suggestions'
import { Timeline } from './components/Timeline'
import { Transcript } from './components/Transcript'
import { findMovableClip, programLength } from './lib/commands'
import { copySelectedClip, copyWordText, pasteClipboard } from './lib/clipClipboard'
import { hopNote, movableIds } from './lib/clipEdit'
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
import { bladeAtWord, playInOutOrSelection, selectParagraphAtCaret } from './lib/scriptActions'
import { neighborScene } from './lib/sceneChip'
import { extendSelection, sentenceIds, shrinkSelection, wordRange } from './lib/transcriptEdit'
import { cancelExport, cancelImport, mediaBusyToast } from './lib/mediaJobs'
import { currentProgramDuration, flushWorkspace, useEditor, usePlayback } from './store'
import { useClearSelection } from './useClearSelection'
import { activeThemeId, subscribeTheme } from './lib/theme'

export function App() {
  const [, setThemeId] = useState(activeThemeId)
  const [toast, setToast] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const { menu: contextMenu, closeMenu: closeContextMenu } = useContextMenu()
  useClearSelection()
  const exporting = useEditor((s) => s.exporting)
  const agentOpen = useEditor((s) => s.agentOpen)
  const recoveryOffer = useEditor((s) => s.recoveryOffer)
  const missingAssets = useEditor((s) => s.missingAssets)

  useEffect(() => subscribeTheme(setThemeId), [])

  useEffect(() => {
    void hydrateWorkspace()
      .then((result) => {
        if (result.recovery) setToast('Crash recovery is available — restore unsaved edits or keep the last save.')
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!useEditor.getState().dirty) return
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
    const id = setTimeout(() => setToast(null), sticky ? 14000 : 3600)
    return () => clearTimeout(id)
  }, [toast, exporting])

  useHotkeys(setToast, () => setKeysOpen((open) => !open))

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
    setExportOpen(true)
  }

  useEffect(() => {
    const onExportEvent = () => onExportClick()
    const onKeys = () => setKeysOpen(true)
    window.addEventListener('speechedit:export', onExportEvent)
    window.addEventListener('speechedit:shortcuts', onKeys)
    return () => {
      window.removeEventListener('speechedit:export', onExportEvent)
      window.removeEventListener('speechedit:shortcuts', onKeys)
    }
  }, [])

  return (
    <div className="app">
      <MenuBar
        onToast={setToast}
        onExport={onExportClick}
        exporting={exporting}
        onShortcuts={() => setKeysOpen(true)}
      />
      <div className="stage">
        {(recoveryOffer || missingAssets.length > 0) && (
          <div className="doc-banners">
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
                    ? `Media missing: ${missingAssets[0].name}`
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
                  Relink…
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
      <Timeline />
      <Suggestions />
      <Palette onToast={setToast} />
      {agentOpen && <AgentPanel variant="dock" onToast={setToast} />}
      {toast && <div className="toast">{toast}</div>}
      <ConfirmSheet />
      <PreferencesSheet />
      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} onToast={setToast} />
      <ShortcutsOverlay open={keysOpen} onClose={() => setKeysOpen(false)} />
      <ContextMenuHost menu={contextMenu} onClose={closeContextMenu} />
    </div>
  )
}

function useHotkeys(setToast: (msg: string) => void, toggleKeys: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      const target = e.target as HTMLElement
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      const editor = useEditor.getState()
      const playback = usePlayback.getState()
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
        editor.setAgentOpen(!editor.agentOpen)
        return
      }
      if (e.code === 'Space' && !typing) {
        e.preventDefault()
        if (playback.playing || (playback.loopFrom != null && playback.playUntil != null)) {
          playback.toggle()
          return
        }
        const ids = editor.selectedWordIds
        const index = editor.project.transcript.words.findIndex((w) => w.id === ids[0])
        if (index >= 0) {
          const range = wordRange(editor.project.transcript.words, sentenceIds(editor.project.transcript.words, index))
          if (range) {
            playback.playLoop(
              sourceToProgramOf(editor.project, range.start),
              sourceToProgramOf(editor.project, range.end)
            )
            return
          }
        }
        playback.toggle()
        return
      }
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? editor.redo() : editor.undo()
        return
      }
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
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
          if (copyWordText()) setToast('Copied the selected words.')
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
          setToast(note.label || 'Note')
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
        const span = wordRange(editor.project.transcript.words, editor.selectedWordIds)
        if (span) {
          e.preventDefault()
          editor.dispatch({
            type: 'setMarks',
            markIn: sourceToProgramOf(editor.project, span.start),
            markOut: sourceToProgramOf(editor.project, span.end)
          })
          setToast('Marked the selected words. / loops them, Delete ripples them.')
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
        const wordId =
          editor.selectedWordIds[0] ??
          currentWord(editor.project.transcript.words, programToSourceOf(editor.project, playback.programTime))?.id
        if (wordId) {
          e.preventDefault()
          editor.dispatch({ type: 'cutSentence', wordId })
        }
        return
      }
      if ((e.key === ',' || e.key === '<') && !typing && !meta) {
        const wordId =
          editor.selectedWordIds[0] ??
          currentWord(editor.project.transcript.words, programToSourceOf(editor.project, playback.programTime))?.id
        if (wordId) {
          e.preventDefault()
          editor.dispatch({ type: 'cutPreviousSentence', wordId })
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
        selectParagraphAtCaret()
        return
      }
      if ((e.key === 'x' || e.key === 'X') && !typing && !meta && editor.selectedWordIds.length) {
        e.preventDefault()
        editor.dispatch({ type: 'toggleWords', wordIds: editor.selectedWordIds, lift: !editor.ripple })
        return
      }
      if ((e.key === 'u' || e.key === 'U') && !typing && !meta) {
        e.preventDefault()
        const span = wordRange(editor.project.transcript.words, editor.selectedWordIds)
        if (span) {
          editor.dispatch({ type: 'restoreRange', start: span.start, end: span.end })
          return
        }
        if (editor.selectedSuggestionId) {
          editor.dispatch({ type: 'revertSuggestion', suggestionId: editor.selectedSuggestionId })
        }
        return
      }
      if ((e.key === 'b' || e.key === 'B') && !typing && !meta) {
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
          editor.dispatch({
            type: 'addTag',
            start: span.start,
            end: span.end,
            kind: e.shiftKey ? 'demo' : 'keep'
          })
          setToast(
            e.shiftKey
              ? 'Silent demo — Auto Edit will skip pauses here.'
              : 'Protected — Auto Edit will skip this.'
          )
        }
        return
      }
      if ((e.key === '[' || e.key === ']') && !typing) {
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
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
        if (editor.selectedWordIds.length) {
          e.preventDefault()
          editor.dispatch({ type: 'toggleWords', wordIds: editor.selectedWordIds, lift: !editor.ripple })
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
      if (e.key.toLowerCase() === 'j' && !typing) {
        playback.seekProgram(Math.max(0, playback.programTime - 2))
      }
      if (e.key.toLowerCase() === 'l' && !typing) {
        playback.seekProgram(Math.min(programLength(editor.project), playback.programTime + 2))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setToast, toggleKeys])
}
