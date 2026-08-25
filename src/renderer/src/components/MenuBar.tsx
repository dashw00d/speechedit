import type { ReactNode } from 'react'
import { host, isElectron } from '../host'
import { importRecording } from '../lib/importMedia'
import { applyInterchange, pickInterchange } from '../lib/interchange'
import { askEditor } from '../lib/askModel'
import { programLength } from '../lib/commands'
import { pickAudio, pickBroll } from '../lib/pickFile'
import { bladeAtWord, playInOutOrSelection, selectParagraphAtCaret } from '../lib/scriptActions'
import { programToSourceOf } from '../lib/resolver'
import {
  confirmLoseWork,
  currentDocumentTitle,
  openCurrentDocument,
  saveCurrentDocument
} from '../lib/documentIo'
import { parseAnyTranscript } from '../lib/transcript'
import {
  cancelExport,
  cancelImport,
  createImportSignal,
  explainImportError,
  isJobCancelled,
  mediaBusyToast,
  whisperMissingMessage
} from '../lib/mediaJobs'
import { useEditor, usePlayback } from '../store'

interface Props {
  onToast: (msg: string) => void
  onExport: () => void
  exporting: boolean
}

export function MenuBar({ onToast, onExport, exporting }: Props) {
  const project = useEditor((s) => s.project)
  const dirty = useEditor((s) => s.dirty)
  const analyzing = useEditor((s) => s.analyzing)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const past = useEditor((s) => s.past.length)
  const future = useEditor((s) => s.future.length)
  const loadProject = useEditor((s) => s.loadProject)
  const newProject = useEditor((s) => s.newProject)
  const loadDemo = useEditor((s) => s.loadDemo)
  const dispatch = useEditor((s) => s.dispatch)
  const documentPath = useEditor((s) => s.documentPath)
  const setAnalyzing = useEditor((s) => s.setAnalyzing)
  const setPalette = useEditor((s) => s.setPalette)
  const snap = useEditor((s) => s.snap)
  const ripple = useEditor((s) => s.ripple)

  async function importMedia() {
    const busy = mediaBusyToast(exporting, analyzing)
    if (busy) {
      onToast(busy)
      return
    }
    if (!confirmLoseWork()) return
    const file = await host.openMedia()
    if (!file) {
      onToast(isElectron ? 'No file selected.' : 'Open this in Electron to import media.')
      return
    }
    const signal = createImportSignal()
    let whisperNote: string | null = null
    try {
      await host.beginJob('import')
      const next = await importRecording(file, {
        signal,
        onStage: (stage) => {
          if (stage === 'transcript:missing') {
            whisperNote = whisperMissingMessage()
            setAnalyzing('transcript')
            return
          }
          setAnalyzing(stage)
          onToast(`Analyzing · ${stage}`)
        }
      })
      loadProject(next, { path: null, clean: false })
      onToast(
        whisperNote
          ? `${next.name} · ${next.transcript.words.length} island words. ${whisperNote}`
          : `${next.name} · ${next.suggestions.length} suggestions · ${next.transcript.words.length} words`
      )
    } catch (err) {
      onToast(isJobCancelled(err) ? 'Import cancelled.' : err instanceof Error ? err.message : 'Import failed.')
    } finally {
      await host.endJob('import').catch(() => undefined)
      setAnalyzing(null)
    }
  }

  async function addPickedOverlay(role: 'broll' | 'audio') {
    const busy = mediaBusyToast(exporting, analyzing)
    if (busy) {
      onToast(busy)
      return
    }
    try {
      await host.beginJob('import')
      setAnalyzing('probe')
      const asset = role === 'broll' ? await pickBroll() : await pickAudio()
      if (!asset) return
      dispatch(
        role === 'broll'
          ? {
              type: 'addBroll',
              start: usePlayback.getState().programTime,
              duration: Math.min(6, asset.duration || 6),
              asset
            }
          : {
              type: 'addAudio',
              start: usePlayback.getState().programTime,
              duration: Math.min(asset.duration || 8, programLength(project) || asset.duration || 8),
              asset
            }
      )
      onToast(`${role === 'broll' ? 'B-roll' : 'Music'} · ${asset.name}`)
    } catch (err) {
      onToast(explainImportError(err))
    } finally {
      await host.endJob('import').catch(() => undefined)
      setAnalyzing(null)
    }
  }

  async function openTranscript() {
    try {
      const result = await host.openTranscript()
      if (!result) return
      const words = parseAnyTranscript(result.name, result.text)
      useEditor.getState().loadTranscript(words)
      onToast(`Transcript · ${words.length} words`)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Transcript import failed.')
    }
  }

  function ioSource() {
    if (project.markIn == null || project.markOut == null) {
      onToast('Mark I and O first, or select words and press M.')
      return null
    }
    return {
      start: programToSourceOf(project, Math.min(project.markIn, project.markOut)),
      end: programToSourceOf(project, Math.max(project.markIn, project.markOut))
    }
  }

  async function importTimeline() {
    const result = isElectron ? await host.openInterchange() : await pickInterchange()
    if (!result) return
    try {
      const next = applyInterchange(project, result.name, result.text)
      dispatch({ type: 'replaceProject', project: next })
      onToast(`Imported ${result.name}`)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Import failed.')
    }
  }

  return (
    <header className="menubar">
      <div className="brand">
        <span className="brand-mark">
          Speech<em>Edit</em>
        </span>
        <span className="brand-sub">the only program</span>
      </div>
      <nav className="menu-cluster">
        <Menu label="File">
          <Item
            onClick={() => {
              if (!confirmLoseWork()) return
              newProject()
            }}
          >
            New reel
          </Item>
          <Item disabled={Boolean(analyzing) || exporting} onClick={() => void importMedia()}>
            Open media…
          </Item>
          <Item onClick={() => void openTranscript()}>Open transcript…</Item>
          <Item onClick={() => void importTimeline()}>Import timeline…</Item>
          <Item
            onClick={async () => {
              if (!confirmLoseWork()) return
              try {
                const path = await openCurrentDocument()
                if (path) onToast(`Opened ${currentDocumentTitle()}.`)
              } catch (err) {
                onToast(err instanceof Error ? err.message : 'Open failed.')
              }
            }}
          >
            Open project…
          </Item>
          <Item
            onClick={async () => {
              try {
                const path = await saveCurrentDocument()
                if (path) onToast(isElectron ? `Saved ${currentDocumentTitle()}.` : `Downloaded ${path}`)
              } catch (err) {
                onToast(err instanceof Error ? err.message : 'Save failed.')
              }
            }}
          >
            Save
          </Item>
          <Item
            onClick={async () => {
              try {
                const path = await saveCurrentDocument({ saveAs: true })
                if (path) onToast(isElectron ? `Saved ${currentDocumentTitle()}.` : `Downloaded ${path}`)
              } catch (err) {
                onToast(err instanceof Error ? err.message : 'Save failed.')
              }
            }}
          >
            Save As…
          </Item>
          <Item
            onClick={() => {
              if (!confirmLoseWork()) return
              loadDemo()
            }}
          >
            Studio demo
          </Item>
        </Menu>
        <Menu label="Edit">
          <Item disabled={!past} onClick={undo}>
            Undo
          </Item>
          <Item disabled={!future} onClick={redo}>
            Redo
          </Item>
          <Item onClick={() => setPalette(true)}>Command palette</Item>
          <Item
            onClick={() =>
              dispatch({ type: 'splitAt', time: programToSourceOf(project, usePlayback.getState().programTime) })
            }
          >
            Razor at playhead
          </Item>
          <Item onClick={() => bladeAtWord()}>Blade at word</Item>
          <Item onClick={() => playInOutOrSelection()}>Play I/O or selection</Item>
          <Item onClick={() => selectParagraphAtCaret()}>Select paragraph</Item>
          <Item onClick={() => dispatch({ type: 'rippleDeleteMarks' })}>Ripple delete I/O</Item>
          <Item
            onClick={() =>
              dispatch({
                type: 'rippleTrimToPlayhead',
                edge: 'in',
                time: usePlayback.getState().programTime
              })
            }
          >
            Q · ripple trim in
          </Item>
          <Item
            onClick={() =>
              dispatch({
                type: 'rippleTrimToPlayhead',
                edge: 'out',
                time: usePlayback.getState().programTime
              })
            }
          >
            W · ripple trim out
          </Item>
        </Menu>
        <Menu label="Sequence">
          <Item
            onClick={() =>
              dispatch({
                type: 'addCaption',
                start: usePlayback.getState().programTime,
                duration: 3,
                text: 'Title'
              })
            }
          >
            Add title
          </Item>
          <Item
            onClick={() =>
              dispatch({
                type: 'addZoom',
                start: usePlayback.getState().programTime,
                duration: 3,
                scale: 1.45
              })
            }
          >
            Add zoom
          </Item>
          <Item
            onClick={() =>
              dispatch({
                type: 'addTitle',
                start: usePlayback.getState().programTime,
                duration: 3,
                text: 'Lower third',
                preset: 'lower-third'
              })
            }
          >
            Add lower third
          </Item>
          <Item
            onClick={() =>
              dispatch({
                type: 'generateCaptions',
                maxWords: 5,
                speakerPrefix: project.transcript.speakers.length > 1,
                emphasize: true
              })
            }
          >
            Caption remaining words
          </Item>
          <Item onClick={() => dispatch({ type: 'addLowerThirds' })}>Scene lower thirds</Item>
          <Item disabled={Boolean(analyzing) || exporting} onClick={() => void addPickedOverlay('broll')}>
            Add B-roll…
          </Item>
          <Item disabled={Boolean(analyzing) || exporting} onClick={() => void addPickedOverlay('audio')}>
            Add music bed…
          </Item>
          <Item
            onClick={() =>
              dispatch({
                type: 'addRedaction',
                start: usePlayback.getState().programTime,
                duration: 4
              })
            }
          >
            Add redaction
          </Item>
          <Item
            onClick={() =>
              dispatch({
                type: 'dissolveAtPlayhead',
                time: usePlayback.getState().programTime,
                duration: 0.4
              })
            }
          >
            Dissolve at playhead
          </Item>
          <Item onClick={() => dispatch({ type: 'addTrack', trackType: 'overlay' })}>
            Add overlay track
          </Item>
        </Menu>
        <Menu label="Export">
          <Item
            disabled={Boolean(analyzing) && !exporting}
            onClick={exporting ? () => void cancelExport() : onExport}
          >
            {exporting ? 'Cancel export' : 'Program MP4…'}
          </Item>
        </Menu>
        <Menu label="Auto Edit">
          <Item
            onClick={() => {
              useEditor.getState().setTool(useEditor.getState().tool === 'guard' ? 'select' : 'guard')
              onToast('Guard brush — drag the tape or words, then apply safe cuts.')
            }}
          >
            Paint guards
          </Item>
          <Item
            onClick={() => {
              useEditor.getState().setAgentOpen(true)
            }}
          >
            Ask agent… ⌘J
          </Item>
          <Item
            onClick={async () => {
              try {
                const result = await askEditor(project, 'Find scenes and mark retakes. Do not cut yet.')
                dispatch({ type: 'replaceProject', project: result.project })
                onToast(result.message)
              } catch (err) {
                onToast(err instanceof Error ? err.message : 'Scene pass failed.')
              }
            }}
          >
            Find scenes / retakes
          </Item>
          <Item onClick={() => dispatch({ type: 'inferScenes' })}>Local scene pass</Item>
          <Item onClick={() => dispatch({ type: 'rebuildIntelligence' })}>Rebuild intelligence</Item>
          <Item onClick={() => dispatch({ type: 'collapseRetakes' })}>Collapse retakes</Item>
          <Item onClick={() => dispatch({ type: 'applyModelSuggestions' })}>Apply model cuts</Item>
          <Item onClick={() => dispatch({ type: 'rebuildSuggestions' })}>Rebuild suggestions</Item>
          <Item onClick={() => dispatch({ type: 'applySafeSuggestions' })}>Apply safe cuts</Item>
          <Item onClick={() => useEditor.getState().setInspectorTab('agent')}>Open agent</Item>
          <Item onClick={() => useEditor.getState().setReviewing(true)}>Review suggestions</Item>
          <Item
            onClick={() => {
              const span = ioSource()
              if (span) dispatch({ type: 'addTag', ...span, kind: 'keep' })
            }}
          >
            Tag I/O as keep
          </Item>
          <Item
            onClick={() => {
              const span = ioSource()
              if (span) dispatch({ type: 'addTag', ...span, kind: 'demo' })
            }}
          >
            Tag I/O as silent demo
          </Item>
          <Item onClick={() => dispatch({ type: 'revertSuggestionType', suggestionType: 'silence' })}>
            Put back silence cuts
          </Item>
          <Item onClick={() => dispatch({ type: 'revertSuggestionType', suggestionType: 'filler' })}>
            Put back fillers
          </Item>
          <Item onClick={() => dispatch({ type: 'revertSuggestionType', suggestionType: 'repeat' })}>
            Put back retakes
          </Item>
          <Item
            onClick={() => {
              const span = ioSource()
              if (span) dispatch({ type: 'tightenRange', ...span })
            }}
          >
            Tighten I/O gaps
          </Item>
          <Item onClick={() => dispatch({ type: 'setAudioMaster', patch: { normalize: true } })}>
            Normalize to -16 LUFS
          </Item>
        </Menu>
        <button className="menu-btn" data-active={snap} onClick={() => useEditor.getState().setSnap(!snap)}>
          Snap
        </button>
        <button
          className="menu-btn"
          data-active={ripple}
          onClick={() => useEditor.getState().setRipple(!ripple)}
        >
          Ripple
        </button>
      </nav>
      <div className="menubar-right">
        <span
          className="status-pill"
          data-dirty={dirty || undefined}
          title={analyzing ? 'Cancel import' : undefined}
          onClick={analyzing ? () => void cancelImport() : undefined}
        >
          {analyzing
            ? `Analyze · ${analyzing}`
            : dirty
              ? 'Unsaved'
              : 'Saved'}{' '}
          · {documentPath ? currentDocumentTitle() : project.name} · {project.fps} fps · {project.width}×
          {project.height}
        </span>
        <button
          className="export-btn"
          onClick={exporting ? () => void cancelExport() : onExport}
          disabled={Boolean(analyzing) && !exporting}
        >
          {exporting ? 'Cancel' : 'Export'}
        </button>
      </div>
    </header>
  )
}

function Menu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="menu">
      <button className="menu-btn">{label}</button>
      <div className="menu-fly">{children}</div>
    </div>
  )
}

function Item({
  children,
  onClick,
  disabled
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button className="menu-item" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}
