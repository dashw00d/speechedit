import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { host, isElectron } from '../host'
import { askEditor } from '../lib/askModel'
import { programLength } from '../lib/commands'
import { pickAudio, pickBroll } from '../lib/pickFile'
import { bladeAtWord, playInOutOrSelection, selectParagraphAtCaret } from '../lib/scriptActions'
import { programToSourceOf } from '../lib/resolver'
import { confirmLoseWork, currentDocumentTitle, saveCurrentDocument } from '../lib/documentIo'
import {
  appendTakeAction,
  importMediaAction,
  importTimelineAction,
  openProjectAction,
  openRecentAction,
  openTranscriptAction,
  wireFileEvents
} from '../lib/fileActions'
import { listRecents } from '../lib/recents'
import {
  cancelExport,
  cancelImport,
  explainImportError,
  ffmpegImportBusy,
  mediaBusyToast
} from '../lib/mediaJobs'
import { copySelectedClip, pasteClipboard } from '../lib/clipClipboard'
import { hopNote } from '../lib/clipEdit'
import { openPreferences } from '../lib/theme'
import { useEditor, usePlayback } from '../store'

interface Props {
  onToast: (msg: string) => void
  onExport: () => void
  exporting: boolean
  onShortcuts?: () => void
}

export function MenuBar({ onToast, onExport, exporting, onShortcuts }: Props) {
  const project = useEditor((s) => s.project)
  const dirty = useEditor((s) => s.dirty)
  const analyzing = useEditor((s) => s.analyzing)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const past = useEditor((s) => s.past.length)
  const future = useEditor((s) => s.future.length)
  const newProject = useEditor((s) => s.newProject)
  const loadDemo = useEditor((s) => s.loadDemo)
  const dispatch = useEditor((s) => s.dispatch)
  const ripple = useEditor((s) => s.ripple)
  const documentPath = useEditor((s) => s.documentPath)
  const setAnalyzing = useEditor((s) => s.setAnalyzing)
  const setPalette = useEditor((s) => s.setPalette)
  const recents = listRecents()

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

  useEffect(() => wireFileEvents(onToast), [onToast])

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
              void confirmLoseWork().then((ok) => {
                if (ok) newProject()
              })
            }}
          >
            New reel
          </Item>
          <Item disabled={Boolean(analyzing) || exporting} onClick={() => void importMediaAction(onToast)}>
            Open media…
          </Item>
          <Item disabled={Boolean(analyzing) || exporting} onClick={() => void appendTakeAction(onToast)}>
            Add take…
          </Item>
          <Item onClick={() => void openTranscriptAction(onToast)}>Open transcript…</Item>
          <Item onClick={() => void importTimelineAction(onToast)}>Import timeline…</Item>
          <Item onClick={() => void openProjectAction(onToast)}>Open project…</Item>
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
          <Item disabled={ffmpegImportBusy(analyzing)} onClick={onExport}>
            Export…
          </Item>
          <Item onClick={() => openPreferences()}>Preferences…</Item>
          <Item
            onClick={() => {
              void confirmLoseWork().then((ok) => {
                if (ok) loadDemo()
              })
            }}
          >
            Studio demo
          </Item>
          {recents.length > 0 && (
            <>
              <span className="menu-label">Recent</span>
              {recents.map((recent) => (
                <Item key={recent.path} onClick={() => void openRecentAction(recent.path, onToast)}>
                  {recent.name}
                </Item>
              ))}
            </>
          )}
        </Menu>
        <Menu label="Edit">
          <Item disabled={!past} onClick={undo}>
            Undo ⌘Z
          </Item>
          <Item disabled={!future} onClick={redo}>
            Redo ⌘⇧Z
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
          <Item onClick={() => playInOutOrSelection()}>Play marked range or selection</Item>
          <Item onClick={() => selectParagraphAtCaret()}>Select paragraph</Item>
          <Item onClick={() => dispatch({ type: ripple ? 'rippleDeleteMarks' : 'liftMarks' })}>
            {ripple ? 'Cut marked range' : 'Lift marked range'}
          </Item>
          <Item
            onClick={() =>
              dispatch({ type: 'insertGap', time: usePlayback.getState().programTime, duration: 1 })
            }
          >
            Insert 1s hold
          </Item>
          <Item onClick={() => dispatch({ type: 'setMarks', markIn: null, markOut: null })}>
            Clear In and Out
          </Item>
          <Item
            onClick={() => {
              const source = programToSourceOf(project, usePlayback.getState().programTime)
              const word = project.transcript.words.find((w) => source >= w.start && source <= w.end)
              dispatch({
                type: 'addTag',
                start: word?.start ?? source,
                end: word?.end ?? source + 1,
                kind: 'note',
                label: 'Note'
              })
              onToast('Note at the playhead.')
            }}
          >
            Note at playhead
          </Item>
          <Item
            onClick={() => {
              const note = hopNote(project, programToSourceOf(project, usePlayback.getState().programTime), 1)
              if (note) usePlayback.getState().seekSource(note.start)
            }}
          >
            Next note
          </Item>
          <Item
            onClick={() => {
              const note = hopNote(project, programToSourceOf(project, usePlayback.getState().programTime), -1)
              if (note) usePlayback.getState().seekSource(note.start)
            }}
          >
            Previous note
          </Item>
          <Item
            onClick={() => {
              if (copySelectedClip('clip')) onToast('Copied clip. Paste at the playhead.')
            }}
          >
            Copy clip
          </Item>
          <Item
            onClick={() => {
              if (pasteClipboard('clip')) onToast('Pasted at the playhead.')
            }}
          >
            Paste clip at playhead
          </Item>
          {onShortcuts && <Item onClick={onShortcuts}>Keyboard shortcuts ?</Item>}
          <Item
            onClick={() =>
              dispatch({
                type: 'rippleTrimToPlayhead',
                edge: 'in',
                time: usePlayback.getState().programTime
              })
            }
          >
            Trim start to playhead (Q)
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
            Trim end to playhead (W)
          </Item>
        </Menu>
        <Menu label="Sequence">
          <Item
            onClick={() => {
              dispatch({
                type: 'addCaption',
                start: usePlayback.getState().programTime,
                duration: 3,
                text: 'Title'
              })
              onToast('Title on the tape — 3 seconds from here. Type in the inspector.')
            }}
          >
            Add title (3s at playhead)
          </Item>
          <Item
            onClick={() => {
              dispatch({
                type: 'addZoom',
                start: usePlayback.getState().programTime,
                duration: 3,
                scale: 1.45
              })
              onToast('Zoom on the picture — 3 seconds from here. Scale is in Transform.')
            }}
          >
            Add zoom (3s at playhead)
          </Item>
          <Item
            onClick={() => {
              dispatch({
                type: 'addTitle',
                start: usePlayback.getState().programTime,
                duration: 3,
                text: 'Lower third',
                preset: 'lower-third'
              })
              onToast('Lower third on the tape — 3 seconds from here. Type in the inspector.')
            }}
          >
            Add lower third (3s at playhead)
          </Item>
          <Item
            onClick={() => {
              dispatch({
                type: 'generateCaptions',
                maxWords: 5,
                speakerPrefix: project.transcript.speakers.length > 1,
                emphasize: true
              })
              onToast('Captions from the live words. Edit any block on the tape.')
            }}
          >
            Caption remaining words
          </Item>
          <Item
            onClick={() => {
              dispatch({ type: 'addLowerThirds' })
              onToast('Chapter titles on the tape. Edit text in the inspector.')
            }}
          >
            Scene lower thirds
          </Item>
          <Item disabled={ffmpegImportBusy(analyzing) || exporting} onClick={() => void addPickedOverlay('broll')}>
            Add B-roll…
          </Item>
          <Item disabled={ffmpegImportBusy(analyzing) || exporting} onClick={() => void addPickedOverlay('audio')}>
            Add music bed…
          </Item>
          <Item
            onClick={() => {
              dispatch({
                type: 'addRedaction',
                start: usePlayback.getState().programTime,
                duration: 4
              })
              onToast('Blur on the picture — 4 seconds from here. Drag to cover a face.')
            }}
          >
            Add redaction (4s at playhead)
          </Item>
          <Item
            onClick={() => {
              dispatch({
                type: 'dissolveAtPlayhead',
                time: usePlayback.getState().programTime,
                duration: 0.4
              })
              onToast('Cross-dissolve at the playhead.')
            }}
          >
            Dissolve at playhead
          </Item>
          <Item onClick={() => dispatch({ type: 'addTrack', trackType: 'overlay' })}>
            Add overlay track
          </Item>
        </Menu>
        <Menu label="Auto Edit">
          <Item
            onClick={() => {
              useEditor.getState().setTool(useEditor.getState().tool === 'guard' ? 'select' : 'guard')
              onToast('Protecting — drag words in the transcript so Auto Edit skips them.')
            }}
          >
            Protect words
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
            Protect marked range
          </Item>
          <Item
            onClick={() => {
              const span = ioSource()
              if (span) dispatch({ type: 'addTag', ...span, kind: 'demo' })
            }}
          >
            Mark range as silent demo
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
            Tighten pauses in marked range
          </Item>
          <Item onClick={() => dispatch({ type: 'setAudioMaster', patch: { normalize: true } })}>
            Normalize to -16 LUFS
          </Item>
        </Menu>
      </nav>
      <div className="menubar-right">
        <span
          className="status-pill"
          data-dirty={dirty || !documentPath || undefined}
          data-clickable={Boolean(analyzing || dirty || !documentPath) || undefined}
          title={
            analyzing
              ? 'Cancel import'
              : dirty || !documentPath
                ? 'Save this reel'
                : documentPath
          }
          onClick={() => {
            if (analyzing) {
              void cancelImport()
              return
            }
            if (!dirty && documentPath) return
            void saveCurrentDocument().then(
              (path) => {
                if (path) onToast(isElectron ? `Saved ${currentDocumentTitle()}.` : `Downloaded ${path}`)
              },
              (err: unknown) => onToast(err instanceof Error ? err.message : 'Save failed.')
            )
          }}
        >
          {analyzing
            ? `Analyze · ${analyzing}`
            : dirty || !documentPath
              ? 'Unsaved'
              : 'Saved'}{' '}
          · {documentPath ? currentDocumentTitle() : project.name} · {project.fps} fps · {project.width}×
          {project.height}
        </span>
        <button
          className="export-btn"
          onClick={exporting ? () => void cancelExport() : onExport}
          disabled={ffmpegImportBusy(analyzing) && !exporting}
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
