import type { ReactNode } from 'react'
import { host, isElectron } from '../host'
import { importRecording } from '../lib/importMedia'
import {
  applyInterchange,
  downloadText,
  pickInterchange,
  projectToAutoEditor,
  projectToChapters,
  projectToFcpxml,
  projectToKdenlive,
  projectToMlt,
  projectToOtio,
  projectToPremiere,
  projectToSrt,
  projectToTranscriptMd,
  projectToTranscriptTxt,
  projectToVtt
} from '../lib/interchange'
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
    if (!confirmLoseWork()) return
    const file = await host.openMedia()
    if (!file) {
      onToast(isElectron ? 'No file selected.' : 'Open this in Electron to import media.')
      return
    }
    try {
      const next = await importRecording(file, (stage) => {
        setAnalyzing(stage)
        onToast(`Analyzing · ${stage}`)
      })
      loadProject(next, { path: null, clean: false })
      onToast(
        `${next.name} · ${next.suggestions.length} suggestions · ${next.transcript.words.length} words`
      )
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setAnalyzing(null)
    }
  }

  async function exportInterchange(kind: string, body: string, filename: string) {
    if (isElectron) {
      const path = await host.chooseTextExport(filename)
      if (!path) return
      await host.writeText(path, body)
      onToast(`Wrote ${kind.toUpperCase()}.`)
      return
    }
    downloadText(filename, body)
    onToast(`Downloaded ${filename}`)
  }

  async function openTranscript() {
    try {
      const result = await host.openTranscript()
      if (!result) return
      useEditor.getState().loadTranscript(parseAnyTranscript(result.name, result.text))
      onToast('Transcript loaded.')
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
          <Item onClick={() => void importMedia()}>Open media…</Item>
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
          <Item
            onClick={async () => {
              const asset = await pickBroll()
              if (!asset) return
              dispatch({
                type: 'addBroll',
                start: usePlayback.getState().programTime,
                duration: Math.min(6, asset.duration || 6),
                asset
              })
              onToast(`B-roll · ${asset.name}`)
            }}
          >
            Add B-roll…
          </Item>
          <Item
            onClick={async () => {
              const asset = await pickAudio()
              if (!asset) return
              dispatch({
                type: 'addAudio',
                start: usePlayback.getState().programTime,
                duration: Math.min(asset.duration || 8, programLength(project) || asset.duration || 8),
                asset
              })
              onToast(`Music · ${asset.name}`)
            }}
          >
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
          <Item onClick={onExport}>Program MP4…</Item>
          <Item onClick={() => void exportInterchange('srt', projectToSrt(project), `${project.name}.srt`)}>
            Captions SRT
          </Item>
          <Item onClick={() => void exportInterchange('vtt', projectToVtt(project), `${project.name}.vtt`)}>
            Captions VTT
          </Item>
          <Item
            onClick={() =>
              void exportInterchange('transcript', projectToTranscriptMd(project), `${project.name}.md`)
            }
          >
            Transcript Markdown
          </Item>
          <Item
            onClick={() =>
              void exportInterchange('transcript', projectToTranscriptTxt(project), `${project.name}.txt`)
            }
          >
            Transcript TXT
          </Item>
          <Item
            onClick={() =>
              void exportInterchange('chapters', projectToChapters(project), `${project.name}.chapters.json`)
            }
          >
            Chapters JSON
          </Item>
          <Item onClick={() => void exportInterchange('otio', projectToOtio(project), `${project.name}.otio`)}>
            OpenTimelineIO
          </Item>
          <Item
            onClick={() => void exportInterchange('fcpxml', projectToFcpxml(project), `${project.name}.fcpxml`)}
          >
            FCPXML
          </Item>
          <Item
            onClick={() => void exportInterchange('premiere', projectToPremiere(project), `${project.name}.xml`)}
          >
            Premiere XML
          </Item>
          <Item
            onClick={() =>
              void exportInterchange('auto-editor', projectToAutoEditor(project), `${project.name}.autoeditor.json`)
            }
          >
            Auto-Editor JSON
          </Item>
          <Item
            onClick={() => void exportInterchange('mlt', projectToMlt(project), `${project.name}.mlt`)}
          >
            Shotcut MLT
          </Item>
          <Item
            onClick={() =>
              void exportInterchange('kdenlive', projectToKdenlive(project), `${project.name}.kdenlive`)
            }
          >
            Kdenlive
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
        <span className="status-pill" data-dirty={dirty || undefined}>
          {analyzing
            ? `Analyze · ${analyzing}`
            : dirty
              ? 'Unsaved'
              : 'Saved'}{' '}
          · {documentPath ? currentDocumentTitle() : project.name} · {project.fps} fps · {project.width}×
          {project.height}
        </span>
        <button className="export-btn" onClick={onExport} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export'}
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
