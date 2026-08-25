import { useMemo, useState } from 'react'
import { withGeneratedCaptions } from '../lib/captions'
import { programToSourceOf } from '../lib/resolver'
import { useEditor, usePlayback } from '../store'

export function Palette() {
  const open = useEditor((s) => s.palette)
  const setPalette = useEditor((s) => s.setPalette)
  const dispatch = useEditor((s) => s.dispatch)
  const [q, setQ] = useState('')

  const actions = useMemo(
    () => [
      {
        name: 'Paint guards',
        run: () => useEditor.getState().setTool(useEditor.getState().tool === 'guard' ? 'select' : 'guard')
      },
      {
        name: 'Apply safe edits',
        run: () => dispatch({ type: 'applySafeSuggestions' })
      },
      {
        name: 'Rebuild suggestions',
        run: () => dispatch({ type: 'rebuildSuggestions' })
      },
      {
        name: 'Rebuild intelligence',
        run: () => dispatch({ type: 'rebuildIntelligence' })
      },
      {
        name: 'Local scene pass',
        run: () => dispatch({ type: 'inferScenes' })
      },
      {
        name: 'Collapse retakes',
        run: () => dispatch({ type: 'collapseRetakes' })
      },
      {
        name: 'Ask model to edit…',
        run: () => {
          const intent = window.prompt('What should SpeechEdit do?')
          if (!intent) return
          void import('../lib/askModel').then(async ({ askEditor }) => {
            const result = await askEditor(useEditor.getState().project, intent)
            dispatch({ type: 'replaceProject', project: result.project })
          })
        }
      },
      {
        name: 'Find scenes and retakes',
        run: () => {
          void import('../lib/askModel').then(async ({ askEditor }) => {
            const result = await askEditor(
              useEditor.getState().project,
              'Group scenes and mark retakes. Do not cut yet.'
            )
            dispatch({ type: 'replaceProject', project: result.project })
          })
        }
      },
      {
        name: 'Cut this sentence',
        run: () => {
          const id = useEditor.getState().selectedWordIds[0]
          if (id) dispatch({ type: 'cutSentence', wordId: id })
        }
      },
      {
        name: 'Cut previous sentence',
        run: () => {
          const id = useEditor.getState().selectedWordIds[0]
          if (id) dispatch({ type: 'cutPreviousSentence', wordId: id })
        }
      },
      {
        name: 'Tighten selection',
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
      { name: 'Add speaker', run: () => dispatch({ type: 'addSpeaker' }) },
      { name: 'Undo', run: () => useEditor.getState().undo() },
      { name: 'Redo', run: () => useEditor.getState().redo() },
      {
        name: 'Razor at playhead',
        run: () =>
          dispatch({
            type: 'splitAt',
            time: programToSourceOf(useEditor.getState().project, usePlayback.getState().programTime)
          })
      },
      {
        name: 'Ripple delete I/O',
        run: () => dispatch({ type: 'rippleDeleteMarks' })
      },
      {
        name: 'Add title',
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
        run: () =>
          dispatch({
            type: 'replaceProject',
            project: withGeneratedCaptions(useEditor.getState().project)
          })
      },
      {
        name: 'Fade in 0.4s',
        run: () => {
          const id = useEditor.getState().selectedClipId
          if (id) dispatch({ type: 'setFade', targetId: id, edge: 'in', duration: 0.4 })
        }
      },
      {
        name: 'Fade out 0.4s',
        run: () => {
          const id = useEditor.getState().selectedClipId
          if (id) dispatch({ type: 'setFade', targetId: id, edge: 'out', duration: 0.4 })
        }
      },
      {
        name: 'Add redaction',
        run: () =>
          dispatch({
            type: 'addRedaction',
            start: usePlayback.getState().programTime,
            duration: 4
          })
      },
      {
        name: 'Dissolve at playhead',
        run: () =>
          dispatch({
            type: 'dissolveAtPlayhead',
            time: usePlayback.getState().programTime,
            duration: 0.4
          })
      },
      {
        name: 'Add overlay track',
        run: () => dispatch({ type: 'addTrack', trackType: 'overlay' })
      },
      {
        name: 'Add music track',
        run: () => dispatch({ type: 'addTrack', trackType: 'audio' })
      },
      {
        name: 'Tag selection as keep',
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
        name: 'Tag selection as silent demo',
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
        run: () => dispatch({ type: 'revertSuggestionType', suggestionType: 'silence' })
      },
      {
        name: 'Put back fillers',
        run: () => dispatch({ type: 'revertSuggestionType', suggestionType: 'filler' })
      },
      {
        name: 'Put back retakes',
        run: () => dispatch({ type: 'revertSuggestionType', suggestionType: 'repeat' })
      },
      {
        name: 'Normalize to -16 LUFS',
        run: () => dispatch({ type: 'setAudioMaster', patch: { normalize: true } })
      },
      { name: 'Load studio demo', run: () => useEditor.getState().loadDemo() },
      { name: 'New reel', run: () => useEditor.getState().newProject() }
    ],
    [dispatch]
  )

  const shown = actions.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()))
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
