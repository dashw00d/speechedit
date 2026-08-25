import { useMemo, useState } from 'react'
import { confirmLoseWork, saveCurrentDocument } from '../lib/documentIo'
import { listRecents } from '../lib/recents'
import { openRecentAction } from '../lib/fileActions'
import { rankPalette, type PaletteSpec } from '../lib/contextActions'
import { paletteSearchHits } from '../lib/paletteSearch'
import { cancelExport, cancelImport } from '../lib/mediaJobs'
import { bladeAtWord, playInOutOrSelection, selectParagraphAtCaret } from '../lib/scriptActions'
import { programToSourceOf } from '../lib/resolver'
import { exportSidecar, type SidecarId } from '../lib/exportActions'
import { readPaletteRecents, rememberPaletteCommand } from '../lib/paletteRecent'
import { copySelectedClip, pasteClipboard } from '../lib/clipClipboard'
import { hopNote } from '../lib/clipEdit'
import { applyTheme, openPreferences } from '../lib/theme'
import { useEditor, usePlayback } from '../store'

export function Palette({ onToast }: { onToast?: (msg: string) => void }) {
  const open = useEditor((s) => s.palette)
  const setPalette = useEditor((s) => s.setPalette)
  const dispatch = useEditor((s) => s.dispatch)
  const exporting = useEditor((s) => s.exporting)
  const analyzing = useEditor((s) => s.analyzing)
  const selectedWordIds = useEditor((s) => s.selectedWordIds)
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const project = useEditor((s) => s.project)
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
        name: 'Protect words',
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
        name: 'Keyboard shortcuts',
        group: 'file',
        run: () => window.dispatchEvent(new CustomEvent('speechedit:shortcuts'))
      },
      {
        name: 'Note at playhead',
        group: 'edit',
        run: () => {
          const project = useEditor.getState().project
          const source = programToSourceOf(project, usePlayback.getState().programTime)
          const word = project.transcript.words.find((w) => source >= w.start && source <= w.end)
          dispatch({
            type: 'addTag',
            start: word?.start ?? source,
            end: word?.end ?? source + 1,
            kind: 'note',
            label: 'Note'
          })
        }
      },
      {
        name: 'Dismiss pending suggestions',
        group: 'edit',
        run: () => dispatch({ type: 'dismissPendingSuggestions' })
      },
      {
        name: 'Cut all fillers',
        group: 'edit',
        run: () => dispatch({ type: 'applySuggestionsByType', suggestionType: 'filler' })
      },
      {
        name: 'Duplicate selected clip',
        group: 'selection',
        run: () => {
          const id = useEditor.getState().selectedClipId
          if (id) dispatch({ type: 'duplicateClip', clipId: id })
        }
      },
      {
        name: 'Copy clip',
        group: 'selection',
        run: () => void copySelectedClip('clip')
      },
      {
        name: 'Paste clip at playhead',
        group: 'selection',
        run: () => void pasteClipboard('clip')
      },
      {
        name: 'Paste clip look',
        group: 'selection',
        run: () => void pasteClipboard('look')
      },
      {
        name: 'Next note',
        group: 'edit',
        run: () => {
          const editor = useEditor.getState()
          const note = hopNote(editor.project, programToSourceOf(editor.project, usePlayback.getState().programTime), 1)
          if (note) usePlayback.getState().seekSource(note.start)
        }
      },
      {
        name: 'Previous note',
        group: 'edit',
        run: () => {
          const editor = useEditor.getState()
          const note = hopNote(editor.project, programToSourceOf(editor.project, usePlayback.getState().programTime), -1)
          if (note) usePlayback.getState().seekSource(note.start)
        }
      },
      {
        name: 'Select all clips on track',
        group: 'selection',
        run: () => {
          const editor = useEditor.getState()
          const clip = editor.project.tracks.flatMap((t) => t.clips).find((c) => c.id === editor.selectedClipId)
          const track = editor.project.tracks.find((t) => t.clips.some((c) => c.id === editor.selectedClipId))
          if (track && clip) editor.selectClips(track.clips.map((c) => c.id))
        }
      },
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
      { name: 'Play marked range or selection', group: 'selection', run: () => playInOutOrSelection() },
      { name: 'Select paragraph', group: 'selection', run: () => selectParagraphAtCaret() },
      { name: 'Fit timeline', group: 'edit', run: () => usePlayback.getState().fitTimeline() },
      {
        name: 'Cut marked range',
        group: 'edit',
        run: () => dispatch({ type: useEditor.getState().ripple ? 'rippleDeleteMarks' : 'liftMarks' })
      },
      { name: 'Lift marked range', group: 'edit', run: () => dispatch({ type: 'liftMarks' }) },
      {
        name: 'Insert 1s hold',
        group: 'edit',
        run: () => dispatch({ type: 'insertGap', time: usePlayback.getState().programTime, duration: 1 })
      },
      {
        name: 'Match frame',
        group: 'edit',
        run: () => {
          const project = useEditor.getState().project
          const source = programToSourceOf(project, usePlayback.getState().programTime)
          const word = project.transcript.words.find((w) => source >= w.start && source <= w.end)
          if (word) {
            useEditor.getState().selectWords([word.id])
            useEditor.getState().setFollowPlayhead(true)
          }
        }
      },
      {
        name: 'Clear In and Out',
        group: 'edit',
        run: () => dispatch({ type: 'setMarks', markIn: null, markOut: null })
      },
      {
        name: 'Tighten pauses in marked range',
        group: 'edit',
        run: () => {
          const project = useEditor.getState().project
          if (project.markIn == null || project.markOut == null) return
          const start = Math.min(project.markIn, project.markOut)
          const end = Math.max(project.markIn, project.markOut)
          dispatch({
            type: 'tightenRange',
            start: programToSourceOf(project, start),
            end: programToSourceOf(project, end)
          })
        }
      },
      {
        name: 'Trim start to playhead',
        group: 'edit',
        run: () =>
          dispatch({
            type: 'rippleTrimToPlayhead',
            edge: 'in',
            time: usePlayback.getState().programTime
          })
      },
      {
        name: 'Trim end to playhead',
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
        name: 'Export…',
        group: 'export',
        run: () => window.dispatchEvent(new CustomEvent('speechedit:export'))
      },
      ...(
        [
          ['srt', 'Export captions SRT'],
          ['vtt', 'Export captions VTT'],
          ['md', 'Export transcript Markdown'],
          ['txt', 'Export transcript TXT'],
          ['chapters', 'Export chapters JSON'],
          ['otio', 'Export OTIO'],
          ['fcpxml', 'Export FCPXML'],
          ['premiere', 'Export Premiere XML'],
          ['autoeditor', 'Export Auto-Editor JSON'],
          ['mlt', 'Export Shotcut MLT'],
          ['kdenlive', 'Export Kdenlive']
        ] as const
      ).map(([id, name]) => ({
        name,
        group: 'export' as const,
        run: () => void exportSidecar(id as SidecarId, onToast ?? (() => undefined))
      })),
      {
        name: 'Preferences…',
        group: 'file',
        run: () => openPreferences()
      },
      {
        name: 'Use Dashwood theme',
        group: 'file',
        run: () => applyTheme('dashwood')
      },
      {
        name: 'Use Party theme',
        group: 'file',
        run: () => applyTheme('party')
      },
      { name: 'Save', group: 'file', run: () => void saveCurrentDocument() },
      { name: 'Save As…', group: 'file', run: () => void saveCurrentDocument({ saveAs: true }) },
      {
        name: 'Open media…',
        group: 'file',
        run: () => window.dispatchEvent(new CustomEvent('speechedit:open-media'))
      },
      {
        name: 'Add take…',
        group: 'file',
        run: () => window.dispatchEvent(new CustomEvent('speechedit:add-take'))
      },
      {
        name: 'Open project…',
        group: 'file',
        run: () => window.dispatchEvent(new CustomEvent('speechedit:open-project'))
      },
      {
        name: 'Open transcript…',
        group: 'file',
        run: () => window.dispatchEvent(new CustomEvent('speechedit:open-transcript'))
      },
      ...listRecents().map((recent) => ({
        name: `Open recent · ${recent.name}`,
        group: 'file' as const,
        run: () => void openRecentAction(recent.path, onToast ?? (() => undefined))
      })),
      {
        name: 'Load studio demo',
        group: 'file',
        run: () => {
          void confirmLoseWork().then((ok) => {
            if (ok) useEditor.getState().loadDemo()
          })
        }
      },
      {
        name: 'New reel',
        group: 'file',
        run: () => {
          void confirmLoseWork().then((ok) => {
            if (ok) useEditor.getState().newProject()
          })
        }
      }
    ],
    [dispatch, onToast]
  )

  const ranked = rankPalette([...actions, ...paletteSearchHits(project, q)], q, {
    exporting,
    analyzing: analyzing,
    hasWordSelection: selectedWordIds.length > 0,
    hasClip: Boolean(selectedClipId),
    empty: project.transcript.words.length === 0
  })
  const recents = !q.trim()
    ? readPaletteRecents()
        .map((name) => ranked.find((action) => action.name === name) ?? actions.find((action) => action.name === name))
        .filter((action): action is (typeof actions)[number] => Boolean(action))
    : []
  const shown = recents.length
    ? [...recents, ...ranked.filter((action) => !recents.some((recent) => recent.name === action.name))]
    : ranked

  function runAction(action: (typeof shown)[number]) {
    rememberPaletteCommand(action.name)
    action.run()
    setPalette(false)
  }

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
              runAction(shown[0])
            }
          }}
        />
        {shown.map((action) => (
          <button key={action.name} onClick={() => runAction(action)}>
            {recents.some((recent) => recent.name === action.name) ? `Recent · ${action.name}` : action.name}
          </button>
        ))}
      </div>
    </div>
  )
}
