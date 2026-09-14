import { AddContentMenu } from './AddContentMenu'
import { copySelectedClip, pasteClipboard } from '../lib/clipClipboard'
import { protectRange } from '../lib/protect'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { isPrimaryLane, primarySegments, programLength } from '../lib/commands'
import { wordsInRange } from '../lib/edl'
import { programToSourceOf, snapSourceTime, snapTime, sourceToProgramOf } from '../lib/resolver'
import { stitchPrimaryThumbs, stitchPrimaryWaveform } from '../lib/takes'
import { buildEditBlocks, editBlockCounts, filterEditBlocks, type EditBlock, type EditBlockFilter } from '../lib/timelineEdits'
import { coveringNote, hopNote, isTapeNote } from '../lib/clipEdit'
import { addNoteFromContext, startNoteEdit } from '../lib/noteEdit'
import { clearMarksFromContext } from '../lib/marks'
import { findRevealableStackTrack, trackLaneName } from '../lib/timelineTracks'
import { formatClock } from '../lib/time'
import { useEditor, usePlayback } from '../store'
import type { Asset, Clip, TagKind, Track, Word } from '../types'
import { IconHide, IconLock, IconMore, IconMute, IconSelectAll, IconSolo } from './Icons'
import { OverflowMenu } from './OverflowMenu'

const PPS_MIN = 18
const PPS_MAX = 280
const LABEL_WIDTH = 184

export function Timeline({ onToast }: { onToast?: (msg: string) => void } = {}) {
  const project = useEditor((s) => s.project)
  const clipboard = useEditor((s) => s.clipClipboard)
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const selectedClipIds = useEditor((s) => s.selectedClipIds)
  const selectClip = useEditor((s) => s.selectClip)
  const selectClips = useEditor((s) => s.selectClips)
  const selectSuggestion = useEditor((s) => s.selectSuggestion)
  const selectGap = useEditor((s) => s.selectGap)
  const selectScene = useEditor((s) => s.selectScene)
  const dispatch = useEditor((s) => s.dispatch)
  const snap = useEditor((s) => s.snap)
  const setSnap = useEditor((s) => s.setSnap)
  const ripple = useEditor((s) => s.ripple)
  const setRipple = useEditor((s) => s.setRipple)
  const tool = useEditor((s) => s.tool)
  const guardKind = useEditor((s) => s.guardKind)
  const setTool = useEditor((s) => s.setTool)
  const setGuardKind = useEditor((s) => s.setGuardKind)
  const [stroke, setStroke] = useState<{ start: number; end: number; erase: boolean; kind: TagKind } | null>(
    null
  )
  const programTime = usePlayback((s) => s.programTime)
  const playing = usePlayback((s) => s.playing)
  const pps = usePlayback((s) => s.pixelsPerSecond)
  const seekProgram = usePlayback((s) => s.seekProgram)
  const setPps = usePlayback((s) => s.setPixelsPerSecond)
  const setFitPpsStore = usePlayback((s) => s.setFitPixelsPerSecond)

  const duration = Math.max(programLength(project), 8)
  const width = Math.max(duration * pps + 80, 800)
  const segments = primarySegments(project)
  const primaryWaveform = stitchPrimaryWaveform(project)
  const primaryThumbs = stitchPrimaryThumbs(project)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingZoomRef = useRef<
    { mode: 'anchor'; viewX: number } | { mode: 'center' } | null
  >(null)
  const [scrollTick, setScrollTick] = useState(0)
  const [laneViewport, setLaneViewport] = useState(0)
  const [fitPps, setFitPps] = useState(60)
  const [editFilter, setEditFilter] = useState<EditBlockFilter>('all')
  const editBlocks = useMemo(() => buildEditBlocks(project), [project])
  const editCounts = useMemo(() => editBlockCounts(editBlocks), [editBlocks])
  const filteredEditBlocks = useMemo(() => filterEditBlocks(editBlocks, editFilter), [editBlocks, editFilter])
  const showEditFilters = editBlocks.length > 0
  const visibleTracks = project.tracks

  useEffect(() => {
    if (tool !== 'guard') return
    const dismissOutsideTimeline = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && !target.closest('.timeline-panel, .transcript, .overflow-menu-fly, .mobile-workspace-nav')) setTool('select')
    }
    document.addEventListener('pointerdown', dismissOutsideTimeline, true)
    return () => document.removeEventListener('pointerdown', dismissOutsideTimeline, true)
  }, [tool, setTool])

  const ticks = useMemo(() => {
    const step = pps > 100 ? 1 : pps > 50 ? 2 : pps > 24 ? 5 : 10
    const out: number[] = []
    for (let t = 0; t <= duration; t += step) out.push(t)
    return out
  }, [duration, pps])

  const io =
    project.markIn != null && project.markOut != null
      ? {
          start: Math.min(project.markIn, project.markOut),
          end: Math.max(project.markIn, project.markOut)
        }
      : null

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const updateFit = () => {
      const labelWidth = scroll.querySelector<HTMLElement>('.track-label')?.offsetWidth ?? LABEL_WIDTH
      setLaneViewport(scroll.clientWidth - labelWidth)
      const next = Math.min(
        PPS_MAX,
        Math.max(PPS_MIN, (scroll.clientWidth - LABEL_WIDTH - 48) / Math.max(duration, 0.5))
      )
      setFitPps(next)
      setFitPpsStore(next)
    }
    updateFit()
    const ro = new ResizeObserver(updateFit)
    ro.observe(scroll)
    return () => ro.disconnect()
  }, [duration, setFitPpsStore])

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const onScroll = () => setScrollTick((t) => t + 1)
    onScroll()
    scroll.addEventListener('scroll', onScroll, { passive: true })
    return () => scroll.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    const pending = pendingZoomRef.current
    if (!pending) return
    pendingZoomRef.current = null
    const scroll = scrollRef.current
    if (!scroll) return
    if (pending.mode === 'center') {
      const x = programTime * pps
      scroll.scrollLeft = Math.max(0, x - scroll.clientWidth / 2)
    } else {
      scroll.scrollLeft = Math.max(0, programTime * pps - pending.viewX)
    }
    setScrollTick((t) => t + 1)
  }, [pps, programTime])

  // Follow the playback clock without seeking media or moving the vertical scroll.
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!playing || !scroll) return
    const viewport = laneViewport
    if (viewport <= 0) return
    const playhead = programTime * pps
    const right = viewport * 0.8
    const left = Math.min(24, viewport * 0.1)
    const viewX = playhead - scroll.scrollLeft
    const next = viewX > right ? playhead - right : viewX < left ? Math.max(0, playhead - viewport * 0.2) : scroll.scrollLeft
    if (Math.abs(next - scroll.scrollLeft) < 1) return
    scroll.scrollLeft = next
    setScrollTick(t => t + 1)
  }, [playing, programTime, pps, laneViewport])

  function zoomAroundPlayhead(nextPps: number) {
    const scroll = scrollRef.current
    const clamped = Math.min(PPS_MAX, Math.max(PPS_MIN, nextPps))
    const viewX = scroll ? programTime * pps - scroll.scrollLeft : 0
    pendingZoomRef.current = { mode: 'anchor', viewX }
    setPps(clamped)
  }

  function fitTape() {
    pendingZoomRef.current = { mode: 'center' }
    setPps(fitPps)
  }

  function timeAt(clientX: number): number {
    const scroll = scrollRef.current
    if (!scroll) return 0
    const base = scroll.getBoundingClientRect().left + LABEL_WIDTH
    const x = clientX - base + scroll.scrollLeft
    const raw = Math.max(0, x / pps)
    return snap ? snapTime(project, raw, [programTime]) : raw
  }

  const scrollLeft = useMemo(() => scrollRef.current?.scrollLeft ?? 0, [scrollTick])
  const playheadViewX = programTime * pps - scrollLeft
  const followRight = laneViewport * 0.8
  // scrollLeft is rounded to device pixels. Subtracting it from fractional
  // playback time makes the pinned marker oscillate by a pixel while following.
  // Keep that visual anchor steady; paused seeking still uses the exact position.
  const overlayLeft = playing && laneViewport > 0 && Math.abs(playheadViewX - followRight) <= 1
    ? followRight
    : playheadViewX
  const overlayLeftAt = (t: number) => t * pps - scrollLeft

  function startPaint(clientX: number, opts: { erase: boolean; shift: boolean }) {
    const t0 = timeAt(clientX)
    const kind: TagKind = opts.shift ? 'demo' : guardKind === 'hook' || guardKind === 'cta' ? 'note' : guardKind
    setStroke({ start: t0, end: t0, erase: opts.erase, kind })
    const move = (ev: MouseEvent) => {
      setStroke((s) => (s ? { ...s, end: timeAt(ev.clientX) } : s))
    }
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const t1 = timeAt(ev.clientX)
      const a = Math.min(t0, t1)
      const b = Math.max(t0, t1)
      const start = programToSourceOf(project, a)
      const end = programToSourceOf(project, b)
      if (opts.erase) dispatch({ type: 'eraseTag', start, end, kind })
      else {
        dispatch({ type: 'addTag', start, end, kind })
        if (kind === 'note') {
          const note = coveringNote(useEditor.getState().project, start, end)
          if (note) startNoteEdit(note.id)
          onToast?.('Type the note — hook, ask, or why you parked.')
        }
      }
      setStroke(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function revealOrAddTrack(trackType: 'overlay' | 'caption') {
    const hidden = findRevealableStackTrack(project.tracks, trackType)
    if (hidden) {
      dispatch({ type: 'setTrackFlag', trackId: hidden.id, patch: { hidden: false } })
      return
    }
    const visibleEmpty = project.tracks.find((t) => t.type === trackType && !t.hidden && t.clips.length === 0)
    if (visibleEmpty) return
    dispatch({ type: 'addTrack', trackType })
  }

  function onEditBlockClick(block: EditBlock, e: ReactMouseEvent) {
    e.stopPropagation()
    seekProgram(block.start)
    if (block.suggestionId) {
      selectSuggestion(block.suggestionId)
      return
    }
    if (block.tagId) {
      const tag = project.tags.find((t) => t.id === block.tagId)
      if (tag && (tag.kind === 'keep' || tag.kind === 'demo')) {
        selectGap({ start: tag.start, end: tag.end })
      }
      return
    }
    if (block.sceneId) {
      const scene = project.scenes?.find((s) => s.id === block.sceneId)
      if (!scene) return
      selectScene(scene.id)
      seekProgram(sourceToProgramOf(project, scene.start))
    }
  }

  const zoomPct = Math.round((pps / fitPps) * 100)

  return (
    <section className="timeline-panel">
      <header className="timeline-toolbar">
        <div className="timeline-toolbar-group timeline-view-controls" data-label="Zoom" aria-label="Timeline zoom">
          <button className="timeline-btn" type="button" title="Zoom out" onClick={() => zoomAroundPlayhead(pps - 12)}>
            −
          </button>
          <input
            className="timeline-zoom"
            type="range"
            min={PPS_MIN}
            max={PPS_MAX}
            value={pps}
            aria-label={`Zoom ${zoomPct}% · Fit is 100%`}
            onChange={(e) => zoomAroundPlayhead(Number(e.target.value))}
            title={`Zoom ${zoomPct}% · Fit is 100%`}
          />
          <button className="timeline-btn" type="button" title="Zoom in" onClick={() => zoomAroundPlayhead(pps + 12)}>
            +
          </button>
          <button
            className="timeline-btn"
            type="button"
            data-active={Math.abs(pps - fitPps) < 1 || undefined}
            title="Fit the whole reel in view (\\)"
            onClick={fitTape}
          >
            Fit all
          </button>
        </div>
        <div className="timeline-toolbar-group timeline-mode-controls" data-label="Behavior" aria-label="Editing behavior">
          <button
            className="timeline-btn"
            type="button"
            data-active={snap}
            aria-pressed={snap}
            onClick={() => setSnap(!snap)}
            title={snap ? 'Snap on — playhead and trims stick to words and clip edges' : 'Snap off — free placement'}
          >
            {snap ? 'Snap to clips' : 'Free move'}
          </button>
          <button
            className="timeline-btn"
            type="button"
            data-active={ripple}
            aria-pressed={ripple}
            title={
              ripple
                ? 'Removing words closes the gap. Click to leave a blank space and keep later clips in place.'
                : 'Removing words leaves a blank space so later clips stay in place. Click to close gaps instead.'
            }
            onClick={() => setRipple(!ripple)}
          >
            {ripple ? 'Close gaps' : 'Leave gaps'}
          </button>
        </div>
        <div className="timeline-toolbar-group timeline-edit-controls" data-label="Tools" aria-label="Timeline editing tools">
          <AddContentMenu onToast={onToast} />
          {(selectedClipId || clipboard?.clip) && <OverflowMenu tone="chip" place="below" label="Clip actions" title="Actions for the selected clip">
            {project.tracks.some((track) => track.clips.some((clip) => clip.id === selectedClipId)) && <button className="overflow-item" onClick={() => { if (copySelectedClip('clip')) onToast?.('Copied clip. Paste at the playhead.') }}>Copy selected clip</button>}
            {clipboard?.clip && <button className="overflow-item" onClick={() => { if (pasteClipboard('clip')) onToast?.('Pasted at the playhead.') }}>Paste clip at playhead</button>}
            {selectedClipId && <button className="overflow-item" onClick={() => { window.dispatchEvent(new Event('speechedit:selection-details')); window.dispatchEvent(new CustomEvent('speechedit:workspace-pane', { detail: 'review' })) }}>Adjust selected clip…</button>}
          </OverflowMenu>}
          <button
            className="timeline-btn"
            type="button"
            title="Insert a 1s hold at the playhead. Later clips slide right."
            onClick={() => dispatch({ type: 'insertGap', time: programTime, duration: 1 })}
          >
            Add gap
          </button>
          <button
            className="timeline-btn"
            type="button"
            title="Split the clip at the playhead (S)"
            onClick={() =>
              dispatch({ type: 'splitAt', time: programToSourceOf(project, programTime) })
            }
          >
            Split
          </button>
          <OverflowMenu tone="chip" place="below" label="Trim" title="Remove the beginning or end of a clip">
            <span className="overflow-section-label">Move the playhead to the new edge first</span>
            <button type="button" className="overflow-item" disabled={programTime <= 0} onClick={() => {
              dispatch({ type: 'rippleTrimToPlayhead', edge: 'in', time: programTime, lift: !ripple })
              onToast?.('Trimmed the start to the playhead. Undo puts it back.')
            }}>Remove start up to playhead (Q)</button>
            <button type="button" className="overflow-item" disabled={programTime >= programLength(project)} onClick={() => {
              dispatch({ type: 'rippleTrimToPlayhead', edge: 'out', time: programTime, lift: !ripple })
              onToast?.('Trimmed the end back to the playhead. Undo puts it back.')
            }}>Remove end after playhead (W)</button>
          </OverflowMenu>
          {segments.length > 1 && <button className="timeline-btn" title="Fade across the nearest join at the playhead" onClick={() => {
            const before = useEditor.getState().project
            dispatch({ type: 'dissolveAtPlayhead', time: programTime, duration: 0.4 })
            onToast?.(useEditor.getState().project === before ? 'Move the playhead near a join between clips.' : 'Added a cross-dissolve. Adjust fades in the clip inspector.')
          }}>Dissolve</button>}
          <button
            className="timeline-btn"
            type="button"
            title="Drop a note at the playhead. Type hook, ask, or why you parked."
            onClick={() => onToast?.(addNoteFromContext().toast)}
          >
            Note
          </button>
          {project.tags.some((tag) => isTapeNote(tag.kind)) && (
            <>
              <button
                className="timeline-btn"
                type="button"
                title="Previous note (Shift+N)"
                onClick={() => {
                  const note = hopNote(project, programToSourceOf(project, programTime), -1)
                  if (note) seekProgram(sourceToProgramOf(project, note.start))
                }}
              >
                ‹ Note
              </button>
              <button
                className="timeline-btn"
                type="button"
                title="Next note (N)"
                onClick={() => {
                  const note = hopNote(project, programToSourceOf(project, programTime), 1)
                  if (note) seekProgram(sourceToProgramOf(project, note.start))
                }}
              >
                Note ›
              </button>
            </>
          )}
          <button
            className="timeline-btn"
            type="button"
            data-active={tool === 'guard'}
            aria-pressed={tool === 'guard'}
            onClick={() => setTool(tool === 'guard' ? 'select' : 'guard')}
            title="Protect words so Auto Edit skips them (G)"
          >
            Protect
          </button>
          {tool === 'guard' && (
            <>
              <button
                className="timeline-btn"
                type="button"
                data-active={guardKind === 'keep'}
                title="Keep this speech. Auto Edit will not cut it."
                onClick={() => setGuardKind('keep')}
              >
                Keep
              </button>
              <button
                className="timeline-btn"
                type="button"
                data-active={guardKind === 'demo'}
                title="Silent product walkthrough. Auto Edit will skip pauses here."
                onClick={() => setGuardKind('demo')}
              >
                Silent demo
              </button>
              <button
                className="timeline-btn"
                type="button"
                data-active={guardKind === 'note'}
                title="Paint a note on words. Auto Edit ignores notes."
                onClick={() => setGuardKind('note')}
              >
                Note
              </button>
            </>
          )}
        </div>
        {showEditFilters && (
          <div className="timeline-toolbar-group edit-filters" data-label="Show" aria-label="Filter timeline markers">
            <OverflowMenu tone="chip" place="below" label={`Markers: ${{ all: 'All', pending: 'Needs review', applied: 'Applied', scenes: 'Chapters', guards: 'Protected', notes: 'Notes' }[editFilter]}`} title="Choose which timeline markers to show">
            {(
              [
                ['all', 'All'],
                ['pending', 'Open'],
                ['applied', 'Applied'],
                ['scenes', 'Chapters'],
                ['guards', 'Protected'],
                ['notes', 'Notes']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="overflow-item edit-filter"
                aria-pressed={editFilter === id}
                data-active={editFilter === id}
                title={
                  id === 'notes'
                    ? 'Show only note markers'
                    : id === 'guards'
                    ? 'Show only protected / silent-demo ranges'
                    : id === 'scenes'
                      ? 'Show only chapter markers'
                      : id === 'pending'
                        ? 'Show edits that still need a decision'
                        : id === 'applied'
                          ? 'Show cuts already applied'
                          : 'Show every marker on the Edits lane'
                }
                onClick={() => setEditFilter(id)}
              >
                {label}
                {editCounts[id] > 0 ? ` ${editCounts[id]}` : ''}
              </button>
            ))}
            </OverflowMenu>
          </div>
        )}
        <div className="timeline-toolbar-group timeline-track-controls" data-label="Tracks" aria-label="Add or reveal tracks">
          <OverflowMenu tone="chip" place="below" label="+ Add track" title="Add a graphics, audio, or captions track">
            <button
              className="overflow-item"
              type="button"
              title="Show a hidden graphics track, or add one"
              onClick={() => revealOrAddTrack('overlay')}
            >
              Graphics
            </button>
            <button
              className="overflow-item"
              type="button"
              title="Add a music or sound-effects track"
              onClick={() => dispatch({ type: 'addTrack', trackType: 'audio' })}
            >
              Audio
            </button>
            <button
              className="overflow-item"
              type="button"
              title="Show a hidden captions track, or add one"
              onClick={() => revealOrAddTrack('caption')}
            >
              Captions
            </button>
          </OverflowMenu>
        </div>
        {io && (
          <div className="timeline-toolbar-group timeline-mark-controls" data-label="Marked clip" aria-label="Actions for the marked clip">
            <OverflowMenu tone="chip" place="below" label="Protect marked" title="Keep this marked range during automatic editing">
              <button className="overflow-item" onClick={() => onToast?.(protectRange(programToSourceOf(project, io.start), programToSourceOf(project, io.end), 'keep').toast)}>Keep marked range</button>
              <button className="overflow-item" onClick={() => onToast?.(protectRange(programToSourceOf(project, io.start), programToSourceOf(project, io.end), 'demo').toast)}>Keep as a silent demonstration</button>
            </OverflowMenu>
            <>
              <button
                className="timeline-btn"
                type="button"
                title={
                  ripple
                    ? 'Remove everything between In and Out and close the gap'
                    : 'Remove the marked words but leave a hold so later clips stay put'
                }
                onClick={() => dispatch({ type: ripple ? 'rippleDeleteMarks' : 'liftMarks' })}
              >
                {ripple ? 'Cut marked' : 'Lift marked'}
              </button>
              {!ripple && (
                <button
                  className="timeline-btn"
                  type="button"
                  title="Remove the marked range and close the gap"
                  onClick={() => dispatch({ type: 'rippleDeleteMarks' })}
                >
                  Extract
                </button>
              )}
              {ripple && (
                <button
                  className="timeline-btn"
                  type="button"
                  title="Remove the marked words but leave a hold"
                  onClick={() => dispatch({ type: 'liftMarks' })}
                >
                  Lift marked
                </button>
              )}
              <button
                className="timeline-btn"
                type="button"
                title="Shorten pauses inside the marked range. Protected demo stays."
                onClick={() =>
                  dispatch({
                    type: 'tightenRange',
                    start: programToSourceOf(project, io.start),
                    end: programToSourceOf(project, io.end)
                  })
                }
              >
                Tighten marked
              </button>
              <button
                className="timeline-btn"
                type="button"
                title="Clear In and Out without cutting, then find the next clip"
                onClick={() => onToast?.(clearMarksFromContext().toast)}
              >
                Clear marks
              </button>
            </>
          </div>
        )}
      </header>

      <div className="timeline-scroll-wrap">
        <div
          className="timeline-body"
          ref={scrollRef}
          data-tool={tool}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault()
              zoomAroundPlayhead(pps + (e.deltaY > 0 ? -8 : 8))
            }
          }}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest('.clip, .handle, .edit-block, .track-label')) return
            if (tool !== 'guard') return
            e.preventDefault()
            startPaint(e.clientX, { erase: e.altKey, shift: e.shiftKey })
          }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('.clip, .edits-lane, .edit-block, .track-label')) return
            if (tool === 'guard') return
            if ((e.target as HTMLElement).closest('.ruler, .timeline-lane-col, .lane')) {
              seekProgram(timeAt(e.clientX))
            }
          }}
        >
          <div className="timeline-canvas" style={{ width: LABEL_WIDTH + width }}>
          <div className="timeline-row timeline-row-ruler">
            <div className="track-label track-label-ruler">Time</div>
            <div className="ruler timeline-lane-col" style={{ width }}>
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: t * pps }}>
                  {formatClock(t)}
                </div>
              ))}
              {project.markIn != null && <div className="io in" style={{ left: project.markIn * pps }} />}
              {project.markOut != null && <div className="io out" style={{ left: project.markOut * pps }} />}
              {io && (
                <div
                  className="io-range"
                  style={{ left: io.start * pps, width: Math.max(6, (io.end - io.start) * pps) }}
                  title="Marked range · Cut marked removes this and closes the gap"
                />
              )}
            </div>
          </div>

          <div className="timeline-row">
            <div className="track-label track-label-edits" data-active={tool === 'guard'}>
              Edits
            </div>
            <div className="timeline-lane-col" style={{ width }}>
              <EditsLane
                pps={pps}
                blocks={filteredEditBlocks}
                totalCount={editBlocks.length}
                filter={editFilter}
                stroke={stroke}
                onBlockClick={onEditBlockClick}
                onSceneEdge={(sceneId, edge, sourceTime) =>
                  dispatch(
                    edge === 'in'
                      ? { type: 'setSceneBounds', sceneId, start: sourceTime }
                      : { type: 'setSceneBounds', sceneId, end: sourceTime }
                  )
                }
              />
            </div>
          </div>

          {visibleTracks.map((track) => (
            <div key={track.id} className="timeline-row" data-output-hidden={track.hidden || undefined}>
              <TrackLabel
                track={track}
                primary={isPrimaryLane(track)}
                onFlag={(patch) => dispatch({ type: 'setTrackFlag', trackId: track.id, patch })}
                onRename={(name) => dispatch({ type: 'setTrackFlag', trackId: track.id, patch: { name } })}
                onRemove={() => dispatch({ type: 'removeTrack', trackId: track.id })}
                onSelectAll={() =>
                  selectClips(isPrimaryLane(track) ? segments.map((clip) => clip.id) : track.clips.map((clip) => clip.id))
                }
              />
              <div className="timeline-lane-col" style={{ width }}>
                <Lane
                  track={track}
                  segments={segments}
                  pps={pps}
                  selectedClipIds={selectedClipIds.length ? selectedClipIds : selectedClipId ? [selectedClipId] : []}
                  waveform={primaryWaveform}
                  assets={project.assets}
                  thumbnails={primaryThumbs}
                  sourceDuration={project.sourceDuration}
                  words={project.transcript.words}
                  onSelect={(id, additive) => selectClip(id, { additive })}
                  onMove={(clipId, start) =>
                    dispatch({
                      type: 'moveClip',
                      clipId,
                      start: snap ? snapTime(project, start, [programTime]) : start
                    })
                  }
                  onSlip={(clipId, delta) => dispatch({ type: 'slipClip', clipId, delta })}
                  onSlide={(clipId, start) =>
                    dispatch({
                      type: 'slideClip',
                      clipId,
                      start: snap ? snapTime(project, start, [programTime]) : start
                    })
                  }
                  onRoll={(clipId, edge, time) =>
                    dispatch({
                      type: 'rollClip',
                      clipId,
                      edge,
                      time: snap ? snapTime(project, time, [programTime]) : time
                    })
                  }
                  onTrim={(clipId, edge, time) =>
                    dispatch({
                      type: 'trimClip',
                      clipId,
                      edge,
                      time: snap ? snapTime(project, time, [programTime]) : time
                    })
                  }
                  onTrimPrimary={(segmentId, edge, sourceTime) =>
                    dispatch({
                      type: 'trimPrimary',
                      segmentId,
                      edge,
                      sourceTime: snap ? snapSourceTime(project, sourceTime, [programTime]) : sourceTime
                    })
                  }
                />
              </div>
            </div>
          ))}

        </div>
        </div>
        <div className="timeline-overlay" aria-hidden>
          {io && (
            <div
              className="io-span"
              style={{ left: overlayLeftAt(io.start), width: Math.max(6, (io.end - io.start) * pps) }}
            />
          )}
          {project.markIn != null && (
            <div className="io-line in" style={{ left: overlayLeftAt(project.markIn) }} />
          )}
          {project.markOut != null && (
            <div className="io-line out" style={{ left: overlayLeftAt(project.markOut) }} />
          )}
          <div className="playhead" style={{ left: overlayLeft }} />
        </div>
      </div>
    </section>
  )
}

function TrackLabel({
  track,
  primary,
  onFlag,
  onRename,
  onRemove,
  onSelectAll
}: {
  track: Track
  primary: boolean
  onFlag: (patch: Partial<Pick<Track, 'muted' | 'hidden' | 'locked' | 'solo'>>) => void
  onRename: (name: string) => void
  onRemove: () => void
  onSelectAll: () => void
}) {
  const [editing, setEditing] = useState(false)
  const canRemove = !primary && track.clips.length === 0
  return (
    <div className="track-label" data-track-id={track.id} data-kind={track.type} data-primary={primary}>
      {editing ? (
        <input
          className="track-label-rename"
          defaultValue={track.name}
          autoFocus
          onBlur={(e) => {
            const name = e.target.value.trim()
            if (name && name !== track.name) onRename(name)
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span
          className="track-label-name"
          title={`${track.name} · double-click to rename`}
          onDoubleClick={() => setEditing(true)}
        >
          {trackLaneName(track)}
        </span>
      )}
      <span className="track-label-actions">
        <button
          className="track-flag"
          type="button"
          data-active={track.muted}
          title={track.muted ? 'Unmute track' : 'Mute — silence this track in export'}
          aria-label={track.muted ? 'Unmute track' : 'Mute track'}
          onClick={() => onFlag({ muted: !track.muted })}
        >
          <IconMute />
        </button>
        <button
          className="track-flag"
          type="button"
          data-active={track.hidden}
          title={track.hidden ? 'Include track in preview and export' : 'Hide track from preview and export'}
          aria-label={track.hidden ? 'Show track' : 'Hide track'}
          aria-pressed={track.hidden}
          onClick={() => onFlag({ hidden: !track.hidden })}
        >
          <IconHide />
        </button>
        <button
          className="track-flag"
          type="button"
          data-active={track.locked}
          title={track.locked ? 'Unlock — allow moving and trimming clips' : 'Lock — prevent moving or trimming clips'}
          aria-label={track.locked ? 'Unlock track' : 'Lock track'}
          onClick={() => onFlag({ locked: !track.locked })}
        >
          <IconLock />
        </button>
        <OverflowMenu
          tone="track"
          place={track.type === 'caption' || track.type === 'overlay' ? 'below' : 'above'}
          label={<IconMore />}
          title={`More options for ${trackLaneName(track)}`}
        >
          <button className="overflow-item" type="button" onClick={onSelectAll}>
            <IconSelectAll /> Select all clips
          </button>
          <button
            className="overflow-item"
            type="button"
            data-active={track.solo}
            onClick={() => onFlag({ solo: !track.solo })}
          >
            <IconSolo /> {track.solo ? 'Unsolo track' : 'Solo track'}
          </button>
          {canRemove && (
            <button className="overflow-item track-remove" type="button" onClick={onRemove}>
              Remove empty track
            </button>
          )}
        </OverflowMenu>
      </span>
    </div>
  )
}

function EditsLane({
  pps,
  blocks,
  totalCount,
  filter,
  stroke,
  onBlockClick,
  onSceneEdge
}: {
  pps: number
  blocks: EditBlock[]
  totalCount: number
  filter: EditBlockFilter
  stroke: { start: number; end: number; erase: boolean; kind: TagKind } | null
  onBlockClick: (block: EditBlock, e: ReactMouseEvent) => void
  onSceneEdge: (sceneId: string, edge: 'in' | 'out', sourceTime: number) => void
}) {
  const left = stroke ? Math.min(stroke.start, stroke.end) * pps : 0
  const width = stroke ? Math.max(4, Math.abs(stroke.end - stroke.start) * pps) : 0
  const emptyFilter =
    filter === 'applied'
      ? 'No cuts applied yet. Open shows what still needs a decision.'
      : filter === 'pending'
        ? 'Nothing waiting. Applied shows cuts already made.'
        : filter === 'scenes'
          ? 'No chapter markers yet. Find retakes on the bar below.'
          : filter === 'guards'
            ? 'Nothing protected. Select words and click Protect.'
            : filter === 'notes'
              ? 'No notes yet. Click Note on the tape or press N after you add one.'
            : 'No markers match this filter'

  return (
    <div
      className="lane edits-lane"
      title="Protected ranges, pending edits, and applied cuts · drag to protect · Alt-drag erases"
    >
      {totalCount === 0 && !stroke && <div className="edits-hint">Protected ranges · suggestions · scenes</div>}
      {totalCount > 0 && blocks.length === 0 && !stroke && (
        <div className="edits-hint">{emptyFilter}</div>
      )}
      {blocks.map((block) => {
        const w = Math.max(block.kind === 'scene' ? 2 : 6, (block.end - block.start) * pps)
        return (
          <button
            key={block.id}
            type="button"
            className="edit-block"
            data-block-id={block.id}
            data-block-kind={block.kind}
            data-block-start={block.start}
            data-block-end={block.end}
            data-block-label={block.label}
            data-suggestion-id={block.suggestionId ?? ''}
            data-tag-id={block.tagId ?? ''}
            data-scene-id={block.sceneId ?? ''}
            data-kind={block.kind}
            data-type={block.suggestionType ?? ''}
            data-safe={block.safe ?? false}
            style={{ left: block.start * pps, width: w }}
            title={block.detail}
            onClick={(e) => onBlockClick(block, e)}
          >
            {block.kind !== 'scene' && w > 28 ? block.label : ''}
            {block.kind === 'scene' && block.sceneId && (
              <>
                <i
                  className="handle in"
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    const startX = e.clientX
                    const origin = block.start
                    const move = (ev: MouseEvent) => {
                      const dt = (ev.clientX - startX) / pps
                      onSceneEdge(block.sceneId!, 'in', programToSourceOf(useEditor.getState().project, origin + dt))
                    }
                    const up = () => {
                      window.removeEventListener('mousemove', move)
                      window.removeEventListener('mouseup', up)
                    }
                    window.addEventListener('mousemove', move)
                    window.addEventListener('mouseup', up)
                  }}
                />
                <i
                  className="handle out"
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    const startX = e.clientX
                    const origin = block.end
                    const move = (ev: MouseEvent) => {
                      const dt = (ev.clientX - startX) / pps
                      onSceneEdge(block.sceneId!, 'out', programToSourceOf(useEditor.getState().project, origin + dt))
                    }
                    const up = () => {
                      window.removeEventListener('mousemove', move)
                      window.removeEventListener('mouseup', up)
                    }
                    window.addEventListener('mousemove', move)
                    window.addEventListener('mouseup', up)
                  }}
                />
              </>
            )}
          </button>
        )
      })}
      {stroke && (
        <div
          className="edit-block preview"
          data-kind={stroke.kind === 'demo' ? 'demo' : 'keep'}
          data-erase={stroke.erase}
          style={{ left, width }}
        >
          {stroke.erase ? 'erase' : stroke.kind === 'demo' ? 'demo' : 'keep'}
        </div>
      )}
    </div>
  )
}

function clipLabel(clip: Clip, track: Track, assets: Record<string, Asset>, words: Word[]): string {
  if (clip.kind === 'slug') return `Hold ${clip.duration.toFixed(1)}s`
  if (clip.effect === 'blur') return 'REDACT'
  if (clip.text?.trim()) return clip.text
  const assetName = clip.assetId ? assets[clip.assetId]?.name.replace(/\.[^.]+$/, '') : undefined
  if (assetName) return assetName
  if (isPrimaryLane(track)) {
    const spoken = wordsInRange(words, clip.inPoint, clip.outPoint)
      .filter((word) => !word.deleted)
      .slice(0, 5)
      .map((word) => word.text)
      .join(' ')
    const clock = `${formatClock(clip.inPoint)}–${formatClock(clip.outPoint)}`
    const speed = clip.speed !== 1 ? ` ${clip.speed}×` : ''
    return spoken ? `${spoken}${speed}` : `${clock}${speed}`
  }
  return track.name
}

function Lane({
  track,
  segments,
  pps,
  selectedClipIds,
  waveform,
  assets,
  thumbnails,
  sourceDuration,
  words,
  onSelect,
  onMove,
  onSlip,
  onSlide,
  onRoll,
  onTrim,
  onTrimPrimary
}: {
  track: Track
  segments: Clip[]
  pps: number
  selectedClipIds: string[]
  waveform?: number[]
  assets: Record<string, Asset>
  thumbnails?: string[]
  sourceDuration: number
  words: Word[]
  onSelect: (id: string, additive?: boolean) => void
  onMove: (clipId: string, start: number) => void
  onSlip: (clipId: string, delta: number) => void
  onSlide: (clipId: string, start: number) => void
  onRoll: (clipId: string, edge: 'in' | 'out', time: number) => void
  onTrim: (clipId: string, edge: 'in' | 'out', time: number) => void
  onTrimPrimary: (segmentId: string, edge: 'in' | 'out', sourceTime: number) => void
}) {
  const primary = isPrimaryLane(track)
  const clips = primary ? segments : track.clips

  return (
    <div className="lane media-lane" data-primary={primary} data-kind={track.type} data-muted={track.muted}>
      {clips.length === 0 && (
        <div className="lane-empty">{primary ? 'Program reel' : 'Drop clips here'}</div>
      )}
      {clips.map((clip) => (
        <div
          key={clip.id}
          className="clip"
          data-clip-id={clip.id}
          data-kind={track.type}
          data-primary={primary}
          data-bed={!primary && track.type === 'audio'}
          data-sel={selectedClipIds.includes(clip.id)}
          data-speed={clip.speed !== 1}
          data-effect={clip.effect ?? 'none'}
          data-slug={clip.kind === 'slug' || undefined}
          title={clipLabel(clip, track, assets, words)}
          style={{ left: clip.start * pps, width: Math.max(8, clip.duration * pps) }}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).classList.contains('handle')) return
            onSelect(clip.id, e.shiftKey || e.metaKey || e.ctrlKey)
            if (primary || track.locked) return
            const origin = clip.start
            const originIn = clip.inPoint
            const startX = e.clientX
            const slip = e.altKey
            const slide = e.shiftKey && !e.altKey
            const move = (ev: MouseEvent) => {
              const dt = (ev.clientX - startX) / pps
              if (slip) {
                const live = useEditor
                  .getState()
                  .project.tracks.flatMap((row) => row.clips)
                  .find((row) => row.id === clip.id)
                onSlip(clip.id, originIn + dt * (clip.speed || 1) - (live?.inPoint ?? originIn))
              } else if (slide) onSlide(clip.id, Math.max(0, origin + dt))
              else onMove(clip.id, Math.max(0, origin + dt))
            }
            const up = () => {
              window.removeEventListener('mousemove', move)
              window.removeEventListener('mouseup', up)
            }
            window.addEventListener('mousemove', move)
            window.addEventListener('mouseup', up)
          }}
        >
          {track.type === 'video' && thumbnails && thumbnails.length > 0 && (
            <Filmstrip
              thumbs={thumbnails}
              inPoint={clip.inPoint}
              outPoint={clip.outPoint}
              sourceDuration={sourceDuration}
            />
          )}
          {track.type === 'audio' &&
            (primary ? waveform : clip.assetId ? assets[clip.assetId]?.waveform : undefined)?.length ? (
            <Waveform
              peaks={(primary ? waveform : assets[clip.assetId!]?.waveform) ?? []}
              inPoint={clip.inPoint}
              outPoint={clip.outPoint}
              sourceDuration={primary ? sourceDuration : assets[clip.assetId!]?.duration ?? clip.duration}
            />
          ) : null}
          <span className="clip-label">{clipLabel(clip, track, assets, words)}</span>
          {!track.locked && (
            <>
              <i
                className="handle in"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  const startX = e.clientX
                  const origin = primary ? clip.inPoint : clip.start
                  const roll = e.shiftKey && !primary
                  const move = (ev: MouseEvent) => {
                    const dt = (ev.clientX - startX) / pps
                    if (primary) onTrimPrimary(clip.id, 'in', origin + dt * clip.speed)
                    else if (roll) onRoll(clip.id, 'in', origin + dt)
                    else onTrim(clip.id, 'in', origin + dt)
                  }
                  const up = () => {
                    window.removeEventListener('mousemove', move)
                    window.removeEventListener('mouseup', up)
                  }
                  window.addEventListener('mousemove', move)
                  window.addEventListener('mouseup', up)
                }}
              />
              <i
                className="handle out"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  const startX = e.clientX
                  const origin = primary ? clip.outPoint : clip.start + clip.duration
                  const roll = e.shiftKey && !primary
                  const move = (ev: MouseEvent) => {
                    const dt = (ev.clientX - startX) / pps
                    if (primary) onTrimPrimary(clip.id, 'out', origin + dt * clip.speed)
                    else if (roll) onRoll(clip.id, 'out', origin + dt)
                    else onTrim(clip.id, 'out', origin + dt)
                  }
                  const up = () => {
                    window.removeEventListener('mousemove', move)
                    window.removeEventListener('mouseup', up)
                  }
                  window.addEventListener('mousemove', move)
                  window.addEventListener('mouseup', up)
                }}
              />
            </>
          )}
        </div>
      ))}
    </div>
  )
}

function Filmstrip({
  thumbs,
  inPoint,
  outPoint,
  sourceDuration
}: {
  thumbs: string[]
  inPoint: number
  outPoint: number
  sourceDuration: number
}) {
  const start = Math.floor((inPoint / Math.max(sourceDuration, 0.01)) * thumbs.length)
  const end = Math.ceil((outPoint / Math.max(sourceDuration, 0.01)) * thumbs.length)
  const slice = thumbs.slice(start, Math.max(start + 1, end))
  return (
    <div className="film">
      {slice.map((src, i) => (
        <img key={`${src.slice(-12)}-${i}`} src={src} alt="" />
      ))}
    </div>
  )
}

function Waveform({
  peaks,
  inPoint,
  outPoint,
  sourceDuration
}: {
  peaks: number[]
  inPoint: number
  outPoint: number
  sourceDuration: number
}) {
  const start = Math.floor((inPoint / Math.max(sourceDuration, 0.01)) * peaks.length)
  const end = Math.ceil((outPoint / Math.max(sourceDuration, 0.01)) * peaks.length)
  const slice = peaks.slice(start, Math.max(start + 1, end))
  const d = slice
    .map((p, i) => {
      const x = (i / Math.max(1, slice.length - 1)) * 100
      const y = 18 - p * 16
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')
  return (
    <svg className="wave" viewBox="0 0 100 36" preserveAspectRatio="none">
      <path d={`${d} V 36 H 0 Z`} fill="var(--timeline-wave-fill)" />
      <path d={d} fill="none" stroke="var(--timeline-wave-stroke)" strokeWidth="0.6" />
    </svg>
  )
}
