import { useEffect, useState } from 'react'
import { AgentPanel } from './components/AgentPanel'
import { Inspector } from './components/Inspector'
import { MenuBar } from './components/MenuBar'
import { Monitor } from './components/Monitor'
import { Palette } from './components/Palette'
import { Suggestions } from './components/Suggestions'
import { Timeline } from './components/Timeline'
import { Transcript } from './components/Transcript'
import { host, isElectron } from './host'
import { findMovableClip, programLength } from './lib/commands'
import {
  discardRecovery,
  hydrateWorkspace,
  recoveryCopy,
  refreshMissingAssets,
  relinkAssetInteractive,
  restoreRecovery,
  saveCurrentDocument
} from './lib/documentIo'
import { currentWord } from './lib/edl'
import { summarizeJob, validateExportJob } from './lib/exportGraph'
import { buildExportJob } from './lib/exportJob'
import { programToSourceOf, snapTime, sourceToProgramOf } from './lib/resolver'
import { bladeAtWord, playInOutOrSelection, selectParagraphAtCaret } from './lib/scriptActions'
import { extendSelection, wordRange } from './lib/transcriptEdit'
import { cancelExport, cancelImport, isJobCancelled, mediaBusyToast } from './lib/mediaJobs'
import { currentProgramDuration, flushWorkspace, useEditor, usePlayback } from './store'

export function App() {
  const [toast, setToast] = useState<string | null>(null)
  const exporting = useEditor((s) => s.exporting)
  const agentOpen = useEditor((s) => s.agentOpen)
  const recoveryOffer = useEditor((s) => s.recoveryOffer)
  const missingAssets = useEditor((s) => s.missingAssets)

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

  useHotkeys(setToast)

  async function onExport() {
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
    const project = editor.project
    const job = buildExportJob(project, '')
    if (!job) {
      setToast('Open media to export a program.')
      return
    }
    const graphProblem = validateExportJob(job)
    if (graphProblem) {
      setToast(graphProblem)
      return
    }
    if (!isElectron) {
      setToast('Export needs the Electron app.')
      return
    }
    const output = await host.chooseExport()
    if (!output) return
    editor.setExporting(true)
    setToast(`Export 0% — ${summarizeJob(job)}`)
    const stop = host.onExportProgress((info) =>
      setToast(`Export ${Math.round(info.ratio * 100)}% — ${info.stage}`)
    )
    try {
      await host.exportProgram({ ...job, output })
      setToast(`Export finished — ${summarizeJob(job)}. File: ${output}`)
    } catch (err) {
      setToast(isJobCancelled(err) ? 'Export cancelled.' : err instanceof Error ? err.message : 'Export failed.')
    } finally {
      stop()
      useEditor.getState().setExporting(false)
    }
  }

  return (
    <div className="app">
      <MenuBar onToast={setToast} onExport={onExport} exporting={exporting} />
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
                    void relinkAssetInteractive(missingAssets[0].id).then((path) => {
                      if (path) {
                        void refreshMissingAssets()
                        setToast(`Relinked ${missingAssets[0].name}.`)
                      }
                    })
                  }}
                >
                  Relink…
                </button>
              </div>
            )}
          </div>
        )}
        <main className="workspace">
          <Transcript onToast={setToast} />
          <Monitor />
          <Inspector onToast={setToast} />
        </main>
      </div>
      <Timeline />
      <Suggestions />
      <Palette />
      {agentOpen && <AgentPanel variant="dock" onToast={setToast} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function useHotkeys(setToast: (msg: string) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      const target = e.target as HTMLElement
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      const editor = useEditor.getState()
      const playback = usePlayback.getState()

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
      if ((e.key === 'q' || e.key === 'Q') && !typing && !meta) {
        e.preventDefault()
        editor.dispatch({ type: 'rippleTrimToPlayhead', edge: 'in', time: playback.programTime })
        setToast('Q · ripple trimmed in to playhead')
        return
      }
      if ((e.key === 'w' || e.key === 'W') && !typing && !meta) {
        e.preventDefault()
        editor.dispatch({ type: 'rippleTrimToPlayhead', edge: 'out', time: playback.programTime })
        setToast('W · ripple trimmed out to playhead')
        return
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !typing && !meta) {
        e.preventDefault()
        const dir = e.key === 'ArrowRight' ? 1 : -1
        const frame = 1 / Math.max(1, editor.project.fps)
        const movable = findMovableClip(editor.project, editor.selectedClipId)
        if (movable) {
          const step = e.shiftKey ? 1 : e.altKey ? frame * 10 : frame
          let start = Math.max(0, movable.start + dir * step)
          if (editor.snap && e.shiftKey) start = snapTime(editor.project, start, [playback.programTime])
          editor.dispatch({ type: 'moveClip', clipId: movable.id, start })
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
        setToast(playback.loop ? 'Loop off' : 'Loop I/O — or the whole reel if marks are empty.')
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
              ? 'Guard brush — silent demo. Drag the tape or words; already-cut air comes back.'
              : 'Guard brush — drag the tape or words. Shift = silent demo.'
            : 'Select tool'
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
          setToast('Tightened gaps — guarded demo/keep ranges stayed.')
        }
        return
      }
      if ((e.key === 'p' || e.key === 'P') && !typing && !meta) {
        e.preventDefault()
        playInOutOrSelection()
        setToast(
          editor.project.markIn != null && editor.project.markOut != null
            ? 'Playing I/O.'
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
        editor.dispatch({ type: 'toggleWords', wordIds: editor.selectedWordIds })
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
          setToast(e.shiftKey ? 'Tagged silent demo — Auto Edit will skip it.' : 'Tagged keep — Auto Edit will skip it.')
        }
        return
      }
      if ((e.key === '[' || e.key === ']') && !typing) {
        e.preventDefault()
        editor.selectWords(
          extendSelection(editor.project.transcript.words, editor.selectedWordIds, e.key === '[' ? -1 : 1)
        )
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
        if (editor.selectedWordIds.length) {
          e.preventDefault()
          editor.dispatch({ type: 'toggleWords', wordIds: editor.selectedWordIds })
          return
        }
        if (editor.project.markIn != null && editor.project.markOut != null) {
          e.preventDefault()
          editor.dispatch({ type: 'rippleDeleteMarks' })
          return
        }
        const clip = editor.project.tracks.flatMap((t) => t.clips).find((c) => c.id === editor.selectedClipId)
        if (clip) {
          e.preventDefault()
          editor.dispatch({ type: 'removeClip', clipId: clip.id })
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
  }, [setToast])
}
