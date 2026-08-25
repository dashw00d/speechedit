import { useEffect, useRef, useState } from 'react'
import { appliedSuggestionAt } from '../lib/analysis'
import { parseAnyTranscript, isFillerToken } from '../lib/transcript'
import { currentWord } from '../lib/edl'
import { programToSourceOf, sourceToProgramOf } from '../lib/resolver'
import {
  appliedForWord,
  coveringAppliedSuggestion,
  extendSelection,
  PARAGRAPH_GAP,
  paragraphIds,
  sentenceIds,
  sentenceRange,
  sortWordIds,
  tagAt,
  wordIdsInRange,
  wordRange
} from '../lib/transcriptEdit'
import { transcriptChoices } from '../lib/contextActions'
import { findInTranscript } from '../lib/transcriptFind'
import { speakerColor } from '../lib/theme'
import { useEditor, usePlayback } from '../store'
import { StartGuide } from './StartGuide'

type Marquee = { x0: number; y0: number; x1: number; y1: number }

function rectsOverlap(a: Marquee, b: DOMRect): boolean {
  const left = Math.min(a.x0, a.x1)
  const right = Math.max(a.x0, a.x1)
  const top = Math.min(a.y0, a.y1)
  const bottom = Math.max(a.y0, a.y1)
  return left < b.right && right > b.left && top < b.bottom && bottom > b.top
}

export function Transcript({ onToast }: { onToast?: (msg: string) => void }) {
  const project = useEditor((s) => s.project)
  const selected = useEditor((s) => s.selectedWordIds)
  const selectWords = useEditor((s) => s.selectWords)
  const selectScene = useEditor((s) => s.selectScene)
  const dispatch = useEditor((s) => s.dispatch)
  const loadTranscript = useEditor((s) => s.loadTranscript)
  const programTime = usePlayback((s) => s.programTime)
  const sourceTime = programToSourceOf(project, programTime)
  const seekSource = usePlayback((s) => s.seekSource)
  const playLoop = usePlayback((s) => s.playLoop)
  const active = currentWord(project.transcript.words, sourceTime)
  const [editing, setEditing] = useState<string | null>(null)
  const [paintIds, setPaintIds] = useState<string[] | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const [findQuery, setFindQuery] = useState('')
  const [findNote, setFindNote] = useState<string | null>(null)
  const dragMoved = useRef(false)
  const pendingDouble = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorRef = useRef<string | null>(null)
  const paintAdditiveRef = useRef(false)
  const scriptRef = useRef<HTMLDivElement>(null)
  const wordRefs = useRef(new Map<string, HTMLButtonElement>())
  const tool = useEditor((s) => s.tool)
  const guardKind = useEditor((s) => s.guardKind)
  const selectSuggestion = useEditor((s) => s.selectSuggestion)
  const clearSelection = useEditor((s) => s.clearSelection)
  const selectGap = useEditor((s) => s.selectGap)
  const seekProgram = usePlayback((s) => s.seekProgram)
  const words = project.transcript.words
  const { choices } = transcriptChoices(project, selected)
  const selectedSet = new Set(selected)
  const popoverAnchor = [...words].reverse().find((w) => selectedSet.has(w.id))

  function loopSpan(start: number, end: number) {
    playLoop(sourceToProgramOf(project, start), sourceToProgramOf(project, end))
  }

  function loopSelection(ids: string[]) {
    const span = wordRange(words, ids)
    if (!span) return
    loopSpan(span.start, span.end)
  }

  function loopSentenceAt(wordId: string) {
    const range = sentenceRange(words, wordId)
    if (!range) {
      seekSource(words.find((w) => w.id === wordId)?.start ?? 0)
      return
    }
    loopSpan(range.start, range.end)
  }

  function applySelection(ids: string[], opts?: { additive?: boolean; loop?: boolean; anchor?: string }) {
    const sorted = sortWordIds(words, ids)
    if (!sorted.length) return
    selectWords(sorted, opts?.additive)
    anchorRef.current = opts?.anchor ?? sorted[0]
    if (opts?.loop !== false) loopSelection(sorted)
  }

  function idsInMarquee(box: Marquee): string[] {
    const hits: string[] = []
    for (const [id, el] of wordRefs.current) {
      if (rectsOverlap(box, el.getBoundingClientRect())) hits.push(id)
    }
    return sortWordIds(words, hits)
  }

  function findAndSelect(phrase: string) {
    const trimmed = phrase.trim()
    if (!trimmed) {
      setFindNote(null)
      return
    }
    const hit = findInTranscript(project, words, trimmed)
    if (!hit) {
      setFindNote(`No “${trimmed}” in transcript, scenes, or edits`)
      onToast?.(`No matches for “${trimmed}”.`)
      return
    }
    if (hit.kind === 'words') {
      applySelection(hit.ids, { anchor: hit.ids[0] })
      setFindNote(
        `${hit.matchGroups} match${hit.matchGroups === 1 ? '' : 'es'} · ${hit.ids.length} word${hit.ids.length === 1 ? '' : 's'}`
      )
      const first = wordRefs.current.get(hit.ids[0])
      first?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
    if (hit.kind === 'scene') {
      selectScene(hit.scene.id)
      clearSelection()
      seekSource(hit.scene.start)
      setFindNote(`Scene · ${hit.scene.title}`)
      return
    }
    selectSuggestion(hit.suggestion.id)
    clearSelection()
    seekProgram(sourceToProgramOf(project, hit.suggestion.start))
    setFindNote(`Edit · ${hit.suggestion.label}`)
  }

  useEffect(() => {
    const onEdit = (e: Event) => {
      const wordId = (e as CustomEvent<{ wordId: string }>).detail?.wordId
      if (wordId) setEditing(wordId)
    }
    window.addEventListener('speechedit:edit-word', onEdit)
    return () => window.removeEventListener('speechedit:edit-word', onEdit)
  }, [])

  useEffect(() => {
    const script = scriptRef.current
    if (!script) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'a') return
      if (!script.contains(document.activeElement) && document.activeElement !== script) return
      e.preventDefault()
      applySelection(
        words.map((w) => w.id),
        { loop: false }
      )
    }
    script.addEventListener('keydown', onKey)
    return () => script.removeEventListener('keydown', onKey)
  }, [words])

  return (
    <section
      className="panel transcript"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault()
        const file = e.dataTransfer.files[0]
        if (!file) return
        try {
          const parsed = parseAnyTranscript(file.name, await file.text())
          loadTranscript(parsed)
          onToast?.(`Transcript · ${parsed.length} words`)
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
                applySelection(
                  words.filter((w) => w.speaker === s.id).map((w) => w.id),
                  { loop: false }
                )
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
        <div className="transcript-toolbar">
          <input
            type="search"
            className="transcript-find"
            value={findQuery}
            placeholder="Find phrase, scene, or edit…"
            onChange={(e) => {
              setFindQuery(e.target.value)
              if (!e.target.value.trim()) setFindNote(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') findAndSelect(findQuery)
              if (e.key === 'Escape') {
                setFindQuery('')
                setFindNote(null)
              }
            }}
          />
          <button
            type="button"
            className="chip"
            title="Select every word in the transcript"
            onClick={() =>
              applySelection(
                words.map((w) => w.id),
                { loop: false }
              )
            }
          >
            Select all
          </button>
          {findNote && <span className="transcript-find-note">{findNote}</span>}
        </div>
      )}
      {words.length === 0 ? (
        <StartGuide />
      ) : (
      <div
        ref={scriptRef}
        className="script"
        tabIndex={0}
        data-tool={tool}
        data-guard={guardKind}
        onMouseDown={(e) => {
          if (tool === 'guard') return
          if ((e.target as HTMLElement).closest('.word, .gap-chip, .scene-chip, .word-popover, .word-edit')) return
          if (e.button !== 0) return
          e.preventDefault()
          paintAdditiveRef.current = e.ctrlKey || e.metaKey || e.shiftKey
          const x0 = e.clientX
          const y0 = e.clientY
          setMarquee({ x0, y0, x1: x0, y1: y0 })
          const move = (ev: MouseEvent) => setMarquee({ x0, y0, x1: ev.clientX, y1: ev.clientY })
          const up = (ev: MouseEvent) => {
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
            const box = { x0, y0, x1: ev.clientX, y1: ev.clientY }
            const dragged = Math.abs(box.x1 - box.x0) > 4 || Math.abs(box.y1 - box.y0) > 4
            if (dragged) {
              const ids = idsInMarquee(box)
              if (ids.length) applySelection(ids, { additive: paintAdditiveRef.current })
            }
            setMarquee(null)
          }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }}
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
              applySelection(paintIds, { loop: false })
            }
          } else {
            applySelection(paintIds, { additive: paintAdditiveRef.current })
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
          const gapSuggestion = prev ? coveringAppliedSuggestion(project, prev.end, word.start) : undefined
          const gapTag = prev ? tagAt(project.tags, (prev.end + word.start) / 2) : undefined
          const appliedAtGap = gapSuggestion ?? ate
          return (
            <span key={word.id} className="word-wrap">
              {sceneStart && scene && (
                <span className="scene-chip-row">
                  <button
                    className="scene-chip"
                    data-scene-id={scene.id}
                    data-kind={scene.kind}
                    title={scene.summary}
                    onClick={() => {
                      selectScene(scene.id)
                      seekSource(scene.start)
                    }}
                  >
                    {scene.takeIndex ? `Take ${scene.takeIndex} · ` : ''}
                    {scene.title}
                    {scene.kind === 'retake' ? ' · retake' : ''}
                  </button>
                </span>
              )}
              {gap > 0.45 && prev && (
                <span className="gap-cluster">
                  <button
                    type="button"
                    className="gap-chip"
                    data-gap-start={prev.end}
                    data-gap-end={word.start}
                    data-cut={gapCut}
                    data-tag={gapTag?.kind ?? ''}
                    data-sug={appliedAtGap?.type ?? ate?.type}
                    title={
                      gapCut
                        ? 'Click to review · double-click puts this air back'
                        : 'Click to review · double-click to cut'
                    }
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const start = prev.end
                      const end = word.start
                      seekSource(start)
                      loopSpan(start, end)
                      if (appliedAtGap) selectSuggestion(appliedAtGap.id)
                      else selectGap({ start, end })
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      if (gapCut) {
                        if (appliedAtGap) {
                          dispatch({ type: 'revertSuggestion', suggestionId: appliedAtGap.id })
                          return
                        }
                        dispatch({ type: 'revertAt', start: prev.end, end: word.start })
                        return
                      }
                      dispatch({ type: 'deleteRange', start: prev.end, end: word.start, source: 'transcript' })
                    }}
                  >
                    {gap.toFixed(1)}s
                  </button>
                </span>
              )}
              {gap > PARAGRAPH_GAP && <span className="para-gap" />}
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
                  ref={(el) => {
                    if (el) wordRefs.current.set(word.id, el)
                    else wordRefs.current.delete(word.id)
                  }}
                  className="word"
                  data-word-id={word.id}
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
                        : 'Click · Shift range · Ctrl toggle · drag or box to select'
                  }
                  style={{ ['--spk' as string]: speakerColor(project.transcript.speakers, word.speaker) }}
                  onMouseDown={(e) => {
                    if (editing) return
                    if (e.button !== 0) return
                    e.preventDefault()
                    dragMoved.current = false
                    paintAdditiveRef.current = e.ctrlKey || e.metaKey || e.shiftKey
                    setPaintIds([word.id])
                  }}
                  onMouseEnter={() => {
                    if (!paintIds) return
                    const start = words.findIndex((w) => w.id === paintIds[0])
                    if (start < 0) return
                    const [lo, hi] = start <= i ? [start, i] : [i, start]
                    const next = wordIdsInRange(words, lo, hi)
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
                      const ids = paragraphIds(words, i)
                      applySelection(ids)
                      return
                    }
                    if (e.detail === 2) return

                    if (e.shiftKey) {
                      const anchorId = anchorRef.current ?? selected[0] ?? word.id
                      const anchorIdx = words.findIndex((w) => w.id === anchorId)
                      const from = anchorIdx >= 0 ? anchorIdx : i
                      applySelection(wordIdsInRange(words, from, i))
                      return
                    }

                    if (e.ctrlKey || e.metaKey) {
                      if (selectedSet.has(word.id)) {
                        const next = selected.filter((id) => id !== word.id)
                        selectWords(next)
                        if (anchorRef.current === word.id) anchorRef.current = next[0] ?? null
                      } else {
                        selectWords([word.id], true)
                      }
                      return
                    }

                    if (e.altKey) {
                      const ids = sentenceIds(words, i)
                      applySelection(ids)
                      return
                    }

                    anchorRef.current = word.id
                    selectWords([word.id])
                    loopSentenceAt(word.id)
                    return
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
                >
                  {word.text}
                </button>
              )}
              {popoverAnchor?.id === word.id && choices.length > 0 && (
                <span className="word-popover" onMouseDown={(e) => e.stopPropagation()}>
                  <span className="word-popover-copy">{choices[0].consequence}</span>
                  <span className="word-popover-actions">
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
                  </span>
                </span>
              )}
            </span>
          )
        })}
        {words.length > 0 && (
          <p className="script-hint">
            Click words and pauses to edit — inspector follows your selection. ⌘K for all commands.
          </p>
        )}
      </div>
      )}
      {marquee && (
        <div
          className="transcript-marquee"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0)
          }}
        />
      )}
    </section>
  )
}

export { extendSelection, wordRange }
