import { useMemo, useRef, useState } from 'react'
import { isPrimaryLane, primarySegments, programLength } from '../lib/commands'
import { programToSourceOf, snapTime, sourceToProgramOf } from '../lib/resolver'
import { formatClock } from '../lib/time'
import { useEditor, usePlayback } from '../store'
import type { Asset, Clip, RangeTag, TagKind, Track } from '../types'

export function Timeline() {
  const project = useEditor((s) => s.project)
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const selectClip = useEditor((s) => s.selectClip)
  const selectSuggestion = useEditor((s) => s.selectSuggestion)
  const dispatch = useEditor((s) => s.dispatch)
  const snap = useEditor((s) => s.snap)
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
  const tapeRef = useRef<HTMLDivElement>(null)

  const ticks = useMemo(() => {
    const step = pps > 100 ? 1 : pps > 50 ? 2 : 5
    const out: number[] = []
    for (let t = 0; t <= duration; t += step) out.push(t)
    return out
  }, [duration, pps])

  function timeAt(clientX: number): number {
    const tape = tapeRef.current
    if (!tape) return 0
    const x = clientX - tape.getBoundingClientRect().left + tape.scrollLeft
    const raw = Math.max(0, x / pps)
    return snap ? snapTime(project, raw, [programTime]) : raw
  }

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

  return (
    <section className="timeline-shell">
      <div className="track-labels">
        <div className="ruler-gutter">
          <button className="chip" onClick={() => setPps(72)}>
            Fit
          </button>
          <button className="chip" onClick={() => dispatch({ type: 'addTrack', trackType: 'overlay' })}>
            +V
          </button>
          <button className="chip" onClick={() => dispatch({ type: 'addTrack', trackType: 'audio' })}>
            +A
          </button>
          <button className="chip" data-active={tool === 'guard'} onClick={() => setTool(tool === 'guard' ? 'select' : 'guard')}>
            Guard
          </button>
        </div>
        <div className="track-label" data-kind="guard">
          Guard
          <button
            className="chip"
            data-active={guardKind === 'keep'}
            onClick={() => setGuardKind('keep')}
          >
            Keep
          </button>
          <button
            className="chip"
            data-active={guardKind === 'demo'}
            onClick={() => setGuardKind('demo')}
          >
            Demo
          </button>
        </div>
        {project.tracks.map((track) => (
          <div key={track.id} className="track-label" data-kind={track.type}>
            {track.name.split(' ')[0]}
          </div>
        ))}
      </div>
      <div
        className="tape"
        ref={tapeRef}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            setPps(pps + (e.deltaY > 0 ? -8 : 8))
          }
        }}
        data-tool={tool}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('.clip, .handle, .guard-block')) return
          const onGuard = Boolean((e.target as HTMLElement).closest('.guard-lane'))
          if (tool !== 'guard' && !onGuard) return
          e.preventDefault()
          startPaint(e.clientX, { erase: e.altKey, shift: e.shiftKey })
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('.clip, .guard-lane, .guard-block')) return
          if (tool === 'guard') return
          seekProgram(timeAt(e.clientX))
        }}
      >
        <div style={{ width, position: 'relative', minHeight: '100%' }}>
          <div className="ruler">
            {ticks.map((t) => (
              <div key={t} className="tick" style={{ left: t * pps }}>
                {formatClock(t)}
              </div>
            ))}
            {project.markIn != null && <div className="io in" style={{ left: project.markIn * pps }} />}
            {project.markOut != null && <div className="io out" style={{ left: project.markOut * pps }} />}
            {project.tags.map((tag) => {
              const start = sourceToProgramOf(project, tag.start)
              const end = sourceToProgramOf(project, tag.end)
              return (
                <div
                  key={tag.id}
                  className="tag-mark"
                  data-kind={tag.kind}
                  title={tag.label}
                  style={{ left: start * pps, width: Math.max(8, (end - start) * pps) }}
                />
              )
            })}
            {project.suggestions
              .filter((s) => !s.applied)
              .map((s) => {
                const start = sourceToProgramOf(project, s.start)
                const end = sourceToProgramOf(project, s.end)
                return (
                  <button
                    key={s.id}
                    className="sug-mark"
                    data-safe={s.safe}
                    data-type={s.type}
                    style={{ left: start * pps, width: Math.max(4, (end - start) * pps) }}
                    onClick={(e) => {
                      e.stopPropagation()
                      selectSuggestion(s.id)
                      seekProgram(start)
                    }}
                  />
                )
              })}
          </div>

          <GuardLane
            pps={pps}
            tags={project.tags}
            stroke={stroke}
            onRemove={(tagId) => dispatch({ type: 'removeTag', tagId })}
            toProgram={(source) => sourceToProgramOf(project, source)}
          />

          {project.tracks.map((track) => (
            <Lane
              key={track.id}
              track={track}
              segments={segments}
              pps={pps}
              selectedClipId={selectedClipId}
              waveform={asset?.waveform}
              assets={project.assets}
              thumbnails={asset?.thumbnails}
              sourceDuration={project.sourceDuration}
              onSelect={selectClip}
              onMove={(clipId, start) =>
                dispatch({
                  type: 'moveClip',
                  clipId,
                  start: snap ? snapTime(project, start, [programTime]) : start
                })
              }
              onTrim={(clipId, edge, time) => dispatch({ type: 'trimClip', clipId, edge, time })}
              onTrimPrimary={(segmentId, edge, sourceTime) =>
                dispatch({ type: 'trimPrimary', segmentId, edge, sourceTime })
              }
            />
          ))}

          <div className="playhead" style={{ left: programTime * pps }} />
        </div>
      </div>
    </section>
  )
}

function GuardLane({
  pps,
  tags,
  stroke,
  onRemove,
  toProgram
}: {
  pps: number
  tags: RangeTag[]
  stroke: { start: number; end: number; erase: boolean; kind: TagKind } | null
  onRemove: (tagId: string) => void
  toProgram: (source: number) => number
}) {
  const left = stroke ? Math.min(stroke.start, stroke.end) * pps : 0
  const width = stroke ? Math.max(4, Math.abs(stroke.end - stroke.start) * pps) : 0
  return (
    <div className="lane guard-lane" title="Drag to paint a guard. Alt-drag erases. Shift = silent demo.">
      {tags
        .filter((t) => t.kind === 'keep' || t.kind === 'demo')
        .map((tag) => {
          const start = toProgram(tag.start)
          const end = toProgram(tag.end)
          return (
            <button
              key={tag.id}
              className="guard-block"
              data-kind={tag.kind}
              style={{ left: start * pps, width: Math.max(10, (end - start) * pps) }}
              title={`${tag.label} · click to remove`}
              onClick={(e) => {
                e.stopPropagation()
                onRemove(tag.id)
              }}
            >
              {tag.kind}
            </button>
          )
        })}
      {stroke && (
        <div
          className="guard-block preview"
          data-kind={stroke.kind}
          data-erase={stroke.erase}
          style={{ left, width }}
        />
      )}
    </div>
  )
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
  onSelect: (id: string) => void
  onMove: (clipId: string, start: number) => void
  onTrim: (clipId: string, edge: 'in' | 'out', time: number) => void
  onTrimPrimary: (segmentId: string, edge: 'in' | 'out', sourceTime: number) => void
}) {
  const primary = isPrimaryLane(track)
  const clips = primary ? segments : track.clips

  return (
    <div className="lane">
      {clips.map((clip) => (
        <div
          key={clip.id}
          className="clip"
          data-kind={track.type}
          data-sel={selectedClipId === clip.id}
          data-speed={clip.speed !== 1}
          data-effect={clip.effect ?? 'none'}
          style={{ left: clip.start * pps, width: Math.max(8, clip.duration * pps) }}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).classList.contains('handle')) return
            onSelect(clip.id)
            if (primary) return
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
          <span>
            {track.type === 'video'
              ? `${formatClock(clip.inPoint)}–${formatClock(clip.outPoint)}${clip.speed !== 1 ? ` ${clip.speed}×` : ''}`
              : clip.effect === 'blur'
                ? 'REDACT'
                : (clip.text ?? track.name)}
          </span>
          <i
            className="handle in"
            onMouseDown={(e) => {
              e.stopPropagation()
              const startX = e.clientX
              const origin = primary ? clip.inPoint : clip.start
              const move = (ev: MouseEvent) => {
                const dt = (ev.clientX - startX) / pps
                if (primary) {
                  onTrimPrimary(clip.id, 'in', origin + dt * clip.speed)
                } else {
                  onTrim(clip.id, 'in', origin + dt)
                }
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
                if (primary) {
                  onTrimPrimary(clip.id, 'out', origin + dt * clip.speed)
                } else {
                  onTrim(clip.id, 'out', origin + dt)
                }
              }
              const up = () => {
                window.removeEventListener('mousemove', move)
                window.removeEventListener('mouseup', up)
              }
              window.addEventListener('mousemove', move)
              window.addEventListener('mouseup', up)
            }}
          />
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
      <path d={`${d} V 36 H 0 Z`} fill="rgba(125,190,106,0.35)" />
      <path d={d} fill="none" stroke="#7dbe6a" strokeWidth="0.6" />
    </svg>
  )
}
