import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { mediaUrl } from '../host'
import { programFrame } from '../../../shared/mediaOrient'
import { playbackPath, previewUnsafeCodec } from '../../../shared/proxy'
import { programLength } from '../lib/commands'
import { currentWord } from '../lib/edl'
import { projectToExportJob } from '../lib/exportJob'
import { cssTransform } from '../lib/keyframes'
import { projectForPlayback } from '../lib/playbackProject'
import { sampleProgram } from '../lib/programLook'
import { pictureAt } from '../lib/resolver'
import { primaryAssetAt, primaryTakes } from '../lib/takes'
import { formatTimecode } from '../lib/time'
import { ingestDroppedFile } from '../lib/fileActions'
import { useEditor, usePlayback } from '../store'
import { useEngine } from '../useEngine'
import type { Crop } from '../types'

export function Monitor({ onToast }: { onToast?: (msg: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const underRef = useRef<HTMLVideoElement>(null)
  useEngine(videoRef, underRef)
  const project = useEditor((s) => s.project)
  const previewSafeCuts = useEditor((s) => s.previewSafeCuts)
  const showNowWord = useEditor((s) => s.showNowWord)
  const playbackProject = useMemo(
    () => projectForPlayback(project, previewSafeCuts),
    [project, previewSafeCuts]
  )
  const programTime = usePlayback((s) => s.programTime)
  const playing = usePlayback((s) => s.playing)
  const toggle = usePlayback((s) => s.toggle)
  const selectedWordIds = useEditor((s) => s.selectedWordIds)
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const showSafeZone = useEditor((s) => s.showSafeZone)
  const setShowSafeZone = useEditor((s) => s.setShowSafeZone)
  const dispatch = useEditor((s) => s.dispatch)
  const selectedClip = project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId)
  const hasMarks = project.markIn != null && project.markOut != null
  const playRangeLabel = hasMarks ? 'Play marked' : selectedWordIds.length ? 'Play selection' : 'Play marked'
  const job = useMemo(() => projectToExportJob(playbackProject), [playbackProject])
  const look = useMemo(() => sampleProgram(job, programTime), [job, programTime])
  const duration = job.duration && job.duration > 0 ? job.duration : programLength(playbackProject)
  const sourceTime = look.sourceTime
  const word = currentWord(playbackProject.transcript.words, sourceTime)
  const asset =
    (look.incomingInput
      ? Object.values(project.assets).find((row) => row.path === look.incomingInput)
      : undefined) ??
    primaryAssetAt(playbackProject, look.sourceTime) ??
    primaryTakes(project)[0] ??
    Object.values(project.assets)[0]
  const [proxyFailed, setProxyFailed] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [dropHover, setDropHover] = useState(false)
  useEffect(() => {
    setProxyFailed(false)
    setPreviewFailed(false)
  }, [asset?.id, asset?.path, asset?.proxyPath])
  const src = asset?.path ? mediaUrl(playbackPath(asset, { proxyExists: !proxyFailed })) : ''
  const waitingPreview = previewFailed && !asset?.proxyPath && previewUnsafeCodec(asset?.codec)
  const picture = pictureAt(playbackProject, programTime)
  const { gain: volume, ducked, duckAmount, incomingGain } = look.voice
  const captions = look.layers.filter((l) => l.layer.kind === 'caption')
  const overlays = look.layers.filter((l) => l.layer.kind !== 'caption')

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = incomingGain <= 0.0001
    video.volume = Math.min(1, Math.max(0, incomingGain))
  }, [incomingGain])

  const crop = picture.crop
  const angle = useMemo(() => 18 + sourceTime * 37, [sourceTime])
  const frame = programFrame(project.width, project.height)
  const sx = (n: number) => `calc(${n} * 100cqw / ${frame.width})`
  const sy = (n: number) => `calc(${n} * 100cqh / ${frame.height})`
  const sfont = (n: number) => `calc(${n}px * 100cqw / ${frame.width})`

  function onPlayClick() {
    const willPlay = !playing
    const video = videoRef.current
    if (video && willPlay) {
      video.muted = incomingGain <= 0.0001
      video.volume = Math.min(1, Math.max(0, incomingGain))
      void video.play().catch(() => undefined)
    }
    toggle()
  }

  return (
    <section
      className="panel monitor"
      data-drop={dropHover || undefined}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) setDropHover(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropHover(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDropHover(false)
        const file = e.dataTransfer.files[0]
        if (file) {
          void ingestDroppedFile(file, onToast ?? (() => undefined)).catch((err) => {
            onToast?.(err instanceof Error ? err.message : 'Could not open that file.')
          })
        }
      }}
    >
      <div className="panel-head">
        Program
        <span>
          {project.name}
          {look.incoming && look.incoming.speed !== 1 ? ` · ${look.incoming.speed}×` : ''}
        </span>
      </div>
      <div className="crt">
        <div
          className="program-stage"
          data-orient={frame.orientation}
          data-size={`${frame.width}x${frame.height}`}
          style={{
            aspectRatio: `${frame.width} / ${frame.height}`,
            width: `min(100%, calc(100cqh * ${frame.width} / ${frame.height}))`,
            height: `min(100%, calc(100cqw * ${frame.height} / ${frame.width}))`
          }}
        >
        {src ? (
          <>
            {look.outgoing && (
              <video
                ref={underRef}
                className="dissolve-under"
                src={src}
                muted={look.voice.outgoingGain <= 0.0001}
                playsInline
                style={{ opacity: look.outgoingOpacity }}
              />
            )}
            <video
              ref={videoRef}
              src={src}
              muted={incomingGain <= 0.0001}
              playsInline
              style={{
                transform: cssTransform(picture),
                opacity: look.incomingOpacity,
                transformOrigin: 'center center',
                clipPath: `inset(${(crop?.y ?? 0) * 100}% ${(1 - (crop?.x ?? 0) - (crop?.w ?? 1)) * 100}% ${(1 - (crop?.y ?? 0) - (crop?.h ?? 1)) * 100}% ${(crop?.x ?? 0) * 100}%)`
              }}
              onPlay={() => usePlayback.setState({ playing: true })}
              onPause={() => {
                if (usePlayback.getState().playing) return
                usePlayback.setState({ playing: false })
              }}
              onError={() => {
                if (asset?.proxyPath && !proxyFailed) setProxyFailed(true)
                else setPreviewFailed(true)
              }}
            />
          </>
        ) : (
          <>
          <div className="voiceprint" style={{ transform: cssTransform(picture), opacity: picture.opacity }}>
            <div className="ring" />
            <div className="ring" />
            <div className="ring" />
            <div className="needle" style={{ transform: `translate(-50%, -100%) rotate(${angle}deg)` }} />
          </div>
          <p className="monitor-hint">
            {project.transcript.words.length
              ? 'Audio-only preview — picture unavailable in this session.'
              : dropHover
                ? 'Drop a recording, project, or transcript.'
                : 'Open media — or drop a recording here.'}
          </p>
          </>
        )}
        {overlays.map(({ layer, opacity }) => {
          if (layer.kind === 'blur') {
            return (
              <div
                key={layer.id ?? `${layer.start}-blur`}
                className="redact"
                style={{
                  transform: `translate(${sx(layer.x)}, ${sy(layer.y)}) scale(${layer.scale}) rotate(${layer.rotation ?? 0}deg)`,
                  opacity,
                  width: `${Math.max(12, layer.scale * 100)}%`
                }}
              />
            )
          }
          if (layer.kind === 'image' && layer.path) {
            const media = Object.values(project.assets).find((a) => a.path === layer.path)
            const url = mediaUrl(media ? playbackPath(media) : layer.path)
            const xf = `translate(${sx(layer.x)}, ${sy(layer.y)}) scale(${layer.scale}) rotate(${layer.rotation ?? 0}deg)`
            return layer.loop ? (
              <img
                key={layer.id ?? layer.path}
                className="broll"
                src={url}
                alt={layer.text}
                style={{ transform: xf, opacity }}
              />
            ) : (
              <video
                key={layer.id ?? layer.path}
                data-overlay={layer.id}
                className="broll"
                src={url}
                muted
                playsInline
                style={{ transform: xf, opacity }}
              />
            )
          }
          if (!layer.text) return null
          return (
            <div
              key={layer.id ?? `${layer.start}-ov`}
              className="overlay-card"
              style={{
                transform: `translate(${sx(layer.x)}, ${sy(layer.y)}) scale(${layer.scale}) rotate(${layer.rotation ?? 0}deg)`,
                opacity,
                fontSize: sfont(layer.fontSize),
                color: layer.fill,
                WebkitTextStrokeColor: layer.stroke
              }}
            >
              {layer.text}
            </div>
          )
        })}
        {captions.map(({ layer, opacity }) =>
          layer.text ? (
            <div
              key={layer.id ?? `${layer.start}-cap`}
              className="caption-burn"
              data-pos={layer.position ?? 'lower'}
              data-align={layer.align ?? 'center'}
              style={{
                fontSize: sfont(layer.fontSize),
                textAlign: layer.align,
                color: layer.fill,
                WebkitTextStrokeColor: layer.stroke,
                opacity
              }}
            >
              {layer.text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
                part.startsWith('**') && part.endsWith('**') ? (
                  <strong key={i}>{part.slice(2, -2)}</strong>
                ) : (
                  <span key={i}>{part}</span>
                )
              )}
            </div>
          ) : null
        )}
        {look.incoming?.kind === 'slug' && (
          <div className="program-slug" aria-hidden>
            <span>Hold</span>
          </div>
        )}
        {(showSafeZone || selectedClip) && (
          <CropSafeOverlay
            crop={selectedClip?.transform.crop ?? picture.crop}
            showSafe={showSafeZone}
            showCrop={Boolean(selectedClip)}
            onCrop={(next) => {
              if (selectedClip) dispatch({ type: 'setTransform', clipId: selectedClip.id, transform: { crop: next } })
              else dispatch({ type: 'setPicture', transform: { crop: next } })
            }}
          />
        )}
        </div>
        {waitingPreview && (
          <p className="monitor-hint">Building a preview this screen can play…</p>
        )}
        {showNowWord && word && captions.length === 0 && <div className="now-word">{word.text}</div>}
      </div>
      <div className="transport">
        <button className="play" onClick={onPlayClick} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❙❙' : '▶'}
        </button>
        <span className="timecode">
          {formatTimecode(programTime, project.fps)}
          <small>/ {formatTimecode(duration, project.fps)}</small>
        </span>
        <span>src {formatTimecode(sourceTime, project.fps)}</span>
        <span className="vol-readout">
          vol {Math.round(volume * 100)}
          <span className="audio-meter" title="Program voice level">
            <i style={{ height: `${Math.min(100, Math.max(4, volume * 100))}%` }} data-hot={volume > 0.95 || undefined} />
          </span>
        </span>
        <button
          className="chip"
          data-active={showSafeZone}
          title="Title-safe and action-safe boxes. Keep captions inside the inner box."
          onClick={() => setShowSafeZone(!showSafeZone)}
        >
          {showSafeZone ? 'Safe on' : 'Safe'}
        </button>
        <button
          className="chip"
          title="Find this frame in the script (match frame)"
          onClick={() => {
            const hit = currentWord(project.transcript.words, sourceTime)
            if (hit) {
              useEditor.getState().selectWords([hit.id])
              useEditor.getState().setFollowPlayhead(true)
            }
            onToast?.(
              hit
                ? `Match · “${hit.text}” at source ${formatTimecode(sourceTime, project.fps)}`
                : `Match · source ${formatTimecode(sourceTime, project.fps)}`
            )
          }}
        >
          Match
        </button>
        {ducked && (
          <span className="duck-flag" title="Voice is ducked under B-roll">
            duck −{Math.round(duckAmount * 100)}
          </span>
        )}
        <RateButtons />
        <LoopButton />
        <FullScreenButton />
        <button
          className="chip"
          title={
            hasMarks
              ? 'Play from In to Out (P)'
              : selectedWordIds.length
                ? 'Play the selected words (P)'
                : 'Set In and Out, or select words, then play (P)'
          }
          onClick={() => usePlayback.getState().playSelectionOrMarks()}
        >
          {playRangeLabel}
        </button>
        <MarkButtons />
        <div className="beds" hidden>
          {(job.beds ?? []).map((bed) => (
            <audio key={bed.id ?? bed.path} data-bed={bed.id ?? bed.path} src={mediaUrl(bed.path)} preload="auto" />
          ))}
        </div>
      </div>
    </section>
  )
}

function RateButtons() {
  const reviewRate = usePlayback((s) => s.reviewRate)
  const setReviewRate = usePlayback((s) => s.setReviewRate)
  return (
    <span className="marks">
      {([0.5, 1, 2] as const).map((rate) => (
        <button
          key={rate}
          className="chip"
          data-active={reviewRate === rate}
          title={rate === 1 ? 'Play at normal speed' : `Review at ${rate}×`}
          onClick={() => setReviewRate(rate)}
        >
          {rate}×
        </button>
      ))}
    </span>
  )
}

function FullScreenButton() {
  const [full, setFull] = useState(false)
  useEffect(() => {
    const panel = document.querySelector('.monitor')
    if (panel) panel.toggleAttribute('data-full', full)
  }, [full])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA'
      if (typing || e.metaKey || e.ctrlKey) return
      if (e.key === 'f' || e.key === 'F') {
        if (e.target instanceof HTMLElement && e.target.closest('.transcript')) return
        e.preventDefault()
        setFull((on) => !on)
      }
      if (e.key === 'Escape' && full) setFull(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])
  return (
    <button
      className="chip"
      data-active={full}
      title="Fill the window with the program (F)"
      onClick={() => setFull((on) => !on)}
    >
      {full ? 'Exit full' : 'Full screen'}
    </button>
  )
}

function LoopButton() {
  const loop = usePlayback((s) => s.loop)
  return (
    <button
      className="chip"
      data-active={loop}
      onClick={() => usePlayback.setState({ loop: !loop })}
      title="Loop the marked range, or the whole reel (/)"
    >
      {loop ? 'Loop on' : 'Loop'}
    </button>
  )
}

function CropSafeOverlay({
  crop,
  showSafe,
  showCrop,
  onCrop
}: {
  crop: Crop
  showSafe: boolean
  showCrop: boolean
  onCrop: (crop: Crop) => void
}) {
  const origin = useRef<{ edge: string; x: number; y: number; crop: Crop } | null>(null)

  function startDrag(edge: string, e: ReactPointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const stage = (e.currentTarget as HTMLElement).closest('.program-stage')
    if (!stage) return
    origin.current = { edge, x: e.clientX, y: e.clientY, crop: { ...crop } }
    const move = (ev: PointerEvent) => {
      if (!origin.current) return
      const box = stage.getBoundingClientRect()
      const dx = (ev.clientX - origin.current.x) / Math.max(1, box.width)
      const dy = (ev.clientY - origin.current.y) / Math.max(1, box.height)
      const next = { ...origin.current.crop }
      if (origin.current.edge.includes('w')) {
        const x = Math.min(0.7, Math.max(0, origin.current.crop.x + dx))
        next.w = Math.max(0.2, origin.current.crop.w + (origin.current.crop.x - x))
        next.x = x
      }
      if (origin.current.edge.includes('e')) next.w = Math.max(0.2, Math.min(1 - next.x, origin.current.crop.w + dx))
      if (origin.current.edge.includes('n')) {
        const y = Math.min(0.7, Math.max(0, origin.current.crop.y + dy))
        next.h = Math.max(0.2, origin.current.crop.h + (origin.current.crop.y - y))
        next.y = y
      }
      if (origin.current.edge.includes('s')) next.h = Math.max(0.2, Math.min(1 - next.y, origin.current.crop.h + dy))
      onCrop(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      origin.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="program-guides" aria-hidden>
      {showSafe && (
        <>
          <div className="safe-box action" />
          <div className="safe-box title" />
        </>
      )}
      {showCrop && (
        <div
          className="crop-box"
          style={{
            left: `${(crop.x ?? 0) * 100}%`,
            top: `${(crop.y ?? 0) * 100}%`,
            width: `${(crop.w ?? 1) * 100}%`,
            height: `${(crop.h ?? 1) * 100}%`
          }}
        >
          {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((edge) => (
            <i key={edge} className={`crop-handle ${edge}`} onPointerDown={(e) => startDrag(edge, e)} />
          ))}
        </div>
      )}
    </div>
  )
}

function MarkButtons() {
  const project = useEditor((s) => s.project)
  const programTime = usePlayback((s) => s.programTime)
  const dispatch = useEditor((s) => s.dispatch)
  return (
    <span className="marks">
      <button
        className="chip"
        title="Mark In at the playhead (I). With words selected, marks the start of the selection."
        onClick={() => dispatch({ type: 'setMarks', markIn: programTime })}
      >
        In {project.markIn == null ? '—' : formatTimecode(project.markIn, project.fps)}
      </button>
      <button
        className="chip"
        title="Mark Out at the playhead (O)"
        onClick={() => dispatch({ type: 'setMarks', markOut: programTime })}
      >
        Out {project.markOut == null ? '—' : formatTimecode(project.markOut, project.fps)}
      </button>
    </span>
  )
}
