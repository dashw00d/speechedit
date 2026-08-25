import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { isPrimaryLane, primarySegments, programLength } from '../lib/commands'
import { wordsInRange } from '../lib/edl'
import { programToSourceOf, snapSourceTime, snapTime, sourceToProgramOf } from '../lib/resolver'
import { buildEditBlocks, editBlockCounts, filterEditBlocks, type EditBlock, type EditBlockFilter } from '../lib/timelineEdits'
import { findRevealableStackTrack } from '../lib/timelineTracks'
import { formatClock } from '../lib/time'
import { useEditor, usePlayback } from '../store'
import type { Asset, Clip, TagKind, Track, Word } from '../types'

const PPS_MIN = 18
const PPS_MAX = 280
const LABEL_WIDTH = 112

export function Timeline() {
  const project = useEditor((s) => s.project)
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const selectClip = useEditor((s) => s.selectClip)
  const selectSuggestion = useEditor((s) => s.selectSuggestion)
  const selectGap = useEditor((s) => s.selectGap)
  const selectWords = useEditor((s) => s.selectWords)
  const dispatch = useEditor((s) => s.dispatch)
  const snap = useEditor((s) => s.snap)
  const setSnap = useEditor((s) => s.setSnap)
  const tool = useEditor((s) => s.tool)
  const guardKind = useEditor((s) => s.guardKind)
  const setTool = useEditor((s) => s.setTool)
  const setGuardKind = useEditor((s) => s.setGuardKind)
  const [stroke, setStroke] = useState<{ start: number; end: number; erase: boolean; kind: TagKind } | null>(
    null
  )
  const programTime = usePlayback((s) => s.programTime)
  const pps = usePlayback((s) => s.pixelsPerSecond)
  const seekProgram = usePlayback((s) => s.seekProgram)
  const setPps = usePlayback((s) => s.setPixelsPerSecond)

  const duration = Math.max(programLength(project), 8)
  const width = Math.max(duration * pps + 80, 800)
  const segments = primarySegments(project)
  const asset = Object.values(project.assets)[0]
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingZoomRef = useRef<
    { mode: 'anchor'; viewX: number } | { mode: 'center' } | null
  >(null)
  const [scrollTick, setScrollTick] = useState(0)
  const [fitPps, setFitPps] = useState(60)
  const [editFilter, setEditFilter] = useState<EditBlockFilter>('all')
  const editBlocks = useMemo(() => buildEditBlocks(project), [project])
  const editCounts = useMemo(() => editBlockCounts(editBlocks), [editBlocks])
  const filteredEditBlocks = useMemo(() => filterEditBlocks(editBlocks, editFilter), [editBlocks, editFilter])
  const showEditFilters = editBlocks.length > 8
  const showEditSummary = editBlocks.length > 10
  const visibleTracks = useMemo(() => project.tracks.filter((track) => !track.hidden), [project.tracks])

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
      const next = Math.min(
        PPS_MAX,
        Math.max(PPS_MIN, (scroll.clientWidth - LABEL_WIDTH - 48) / Math.max(duration, 0.5))
      )
      setFitPps(next)
    }
    updateFit()
    const ro = new ResizeObserver(updateFit)
    ro.observe(scroll)
    return () => ro.disconnect()
  }, [duration])

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
  const overlayLeft = LABEL_WIDTH + programTime * pps - scrollLeft
  const overlayLeftAt = (t: number) => LABEL_WIDTH + t * pps - scrollLeft

  function startPaint(clientX: number, opts: { erase: boolean; shift: boolean }) {
    const t0 = timeAt(clientX)
    const kind: TagKind = opts.shift || guardKind === 'demo' ? 'demo' : 'keep'
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
      else dispatch({ type: 'addTag', start, end, kind })
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
      const ids = project.transcript.words
        .filter((w) => w.start >= scene.start && w.end <= scene.end)
        .map((w) => w.id)
      if (ids.length) selectWords(ids)
    }
  }

  const zoomPct = Math.round((pps / fitPps) * 100)

  return (
    <section className="timeline-panel">
      <header className="timeline-toolbar">
        <div className="timeline-toolbar-group">
          <button className="timeline-btn" type="button" title="Zoom out" onClick={() => zoomAroundPlayhead(pps - 12)}>
            −
          </button>
          <input
            className="timeline-zoom"
            type="range"
            min={PPS_MIN}
            max={PPS_MAX}
            value={pps}
            onChange={(e) => zoomAroundPlayhead(Number(e.target.value))}
            title={`Zoom ${zoomPct}%`}
          />
          <button className="timeline-btn" type="button" title="Zoom in" onClick={() => zoomAroundPlayhead(pps + 12)}>
            +
          </button>
          <span className="timeline-zoom-label">{zoomPct}%</span>
          <button className="timeline-btn" type="button" onClick={fitTape}>
            Fit
          </button>
        </div>
        <div className="timeline-toolbar-group">
          <button
            className="timeline-btn"
            type="button"
            data-active={snap}
            onClick={() => setSnap(!snap)}
            title="Snap playhead and trims to words and clip edges"
          >
            Snap
          </button>
          <button
            className="timeline-btn"
            type="button"
            data-active={tool === 'guard'}
            onClick={() => setTool(tool === 'guard' ? 'select' : 'guard')}
            title="Paint keep/demo guards on the Edits lane"
          >
            Guard
          </button>
          {tool === 'guard' && (
            <>
              <button
                className="timeline-btn"
                type="button"
                data-active={guardKind === 'keep'}
                onClick={() => setGuardKind('keep')}
              >
                Keep
              </button>
              <button
                className="timeline-btn"
                type="button"
                data-active={guardKind === 'demo'}
                onClick={() => setGuardKind('demo')}
              >
                Demo
              </button>
            </>
          )}
        </div>
        {showEditSummary && (
          <div className="timeline-toolbar-group edit-summary" title="Edits lane totals">
            {editCounts.pending} open · {editCounts.applied} applied · {editCounts.scenes} scenes · {editCounts.guards}{' '}
            guards
          </div>
        )}
        {showEditFilters && (
          <div className="timeline-toolbar-group edit-filters">
            {(
              [
                ['all', 'All'],
                ['pending', 'Open'],
                ['applied', 'Applied'],
                ['scenes', 'Scenes'],
                ['guards', 'Guards']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="edit-filter"
                data-active={editFilter === id}
                title={`Show ${label.toLowerCase()} markers on the Edits lane`}
                onClick={() => setEditFilter(id)}
              >
                {label}
                {editCounts[id] > 0 ? ` ${editCounts[id]}` : ''}
              </button>
            ))}
          </div>
        )}
        <div className="timeline-toolbar-group">
          <button
            className="timeline-btn"
            type="button"
            onClick={() => revealOrAddTrack('overlay')}
          >
            + Overlay
          </button>
          <button
            className="timeline-btn"
            type="button"
            onClick={() => dispatch({ type: 'addTrack', trackType: 'audio' })}
          >
            + Audio
          </button>
          <button
            className="timeline-btn"
            type="button"
            onClick={() => revealOrAddTrack('caption')}
          >
            + Captions
          </button>
          {io && (
            <button
              className="timeline-btn"
              type="button"
              title="Ripple-delete the I/O range"
              onClick={() => dispatch({ type: 'rippleDeleteMarks' })}
            >
              Ripple I/O
            </button>
          )}
        </div>
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
                  title="I/O · Delete ripples this range"
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
                stroke={stroke}
                onBlockClick={onEditBlockClick}
              />
            </div>
          </div>

          {visibleTracks.map((track) => (
            <div key={track.id} className="timeline-row">
              <TrackLabel
                track={track}
                primary={isPrimaryLane(track)}
                onFlag={(patch) => dispatch({ type: 'setTrackFlag', trackId: track.id, patch })}
                onRename={(name) => dispatch({ type: 'setTrackFlag', trackId: track.id, patch: { name } })}
                onRemove={() => dispatch({ type: 'removeTrack', trackId: track.id })}
              />
              <div className="timeline-lane-col" style={{ width }}>
                <Lane
                  track={track}
                  segments={segments}
                  pps={pps}
                  selectedClipId={selectedClipId}
                  waveform={asset?.waveform}
                  assets={project.assets}
                  thumbnails={asset?.thumbnails}
                  sourceDuration={project.sourceDuration}
                  words={project.transcript.words}
                  onSelect={selectClip}
                  onMove={(clipId, start) =>
                    dispatch({
                      type: 'moveClip',
                      clipId,
                      start: snap ? snapTime(project, start, [programTime]) : start
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
  onRemove
}: {
  track: Track
  primary: boolean
  onFlag: (patch: Partial<Pick<Track, 'muted' | 'hidden' | 'locked'>>) => void
  onRename: (name: string) => void
  onRemove: () => void
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
          {track.name}
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
          M
        </button>
        <button
          className="track-flag"
          type="button"
          data-active={track.hidden}
          title={track.hidden ? 'Show track on timeline' : 'Hide — collapse this track from the timeline'}
          aria-label={track.hidden ? 'Show track' : 'Hide track'}
          onClick={() => onFlag({ hidden: !track.hidden })}
        >
          H
        </button>
        <button
          className="track-flag"
          type="button"
          data-active={track.locked}
          title={track.locked ? 'Unlock — allow moving and trimming clips' : 'Lock — prevent moving or trimming clips'}
          aria-label={track.locked ? 'Unlock track' : 'Lock track'}
          onClick={() => onFlag({ locked: !track.locked })}
        >
          L
        </button>
        {canRemove && (
          <button className="track-flag track-remove" type="button" title="Remove empty track" onClick={onRemove}>
            ×
          </button>
        )}
      </span>
    </div>
  )
}

function EditsLane({
  pps,
  blocks,
  totalCount,
  stroke,
  onBlockClick
}: {
  pps: number
  blocks: EditBlock[]
  totalCount: number
  stroke: { start: number; end: number; erase: boolean; kind: TagKind } | null
  onBlockClick: (block: EditBlock, e: ReactMouseEvent) => void
}) {
  const left = stroke ? Math.min(stroke.start, stroke.end) * pps : 0
  const width = stroke ? Math.max(4, Math.abs(stroke.end - stroke.start) * pps) : 0

  return (
    <div
      className="lane edits-lane"
      title="Guards, pending edits, and applied cuts · drag to paint keep/demo · Alt-drag erases"
    >
      {totalCount === 0 && !stroke && <div className="edits-hint">Guards · suggestions · scenes</div>}
      {totalCount > 0 && blocks.length === 0 && !stroke && (
        <div className="edits-hint">No markers match this filter</div>
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
  selectedClipId,
  waveform,
  assets,
  thumbnails,
  sourceDuration,
  words,
  onSelect,
  onMove,
  onTrim,
  onTrimPrimary
}: {
  track: Track
  segments: Clip[]
  pps: number
  selectedClipId: string | null
  waveform?: number[]
  assets: Record<string, Asset>
  thumbnails?: string[]
  sourceDuration: number
  words: Word[]
  onSelect: (id: string) => void
  onMove: (clipId: string, start: number) => void
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
          data-sel={selectedClipId === clip.id}
          data-speed={clip.speed !== 1}
          data-effect={clip.effect ?? 'none'}
          title={clipLabel(clip, track, assets, words)}
          style={{ left: clip.start * pps, width: Math.max(8, clip.duration * pps) }}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).classList.contains('handle')) return
            onSelect(clip.id)
            if (primary || track.locked) return
            const origin = clip.start
            const startX = e.clientX
            const move = (ev: MouseEvent) => {
              const dt = (ev.clientX - startX) / pps
              onMove(clip.id, Math.max(0, origin + dt))
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
                  const move = (ev: MouseEvent) => {
                    const dt = (ev.clientX - startX) / pps
                    if (primary) onTrimPrimary(clip.id, 'in', origin + dt * clip.speed)
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
                  const move = (ev: MouseEvent) => {
                    const dt = (ev.clientX - startX) / pps
                    if (primary) onTrimPrimary(clip.id, 'out', origin + dt * clip.speed)
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
