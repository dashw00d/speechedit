import { useMemo, useState } from 'react'
import { confirmLoseWork, saveCurrentDocument } from '../lib/documentIo'
import { rankPalette, type PaletteSpec } from '../lib/contextActions'
import {
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
import { cancelExport, cancelImport } from '../lib/mediaJobs'
import { bladeAtWord, playInOutOrSelection, selectParagraphAtCaret } from '../lib/scriptActions'
import { programToSourceOf } from '../lib/resolver'
import { saveTextExport } from '../lib/saveText'
import { useEditor, usePlayback } from '../store'

export function Palette() {
  const open = useEditor((s) => s.palette)
  const setPalette = useEditor((s) => s.setPalette)
  const dispatch = useEditor((s) => s.dispatch)
  const exporting = useEditor((s) => s.exporting)
  const analyzing = useEditor((s) => s.analyzing)
  const selectedWordIds = useEditor((s) => s.selectedWordIds)
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const [q, setQ] = useState('')

  const actions = useMemo<PaletteSpec[]>(
    () => [
      { name: 'Cancel export', group: 'job', run: () => void cancelExport() },
      { name: 'Cancel import', group: 'job', run: () => void cancelImport() },
      {
        name: 'Cut selection',
        group: 'selection',
        run: () => {
          const ids = useEditor.getState().selectedWordIds
          if (ids.length) dispatch({ type: 'toggleWords', wordIds: ids })
        }
      },
      {
        name: 'Protect selection',
        group: 'selection',
        run: () => {
          const project = useEditor.getState().project
          const words = project.transcript.words.filter((w) =>
            useEditor.getState().selectedWordIds.includes(w.id)
          )
          if (!words.length) return
          dispatch({
            type: 'addTag',
            start: Math.min(...words.map((w) => w.start)),
            end: Math.max(...words.map((w) => w.end)),
            kind: 'keep'
          })
        }
      },
      {
        name: 'Make selection shorter',
        group: 'selection',
        run: () => {
          const project = useEditor.getState().project
          const words = project.transcript.words.filter((w) =>
            useEditor.getState().selectedWordIds.includes(w.id)
          )
          if (!words.length) return
          dispatch({
            type: 'tightenRange',
            start: Math.min(...words.map((w) => w.start)),
            end: Math.max(...words.map((w) => w.end))
          })
        }
      },
      {
        name: 'Paint guards',
        group: 'edit',
        run: () => useEditor.getState().setTool(useEditor.getState().tool === 'guard' ? 'select' : 'guard')
      },
      {
        name: 'Apply safe edits',
        group: 'edit',
        run: () => dispatch({ type: 'applySafeSuggestions' })
      },
      {
        name: 'Rebuild suggestions',
        group: 'edit',
        run: () => dispatch({ type: 'rebuildSuggestions' })
      },
      {
        name: 'Rebuild intelligence',
        group: 'edit',
        run: () => dispatch({ type: 'rebuildIntelligence' })
      },
      {
        name: 'Open agent (⌘J)',
        group: 'edit',
        run: () => useEditor.getState().setAgentOpen(true)
      },
      {
        name: 'Find scenes and retakes',
        group: 'edit',
        run: () => {
          void import('../lib/askModel').then(async ({ askEditor }) => {
            const result = await askEditor(
              useEditor.getState().project,
              'Find scenes and mark retakes. Do not cut yet.'
            )
            dispatch({ type: 'replaceProject', project: result.project })
          })
        }
      },
      { name: 'Local scene pass', group: 'edit', run: () => dispatch({ type: 'inferScenes' }) },
      { name: 'Collapse retakes', group: 'edit', run: () => dispatch({ type: 'collapseRetakes' }) },
      { name: 'Apply model cuts', group: 'edit', run: () => dispatch({ type: 'applyModelSuggestions' }) },
      {
        name: 'Cut this sentence',
        group: 'selection',
        run: () => {
          const id = useEditor.getState().selectedWordIds[0]
          if (id) dispatch({ type: 'cutSentence', wordId: id })
        }
      },
      {
        name: 'Cut previous sentence',
        group: 'selection',
        run: () => {
          const id = useEditor.getState().selectedWordIds[0]
          if (id) dispatch({ type: 'cutPreviousSentence', wordId: id })
        }
      },
      { name: 'Add speaker', group: 'edit', run: () => dispatch({ type: 'addSpeaker' }) },
      { name: 'Undo', group: 'file', run: () => useEditor.getState().undo() },
      { name: 'Redo', group: 'file', run: () => useEditor.getState().redo() },
      {
        name: 'Razor at playhead',
        group: 'edit',
        run: () =>
          dispatch({
            type: 'splitAt',
            time: programToSourceOf(useEditor.getState().project, usePlayback.getState().programTime)
          })
      },
      { name: 'Blade at word', group: 'edit', run: () => bladeAtWord() },
      { name: 'Play I/O or selection', group: 'selection', run: () => playInOutOrSelection() },
      { name: 'Select paragraph', group: 'selection', run: () => selectParagraphAtCaret() },
      { name: 'Ripple delete I/O', group: 'edit', run: () => dispatch({ type: 'rippleDeleteMarks' }) },
      {
        name: 'Q ripple trim in to playhead',
        group: 'edit',
        run: () =>
          dispatch({
            type: 'rippleTrimToPlayhead',
            edge: 'in',
            time: usePlayback.getState().programTime
          })
      },
      {
        name: 'W ripple trim out to playhead',
        group: 'edit',
        run: () =>
          dispatch({
            type: 'rippleTrimToPlayhead',
            edge: 'out',
            time: usePlayback.getState().programTime
          })
      },
      {
        name: 'Add title',
        group: 'edit',
        run: () =>
          dispatch({
            type: 'addCaption',
            start: usePlayback.getState().programTime,
            duration: 3,
            text: 'Title'
          })
      },
      {
        name: 'Add zoom',
        group: 'edit',
        run: () =>
          dispatch({
            type: 'addZoom',
            start: usePlayback.getState().programTime,
            duration: 3,
            scale: 1.45
          })
      },
      {
        name: 'Caption remaining words',
        group: 'edit',
        run: () => dispatch({ type: 'generateCaptions', maxWords: 5, emphasize: true })
      },
      { name: 'Scene lower thirds', group: 'edit', run: () => dispatch({ type: 'addLowerThirds' }) },
      {
        name: 'Add lower third',
        group: 'edit',
        run: () =>
          dispatch({
            type: 'addTitle',
            start: usePlayback.getState().programTime,
            duration: 3,
            text: 'Lower third',
            preset: 'lower-third'
          })
      },
      {
        name: 'Fade in 0.4s',
        group: 'selection',
        run: () => {
          const id = useEditor.getState().selectedClipId
          if (id) dispatch({ type: 'setFade', targetId: id, edge: 'in', duration: 0.4 })
        }
      },
      {
        name: 'Fade out 0.4s',
        group: 'selection',
        run: () => {
          const id = useEditor.getState().selectedClipId
          if (id) dispatch({ type: 'setFade', targetId: id, edge: 'out', duration: 0.4 })
        }
      },
      {
        name: 'Add redaction',
        group: 'edit',
        run: () =>
          dispatch({
            type: 'addRedaction',
            start: usePlayback.getState().programTime,
            duration: 4
          })
      },
      {
        name: 'Dissolve at playhead',
        group: 'edit',
        run: () =>
          dispatch({
            type: 'dissolveAtPlayhead',
            time: usePlayback.getState().programTime,
            duration: 0.4
          })
      },
      { name: 'Add overlay track', group: 'edit', run: () => dispatch({ type: 'addTrack', trackType: 'overlay' }) },
      { name: 'Add music track', group: 'edit', run: () => dispatch({ type: 'addTrack', trackType: 'audio' }) },
      {
        name: 'Tag selection as silent demo',
        group: 'selection',
        run: () => {
          const project = useEditor.getState().project
          const words = project.transcript.words.filter((w) =>
            useEditor.getState().selectedWordIds.includes(w.id)
          )
          if (!words.length) return
          dispatch({
            type: 'addTag',
            start: Math.min(...words.map((w) => w.start)),
            end: Math.max(...words.map((w) => w.end)),
            kind: 'demo'
          })
        }
      },
      {
        name: 'Put back silence cuts',
        group: 'edit',
        run: () => dispatch({ type: 'revertSuggestionType', suggestionType: 'silence' })
      },
      {
        name: 'Put back fillers',
        group: 'edit',
        run: () => dispatch({ type: 'revertSuggestionType', suggestionType: 'filler' })
      },
      {
        name: 'Put back retakes',
        group: 'edit',
        run: () => dispatch({ type: 'revertSuggestionType', suggestionType: 'repeat' })
      },
      {
        name: 'Normalize to -16 LUFS',
        group: 'edit',
        run: () => dispatch({ type: 'setAudioMaster', patch: { normalize: true } })
      },
      {
        name: 'Export captions SRT',
        group: 'export',
        run: () => {
          const project = useEditor.getState().project
          void saveTextExport(`${project.name}.srt`, projectToSrt(project))
        }
      },
      {
        name: 'Export captions VTT',
        group: 'export',
        run: () => {
          const project = useEditor.getState().project
          void saveTextExport(`${project.name}.vtt`, projectToVtt(project))
        }
      },
      {
        name: 'Export transcript Markdown',
        group: 'export',
        run: () => {
          const project = useEditor.getState().project
          void saveTextExport(`${project.name}.md`, projectToTranscriptMd(project))
        }
      },
      {
        name: 'Export transcript TXT',
        group: 'export',
        run: () => {
          const project = useEditor.getState().project
          void saveTextExport(`${project.name}.txt`, projectToTranscriptTxt(project))
        }
      },
      {
        name: 'Export chapters JSON',
        group: 'export',
        run: () => {
          const project = useEditor.getState().project
          void saveTextExport(`${project.name}.chapters.json`, projectToChapters(project))
        }
      },
      {
        name: 'Export OTIO',
        group: 'export',
        run: () => {
          const project = useEditor.getState().project
          void saveTextExport(`${project.name}.otio`, projectToOtio(project))
        }
      },
      {
        name: 'Export FCPXML',
        group: 'export',
        run: () => {
          const project = useEditor.getState().project
          void saveTextExport(`${project.name}.fcpxml`, projectToFcpxml(project))
        }
      },
      {
        name: 'Export Premiere XML',
        group: 'export',
        run: () => {
          const project = useEditor.getState().project
          void saveTextExport(`${project.name}.xml`, projectToPremiere(project))
        }
      },
      {
        name: 'Export Auto-Editor JSON',
        group: 'export',
        run: () => {
          const project = useEditor.getState().project
          void saveTextExport(`${project.name}.autoeditor.json`, projectToAutoEditor(project))
        }
      },
      {
        name: 'Export Shotcut MLT',
        group: 'export',
        run: () => {
          const project = useEditor.getState().project
          void saveTextExport(`${project.name}.mlt`, projectToMlt(project))
        }
      },
      {
        name: 'Export Kdenlive',
        group: 'export',
        run: () => {
          const project = useEditor.getState().project
          void saveTextExport(`${project.name}.kdenlive`, projectToKdenlive(project))
        }
      },
      { name: 'Save', group: 'file', run: () => void saveCurrentDocument() },
      { name: 'Save As…', group: 'file', run: () => void saveCurrentDocument({ saveAs: true }) },
      {
        name: 'Load studio demo',
        group: 'file',
        run: () => {
          if (!confirmLoseWork()) return
          useEditor.getState().loadDemo()
        }
      },
      {
        name: 'New reel',
        group: 'file',
        run: () => {
          if (!confirmLoseWork()) return
          useEditor.getState().newProject()
        }
      }
    ],
    [dispatch]
  )

  const shown = rankPalette(actions, q, {
    exporting,
    analyzing: analyzing,
    hasWordSelection: selectedWordIds.length > 0,
    hasClip: Boolean(selectedClipId)
  })
  if (!open) return null

  return (
    <div className="palette-back" onClick={() => setPalette(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Command…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setPalette(false)
            if (e.key === 'Enter' && shown[0]) {
              shown[0].run()
              setPalette(false)
            }
          }}
        />
        {shown.map((action) => (
          <button
            key={action.name}
            onClick={() => {
              action.run()
              setPalette(false)
            }}
          >
            {action.name}
          </button>
        ))}
      </div>
    </div>
  )
}
