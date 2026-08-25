import { useRef, useState } from 'react'
import { appliedSuggestionAt } from '../lib/analysis'
import { parseAnyTranscript, isFillerToken } from '../lib/transcript'
import { currentWord } from '../lib/edl'
import { commandForScene, suggestionForScene, takeFamily } from '../lib/sceneAnalysis'
import { programToSourceOf } from '../lib/resolver'
import {
  appliedForWord,
  coveringAppliedSuggestion,
  extendSelection,
  PARAGRAPH_GAP,
  paragraphIds,
  sentenceIds,
  tagAt,
  wordRange
} from '../lib/transcriptEdit'
import { transcriptChoices } from '../lib/contextActions'
import { useEditor, usePlayback } from '../store'

export function Transcript({ onToast }: { onToast?: (msg: string) => void }) {
  const project = useEditor((s) => s.project)
  const selected = useEditor((s) => s.selectedWordIds)
  const selectWords = useEditor((s) => s.selectWords)
  const dispatch = useEditor((s) => s.dispatch)
  const loadTranscript = useEditor((s) => s.loadTranscript)
  const programTime = usePlayback((s) => s.programTime)
  const sourceTime = programToSourceOf(project, programTime)
  const seekSource = usePlayback((s) => s.seekSource)
  const playFromSource = usePlayback((s) => s.playFromSource)
  const active = currentWord(project.transcript.words, sourceTime)
  const [editing, setEditing] = useState<string | null>(null)
  const [paintIds, setPaintIds] = useState<string[] | null>(null)
  const dragMoved = useRef(false)
  const pendingDouble = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tool = useEditor((s) => s.tool)
  const guardKind = useEditor((s) => s.guardKind)
  const selectSuggestion = useEditor((s) => s.selectSuggestion)
  const words = project.transcript.words
  const { summary, choices } = transcriptChoices(project, selected)

  return (
    <section
      className="panel transcript"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault()
        const file = e.dataTransfer.files[0]
        if (!file) return
        try {
          const words = parseAnyTranscript(file.name, await file.text())
          loadTranscript(words)
          onToast?.(`Transcript · ${words.length} words`)
        } catch (err) {
          onToast?.(err instanceof Error ? err.message : 'Could not read that transcript.')
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
      {selected.length > 0 && (
        <div className="context-helper">
          <p className="context-copy">
            {summary}
            {choices[0] ? ` — ${choices[0].consequence}` : ''}
          </p>
          <div className="context-actions">
            {choices.map((choice) => (
              <button
                key={choice.id}
                className="chip"
                title={choice.consequence}
                onClick={() => dispatch(choice.command)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        className="script"
        data-tool={tool}
        data-guard={guardKind}
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
          const gapSpan = prev ? { start: prev.end, end: word.start } : null
          const ate = gapSpan ? appliedSuggestionAt(project.suggestions, gapSpan.start, gapSpan.end) : undefined
          const gapCut = Boolean(
            ate ||
              project.cuts.some(
                (c) => prev && c.start <= prev.end + 0.05 && c.end >= word.start - 0.05
              )
          )
          const scene = (project.scenes ?? []).find((s) => word.start >= s.start && word.start < s.end)
          const sceneStart = scene && (!prev || prev.start < scene.start)
          const applied = word.deleted ? appliedForWord(project, word) : undefined
          const prevApplied = prev?.deleted ? appliedForWord(project, prev) : undefined
          const putBackLead = Boolean(applied && applied.id !== prevApplied?.id)
          const gapSuggestion = prev ? coveringAppliedSuggestion(project, prev.end, word.start) : undefined
          const gapTag = prev ? tagAt(project.tags, (prev.end + word.start) / 2) : undefined
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
                <span className="gap-cluster">
                  {gapSuggestion ? (
                    <button
                      type="button"
                      className="gap-chip put-back"
                      data-cut={gapCut}
                      data-sug={gapSuggestion.id}
                      title={`${gapSuggestion.label} · put this auto-edit back`}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        selectSuggestion(gapSuggestion.id)
                        dispatch({ type: 'revertSuggestion', suggestionId: gapSuggestion.id })
                      }}
                    >
                      {gap.toFixed(1)}s · Put back
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="gap-chip"
                      data-cut={gapCut}
                      data-tag={gapTag?.kind ?? ''}
                      data-sug={ate?.type}
                      title={
                        gapCut
                          ? 'Click to put this air back'
                          : 'Click to park · Demo marks a silent walkthrough · double-click to cut'
                      }
                      onClick={() => {
                        seekSource(prev.end)
                        if (gapCut) dispatch({ type: 'revertAt', start: prev.end, end: word.start })
                      }}
                      onDoubleClick={(e) => {
                        e.preventDefault()
                        if (gapCut) return
                        dispatch({ type: 'deleteRange', start: prev.end, end: word.start, source: 'transcript' })
                      }}
                    >
                      {gap.toFixed(1)}s
                    </button>
                  )}
                  {!gapTag && (
                    <button
                      type="button"
                      className="gap-demo"
                      title="This silence is a demo — keep it and put the cut back"
                      onClick={() => {
                        seekSource(prev.end)
                        dispatch({
                          type: 'addTag',
                          start: prev.end,
                          end: word.start,
                          kind: 'demo',
                          label: 'Silent product demo'
                        })
                      }}
                    >
                      demo
                    </button>
                  )}
                </span>
              )}
              {gap > PARAGRAPH_GAP && <span className="para-gap" />}
              {putBackLead && applied && (
                <button
                  type="button"
                  className="gap-chip put-back"
                  data-sug={applied.id}
                  title={`${applied.label} · put this auto-edit back`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    dispatch({ type: 'revertSuggestion', suggestionId: applied.id })
                  }}
                >
                  Put back
                </button>
              )}
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
                  data-tag={tag?.kind}
                  data-sug={applied?.type}
                  data-paint={paintIds?.includes(word.id) ?? false}
                  title={
                    applied
                      ? `${applied.label} · double-click puts this cut back`
                      : tag
                        ? `${tag.label}`
                        : undefined
                  }
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
                    if (e.detail >= 3) {
                      if (pendingDouble.current) clearTimeout(pendingDouble.current)
                      pendingDouble.current = null
                      selectWords(paragraphIds(words, i))
                      return
                    }
                    if (e.detail === 2) return
                    if (e.shiftKey && (e.altKey || e.metaKey || e.ctrlKey)) {
                      selectWords(paragraphIds(words, i))
                      return
                    }
                    if (e.shiftKey && selected.length) {
                      const anchor = words.findIndex((w) => w.id === selected[0])
                      const [lo, hi] = anchor <= i ? [anchor, i] : [i, anchor]
                      selectWords(words.slice(lo, hi + 1).map((w) => w.id))
                      seekSource(word.start)
                      return
                    }
                    if (e.altKey || e.metaKey) {
                      selectWords(sentenceIds(words, i))
                      return
                    }
                    playFromSource(word.start)
                    selectWords([word.id])
                  }}
                  onDoubleClick={() => {
                    if (pendingDouble.current) clearTimeout(pendingDouble.current)
                    pendingDouble.current = setTimeout(() => {
                      pendingDouble.current = null
                      if (applied) {
                        dispatch({ type: 'revertSuggestion', suggestionId: applied.id })
                        return
                      }
                      dispatch({ type: 'toggleWords', wordIds: [word.id] })
                    }, 220)
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
            Click a word to play from it. P plays I/O or the selection. C blades at the word.
            Triple-click or A selects a paragraph. M marks words, / loops I/O. . cuts this sentence,
            , cuts the false start, T tightens gaps. Put back chips revert that auto-edit. Demo on a
            pause marks a silent walkthrough. G paints a keep/demo guard. X cuts, U puts back.
          </p>
        )}
      </div>
    </section>
  )
}

export { extendSelection, wordRange }
