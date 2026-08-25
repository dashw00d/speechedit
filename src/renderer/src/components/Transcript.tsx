import { useRef, useState } from 'react'
import { parseAnyTranscript, isFillerToken } from '../lib/transcript'
import { currentWord } from '../lib/edl'
import { commandForScene, suggestionForScene, takeFamily } from '../lib/sceneAnalysis'
import { programToSourceOf } from '../lib/resolver'
import { extendSelection, paragraphIds, sentenceIds, tagAt, wordRange } from '../lib/transcriptEdit'
import { useEditor, usePlayback } from '../store'
import type { TagKind } from '../types'

export function Transcript() {
  const project = useEditor((s) => s.project)
  const selected = useEditor((s) => s.selectedWordIds)
  const selectWords = useEditor((s) => s.selectWords)
  const dispatch = useEditor((s) => s.dispatch)
  const loadTranscript = useEditor((s) => s.loadTranscript)
  const programTime = usePlayback((s) => s.programTime)
  const sourceTime = programToSourceOf(project, programTime)
  const seekSource = usePlayback((s) => s.seekSource)
  const active = currentWord(project.transcript.words, sourceTime)
  const [editing, setEditing] = useState<string | null>(null)
  const [paintIds, setPaintIds] = useState<string[] | null>(null)
  const dragMoved = useRef(false)
  const tool = useEditor((s) => s.tool)
  const guardKind = useEditor((s) => s.guardKind)
  const setTool = useEditor((s) => s.setTool)
  const words = project.transcript.words
  const range = wordRange(words, selected)

  function tagKind(kind: TagKind) {
    const span =
      range ??
      (project.markIn != null && project.markOut != null
        ? {
            start: programToSourceOf(project, Math.min(project.markIn, project.markOut)),
            end: programToSourceOf(project, Math.max(project.markIn, project.markOut))
          }
        : null)
    if (!span) return
    dispatch({ type: 'addTag', start: span.start, end: span.end, kind })
  }

  return (
    <section
      className="panel transcript"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault()
        const file = e.dataTransfer.files[0]
        if (!file) return
        try {
          loadTranscript(parseAnyTranscript(file.name, await file.text()))
        } catch (err) {
          console.error(err)
        }
      }}
    >
      <div className="panel-head">
        Transcript
        <div className="speakers">
          {project.transcript.speakers.map((s) => (
            <button
              className="speaker"
              key={s.id}
              title={selected.length ? `Assign ${s.name}` : `Select ${s.name}`}
              onClick={() => {
                if (selected.length) {
                  dispatch({ type: 'setSpeaker', wordIds: selected, speakerId: s.id })
                  return
                }
                selectWords(words.filter((w) => w.speaker === s.id).map((w) => w.id))
              }}
              onDoubleClick={(e) => {
                e.preventDefault()
                const name = window.prompt('Speaker name', s.name)
                if (name?.trim()) dispatch({ type: 'renameSpeaker', speakerId: s.id, name: name.trim() })
              }}
            >
              <i className="swatch" style={{ background: s.color }} />
              {s.name}
            </button>
          ))}
          <button className="speaker add" onClick={() => dispatch({ type: 'addSpeaker' })}>
            + speaker
          </button>
        </div>
      </div>
      {words.length > 0 && (
        <div className="script-tools">
          <button className="chip" disabled={!selected.length} onClick={() => dispatch({ type: 'toggleWords', wordIds: selected })}>
            Cut
          </button>
          <button
            className="chip"
            disabled={!selected[0] && !active}
            onClick={() => {
              const id = selected[0] ?? active?.id
              if (id) dispatch({ type: 'cutSentence', wordId: id })
            }}
          >
            Cut sentence
          </button>
          <button
            className="chip"
            disabled={!selected[0] && !active}
            onClick={() => {
              const id = selected[0] ?? active?.id
              if (id) dispatch({ type: 'cutPreviousSentence', wordId: id })
            }}
          >
            Cut false start
          </button>
          <button
            className="chip"
            disabled={!range}
            onClick={() => range && dispatch({ type: 'tightenRange', start: range.start, end: range.end })}
          >
            Tighten
          </button>
          <button
            className="chip"
            disabled={!range}
            onClick={() => range && dispatch({ type: 'restoreRange', start: range.start, end: range.end })}
          >
            Restore
          </button>
          <button className="chip" data-active={tool === 'guard'} onClick={() => setTool(tool === 'guard' ? 'select' : 'guard')}>
            Paint guard
          </button>
          <button className="chip" disabled={!range && (project.markIn == null || project.markOut == null)} onClick={() => tagKind('keep')}>
            Keep
          </button>
          <button className="chip" disabled={!range && (project.markIn == null || project.markOut == null)} onClick={() => tagKind('demo')}>
            Demo
          </button>
          {project.tags.map((tag) => (
            <button
              key={tag.id}
              className="chip tag-chip"
              data-kind={tag.kind}
              onClick={() => {
                seekSource(tag.start)
                dispatch({ type: 'removeTag', tagId: tag.id })
              }}
              title="Click to remove"
            >
              {tag.kind} ×
            </button>
          ))}
        </div>
      )}
      <div
        className="script"
        data-tool={tool}
        onMouseUp={() => {
          if (!paintIds?.length) {
            setPaintIds(null)
            return
          }
          if (tool === 'guard') {
            const span = wordRange(words, paintIds)
            if (span) {
              dispatch({
                type: 'addTag',
                start: span.start,
                end: span.end,
                kind: guardKind
              })
              selectWords(paintIds)
            }
          } else {
            selectWords(paintIds)
          }
          setPaintIds(null)
        }}
        onMouseLeave={() => {
          if (paintIds) setPaintIds(null)
          dragMoved.current = false
        }}
      >
        {words.length === 0 && (
          <p className="script-hint">
            Open a recording. SpeechEdit analyzes silence, motion, and loudness, then builds a
            transcript — Whisper if you have it, speech islands if you don’t. Drop SRT, VTT, or JSON
            anytime.
          </p>
        )}
        {words.map((word, i) => {
          const prev = words[i - 1]
          const gap = prev ? word.start - prev.end : 0
          const tag = tagAt(project.tags, word.start)
          const gapCut = project.cuts.some(
            (c) => prev && c.start <= prev.end + 0.05 && c.end >= word.start - 0.05
          )
          const scene = (project.scenes ?? []).find((s) => word.start >= s.start && word.start < s.end)
          const sceneStart = scene && (!prev || prev.start < scene.start)
          const applied = project.suggestions.find(
            (s) => s.applied && word.deleted && word.start >= s.start && word.end <= s.end + 0.02
          )
          return (
            <span key={word.id}>
              {sceneStart && scene && (
                <span className="scene-chip-row">
                  <button
                    className="scene-chip"
                    data-kind={scene.kind}
                    title={scene.summary}
                    onClick={() => seekSource(scene.start)}
                  >
                    {scene.takeIndex ? `Take ${scene.takeIndex} · ` : ''}
                    {scene.title}
                    {scene.kind === 'retake' ? ' · retake' : ''}
                  </button>
                  {scene.kind === 'retake' || takeFamily(project.scenes, scene.id).length > 1 ? (
                    suggestionForScene(project, scene)?.applied ? (
                      <button
                        className="chip"
                        onClick={() => dispatch(commandForScene(project, scene, 'revert'))}
                      >
                        Put back
                      </button>
                    ) : scene.kind === 'retake' ? (
                      <button
                        className="chip"
                        onClick={() => dispatch(commandForScene(project, scene, 'apply'))}
                      >
                        Drop take
                      </button>
                    ) : (
                      <button className="chip" onClick={() => dispatch({ type: 'keepTake', sceneId: scene.id })}>
                        Keep this take
                      </button>
                    )
                  ) : null}
                </span>
              )}
              {gap > 0.45 && prev && (
                <button
                  className="gap-chip"
                  data-cut={gapCut}
                  data-tag={tagAt(project.tags, (prev.end + word.start) / 2)?.kind ?? ''}
                  title={
                    gapCut
                      ? 'Double-click to put this air back — reverts that auto-edit if it has one'
                      : 'Double-click to cut this air'
                  }
                  onClick={() => seekSource(prev.end)}
                  onDoubleClick={(e) => {
                    e.preventDefault()
                    dispatch(
                      gapCut
                        ? { type: 'revertAt', start: prev.end, end: word.start }
                        : { type: 'deleteRange', start: prev.end, end: word.start, source: 'transcript' }
                    )
                  }}
                >
                  {gap.toFixed(1)}s
                </button>
              )}
              {gap > 1.2 && <span className="para-gap" />}
              {editing === word.id ? (
                <input
                  className="word-edit"
                  autoFocus
                  defaultValue={word.text}
                  onBlur={(e) => {
                    dispatch({ type: 'setWordText', wordId: word.id, text: e.target.value })
                    setEditing(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                <button
                  className="word"
                  data-on={active?.id === word.id}
                  data-sel={selected.includes(word.id)}
                  data-deleted={word.deleted}
                  data-filler={isFillerToken(word.text)}
                  data-tag={tag?.kind ?? ''}
                  data-sug={applied?.type ?? ''}
                  data-paint={paintIds?.includes(word.id) ?? false}
                  style={{ ['--spk' as string]: project.transcript.speakers.find((s) => s.id === word.speaker)?.color ?? '#C4452D' }}
                  onMouseDown={(e) => {
                    if (editing) return
                    if (e.button !== 0) return
                    e.preventDefault()
                    dragMoved.current = false
                    setPaintIds([word.id])
                  }}
                  onMouseEnter={() => {
                    if (!paintIds) return
                    const start = words.findIndex((w) => w.id === paintIds[0])
                    if (start < 0) return
                    const [lo, hi] = start <= i ? [start, i] : [i, start]
                    const next = words.slice(lo, hi + 1).map((w) => w.id)
                    if (next.length > 1) dragMoved.current = true
                    setPaintIds(next)
                  }}
                  onClick={(e) => {
                    if (tool === 'guard') return
                    if (dragMoved.current) {
                      dragMoved.current = false
                      return
                    }
                    seekSource(word.start)
                    if (e.shiftKey && selected.length) {
                      const anchor = words.findIndex((w) => w.id === selected[0])
                      const [lo, hi] = anchor <= i ? [anchor, i] : [i, anchor]
                      selectWords(words.slice(lo, hi + 1).map((w) => w.id))
                      return
                    }
                    if (e.shiftKey && (e.altKey || e.metaKey || e.ctrlKey)) {
                      selectWords(paragraphIds(words, i))
                      return
                    }
                    if (e.altKey || e.metaKey) {
                      selectWords(sentenceIds(words, i))
                      return
                    }
                    selectWords([word.id])
                  }}
                  onDoubleClick={() => {
                    if (applied) {
                      dispatch({ type: 'revertSuggestion', suggestionId: applied.id })
                      return
                    }
                    dispatch({ type: 'toggleWords', wordIds: [word.id] })
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setEditing(word.id)
                  }}
                >
                  {word.text}
                </button>
              )}{' '}
            </span>
          )
        })}
        {words.length > 0 && (
          <p className="script-hint">
            Drag words to select. M marks them, / loops I/O. . cuts this sentence, , cuts the false start, T tightens gaps.
            Double-click a struck auto-edit to put just that cut back. Shift+Alt-click a paragraph.
            G paints a keep/demo guard. Double-click a word or gap chip to cut or restore. X cuts, U puts back.
          </p>
        )}
      </div>
    </section>
  )
}

export { extendSelection, wordRange }
