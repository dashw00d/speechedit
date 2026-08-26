import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type CSSProperties } from 'react'
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
import { REVIEW_RATES, describeReviewRate } from '../lib/reviewRate'
import { settlePreviewSource, type PreviewSourceChoice } from '../lib/previewSource'
import { isZoomClip, ZOOM_SCALES } from '../lib/zoom'
import { isRedactionClip, REDACT_SCALES } from '../lib/redaction'
import { isVerticalFrame, PICTURE_PANS } from '../lib/canvas'
import { copyStillFromContext } from '../lib/still'
import { applyCaptionStyleToAllFromContext, canApplyCaptionStyleAll, styleSourceClip } from '../lib/captionStyle'
import { captionDefaults } from '../lib/theme'
import { clearMarksFromContext } from '../lib/marks'
import { useEditor, usePlayback } from '../store'
import { OverflowMenu } from './OverflowMenu'
import { useEngine } from '../useEngine'
import type { Asset, Crop } from '../types'
import {
  commitPictureText,
  EDIT_PICTURE_TEXT_EVENT,
  pictureTextDraft,
  pictureTextPlaceholder,
  startPictureTextEdit
} from '../lib/pictureText'
import type { GraphLayer } from '../lib/exportGraph'

function useStablePreviewPath(asset: Asset | undefined, proxyFailed: boolean, playing: boolean) {
  const preferredPath = asset?.path
    ? playbackPath(asset, { proxyExists: !proxyFailed })
    : ''
  const next: PreviewSourceChoice = {
    assetId: asset?.id,
    originalPath: asset?.path ?? '',
    sourcePath: preferredPath
  }
  const [choice, setChoice] = useState<PreviewSourceChoice>(next)

  useEffect(() => {
    setChoice((current) => settlePreviewSource(current, next, playing))
  }, [asset?.id, asset?.path, preferredPath, playing])

  return choice.sourcePath
}

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
  const [controlTime, setControlTime] = useState(programTime)
  const reviewRate = usePlayback((s) => s.reviewRate)
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
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null)
  const textCard = Boolean(
    selectedClip?.text && !selectedClip.assetId && selectedClip.text !== 'ZOOM' && selectedClip.text !== 'REDACT'
  )
  const redactOn = isRedactionClip(selectedClip)
  useEffect(() => {
    if (!playing) setControlTime(programTime)
  }, [playing, programTime])
  useEffect(() => {
    setProxyFailed(false)
    setPreviewFailed(false)
  }, [asset?.id, asset?.path, asset?.proxyPath])
  useEffect(() => {
    const onEdit = (event: Event) => {
      const id = (event as CustomEvent<{ clipId?: string }>).detail?.clipId
      if (id) setEditingLayerId(id)
    }
    window.addEventListener(EDIT_PICTURE_TEXT_EVENT, onEdit)
    return () => window.removeEventListener(EDIT_PICTURE_TEXT_EVENT, onEdit)
  }, [])
  useEffect(() => {
    if (!editingLayerId) return
    const visible = look.layers.some((row) => row.layer.id === editingLayerId)
    if (!visible) setEditingLayerId(null)
  }, [look, editingLayerId])
  const outgoingAsset =
    (look.outgoingInput
      ? Object.values(project.assets).find((row) => row.path === look.outgoingInput)
      : undefined) ?? asset
  const previewPath = useStablePreviewPath(asset, proxyFailed, playing)
  const outgoingPreviewPath = useStablePreviewPath(outgoingAsset, proxyFailed, playing)
  const src = previewPath ? mediaUrl(previewPath) : ''
  const underSrc = outgoingPreviewPath ? mediaUrl(outgoingPreviewPath) : src
  const waitingPreview = previewFailed && !asset?.proxyPath && previewUnsafeCodec(asset?.codec)
  const picture = pictureAt(playbackProject, programTime)
  const { gain: volume, ducked, duckAmount, incomingGain } = look.voice
  const captions = look.layers.filter((l) => l.layer.kind === 'caption')
  const overlays = look.layers.filter((l) => l.layer.kind !== 'caption')

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
      video.muted = false
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
        Preview
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
              src={underSrc}
              playsInline
              style={{
                opacity: look.outgoingOpacity,
                objectFit: frame.height > frame.width ? 'cover' : undefined
              }}
            />
            )}
            <video
              ref={videoRef}
              data-monitor-video
              src={src}
              playsInline
              style={{
                transform: cssTransform(picture),
                opacity: look.incomingOpacity,
                transformOrigin: 'center center',
                objectFit: frame.height > frame.width ? 'cover' : undefined,
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
            <span className="voiceprint-label">Audio only</span>
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
        {isVerticalFrame(project) && !editingLayerId && !redactOn && (
          <div
            className="picture-pan"
            data-picture-pan
            title="Drag to pick the face"
            onPointerDown={(event) => {
              event.preventDefault()
              const origin = {
                x: event.clientX,
                y: event.clientY,
                tx: project.picture.x,
                ty: project.picture.y
              }
              const move = (ev: PointerEvent) => {
                dispatch({
                  type: 'setPicture',
                  transform: {
                    x: origin.tx + (ev.clientX - origin.x),
                    y: origin.ty + (ev.clientY - origin.y)
                  }
                })
              }
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          />
        )}
        {overlays.map(({ layer, opacity }) => {
          if (layer.kind === 'blur') {
            const on = Boolean(layer.id && selectedClipId === layer.id)
            return (
              <div
                key={layer.id ?? `${layer.start}-blur`}
                className="redact"
                data-on={on || undefined}
                title={on ? 'Drag over what should stay hidden' : undefined}
                style={{
                  transform: `translate(${sx(layer.x)}, ${sy(layer.y)}) scale(${layer.scale}) rotate(${layer.rotation ?? 0}deg)`,
                  opacity,
                  width: `${Math.max(12, layer.scale * 100)}%`
                }}
                onPointerDown={
                  on && layer.id
                    ? (event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        const stage = (event.currentTarget as HTMLElement).closest('.program-stage')
                        if (!stage) return
                        const box = stage.getBoundingClientRect()
                        const origin = { x: event.clientX, y: event.clientY, tx: layer.x, ty: layer.y }
                        const clipId = layer.id!
                        const move = (ev: PointerEvent) => {
                          const dx = ((ev.clientX - origin.x) / Math.max(1, box.width)) * frame.width
                          const dy = ((ev.clientY - origin.y) / Math.max(1, box.height)) * frame.height
                          dispatch({
                            type: 'setTransform',
                            clipId,
                            transform: { x: origin.tx + dx, y: origin.ty + dy }
                          })
                        }
                        const up = () => {
                          window.removeEventListener('pointermove', move)
                          window.removeEventListener('pointerup', up)
                        }
                        window.addEventListener('pointermove', move)
                        window.addEventListener('pointerup', up)
                      }
                    : undefined
                }
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
            <PictureTextLayer
              key={layer.id ?? `${layer.start}-ov`}
              layer={layer}
              className="overlay-card"
              opacity={opacity}
              editing={Boolean(layer.id && editingLayerId === layer.id)}
              style={{
                transform: `translate(${sx(layer.x)}, ${sy(layer.y)}) scale(${layer.scale}) rotate(${layer.rotation ?? 0}deg)`,
                fontSize: sfont(layer.fontSize),
                color: layer.fill,
                WebkitTextStrokeColor: layer.stroke
              }}
              onToast={onToast}
              onClose={(mode) => {
                setEditingLayerId(null)
                if (mode !== 'keep') useEditor.getState().clearSelection()
              }}
              onAdvance={(clipId) => {
                setEditingLayerId(clipId)
                startPictureTextEdit(clipId)
              }}
              onStart={() => layer.id && startPictureTextEdit(layer.id)}
            />
          )
        })}
        {captions.map(({ layer, opacity }) =>
          layer.text ? (
            <PictureTextLayer
              key={layer.id ?? `${layer.start}-cap`}
              layer={layer}
              className="caption-burn"
              opacity={opacity}
              editing={Boolean(layer.id && editingLayerId === layer.id)}
              style={{
                fontSize: sfont(layer.fontSize),
                textAlign: layer.align,
                color: layer.fill,
                WebkitTextStrokeColor: layer.stroke
              }}
              onToast={onToast}
              onClose={() => {
                setEditingLayerId(null)
                if (layer.position === 'center' || (layer.fontSize ?? 0) >= 56) {
                  useEditor.getState().clearSelection()
                }
              }}
              onStart={() => layer.id && startPictureTextEdit(layer.id)}
            />
          ) : null
        )}
        {look.incoming?.kind === 'slug' && (
          <div className="program-slug" aria-hidden>
            <span>Hold</span>
          </div>
        )}
        {(showSafeZone || (selectedClip && !textCard && !redactOn && !editingLayerId)) && (
          <CropSafeOverlay
            crop={selectedClip?.transform.crop ?? picture.crop}
            showSafe={showSafeZone}
            showCrop={Boolean(selectedClip) && !textCard && !editingLayerId}
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
        <div className="transport-readout">
          <button className="play" onClick={onPlayClick} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? '❙❙' : '▶'}
          </button>
          <span
            className="timecode"
            title={`Source ${formatTimecode(sourceTime, project.fps)}`}
          >
            {formatTimecode(programTime, project.fps)}
            <small>/ {formatTimecode(duration, project.fps)}</small>
          </span>
          <button
            type="button"
            className="vol-readout"
            data-muted={project.audioMaster.muted || undefined}
            title={project.audioMaster.muted ? 'Turn preview sound on' : 'Mute preview sound'}
            aria-label={project.audioMaster.muted ? 'Preview muted. Turn sound on' : 'Preview sound on. Mute'}
            onClick={() =>
              dispatch({ type: 'setAudioMaster', patch: { muted: !project.audioMaster.muted } })
            }
          >
            <span className="audio-meter" title="Program voice level">
              <i style={{ height: `${Math.min(100, Math.max(4, volume * 100))}%` }} data-hot={volume > 0.95 || undefined} />
            </span>
            <span>{project.audioMaster.muted ? 'Muted' : `Sound ${Math.round(project.audioMaster.volume * 100)}%`}</span>
          </button>
          {ducked && (
            <span className="duck-flag" title="Voice is ducked under B-roll">
              duck −{Math.round(duckAmount * 100)}
            </span>
          )}
        </div>
        <div className="transport-context" aria-label="Selected picture controls">
          <ZoomScaleButtons />
          <RedactScaleButtons />
          <TitleLookButtons onToast={onToast} programTime={controlTime} />
          <PicturePanButtons />
        </div>
        <div className="transport-actions">
          <OverflowMenu tone="chip" label={`${reviewRate}×`} title="Playback speed and looping">
            <span className="overflow-section-label">Playback</span>
            <RateButtons inMenu />
            <LoopButton inMenu />
          </OverflowMenu>
          <OverflowMenu
            tone="chip"
            label={hasMarks ? 'Clip marked' : selectedWordIds.length ? 'Selection' : 'Mark clip'}
            title="Choose where a clip starts and ends"
          >
            {(hasMarks || selectedWordIds.length > 0) && (
              <button
                className="overflow-item"
                title={hasMarks ? 'Play from In to Out (P)' : 'Play the selected words (P)'}
                onClick={() => usePlayback.getState().playSelectionOrMarks()}
              >
                {playRangeLabel}
              </button>
            )}
            <MarkButtons inMenu />
            {(project.markIn != null || project.markOut != null) && (
              <button
                className="overflow-item"
                type="button"
                title="Clear In and Out"
                onClick={() => onToast?.(clearMarksFromContext().toast)}
              >
                Clear range
              </button>
            )}
          </OverflowMenu>
          <OverflowMenu tone="chip" label="View" title="Preview display and frame tools">
          <button
            className="overflow-item"
            type="button"
            data-active={showSafeZone}
            title="Title-safe and action-safe boxes. Keep captions inside the inner box."
            onClick={() => setShowSafeZone(!showSafeZone)}
          >
            {showSafeZone ? 'Safe on' : 'Safe'}
          </button>
          <button
            className="overflow-item"
            type="button"
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
          <button
            className="overflow-item"
            type="button"
            title="Copy this picture with the line. Words or a chapter park the frame first."
            onClick={() => void copyStillFromContext(videoRef.current).then((result) => onToast?.(result.toast))}
          >
            Copy frame
          </button>
          <FullScreenButton inMenu />
          </OverflowMenu>
        </div>
        <div className="beds" hidden>
          {(job.beds ?? []).map((bed) => (
            <audio key={bed.id ?? bed.path} data-bed={bed.id ?? bed.path} src={mediaUrl(bed.path)} preload="auto" />
          ))}
        </div>
      </div>
    </section>
  )
}

function PicturePanButtons() {
  const project = useEditor((s) => s.project)
  const dispatch = useEditor((s) => s.dispatch)
  if (!isVerticalFrame(project)) return null
  const x = project.picture.x
  const labels = ['Left', 'Center', 'Right'] as const
  return (
    <span className="rate-chips" data-picture-pan-chips>
      {PICTURE_PANS.map((pan, index) => (
        <button
          key={pan}
          className="chip"
          data-picture-pan={labels[index]}
          data-active={Math.abs(x - pan) < 8 || undefined}
          title={labels[index] === 'Center' ? 'Center the picture' : `Slide the picture ${labels[index].toLowerCase()}`}
          onClick={() => dispatch({ type: 'setPicture', transform: { x: pan, y: 0 } })}
        >
          {labels[index]}
        </button>
      ))}
    </span>
  )
}

function RedactScaleButtons() {
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const project = useEditor((s) => s.project)
  const dispatch = useEditor((s) => s.dispatch)
  const clip = project.tracks.flatMap((track) => track.clips).find((row) => row.id === selectedClipId)
  if (!clip || !isRedactionClip(clip)) return null
  const scale = clip.transform.scale
  return (
    <span className="rate-chips" data-redact-scale>
      {REDACT_SCALES.map((rate) => (
        <button
          key={rate}
          className="chip"
          data-active={Math.abs(scale - rate) < 0.01 || undefined}
          title={rate < 0.26 ? 'Smaller blur' : rate > 0.4 ? 'Larger blur' : 'Default blur'}
          onClick={() => dispatch({ type: 'setTransform', clipId: clip.id, transform: { scale: rate } })}
        >
          {rate < 0.26 ? 'Small' : rate > 0.4 ? 'Large' : 'Med'}
        </button>
      ))}
    </span>
  )
}

function lookSwatch(value: string, fallback: string): string {
  const raw = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw
      .slice(1)
      .split('')
      .map((part) => part + part)
      .join('')}`
  }
  return fallback
}

function TitleLookButtons({
  onToast,
  programTime
}: {
  onToast?: (msg: string) => void
  programTime: number
}) {
  const project = useEditor((s) => s.project)
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const dispatch = useEditor((s) => s.dispatch)
  const clip = styleSourceClip(project, selectedClipId, programTime)
  if (!clip) return null
  const onCard = programTime >= clip.start && programTime < clip.start + clip.duration
  if (!onCard && selectedClipId !== clip.id) return null
  const fill = clip.style?.fill ?? captionDefaults().fill
  const stroke = clip.style?.stroke ?? captionDefaults().stroke
  const canApply = canApplyCaptionStyleAll(project, clip.id, programTime)
  return (
    <span className="rate-chips" data-title-look>
      <label className="look-swatch" title="Fill on this card">
        <input
          type="color"
          aria-label="Fill"
          value={lookSwatch(fill, captionDefaults().fill)}
          onChange={(event) =>
            dispatch({ type: 'setCaptionStyle', clipId: clip.id, style: { fill: event.target.value } })
          }
        />
        Fill
      </label>
      <label className="look-swatch" title="Stroke on this card">
        <input
          type="color"
          aria-label="Stroke"
          value={lookSwatch(stroke, captionDefaults().stroke)}
          onChange={(event) =>
            dispatch({ type: 'setCaptionStyle', clipId: clip.id, style: { stroke: event.target.value } })
          }
        />
        Stroke
      </label>
      {canApply ? (
        <button
          type="button"
          className="chip"
          title="Copy this card’s fill, stroke, and size onto every title. The next card plays."
          onClick={() => onToast?.(applyCaptionStyleToAllFromContext().toast)}
        >
          Apply style
        </button>
      ) : null}
    </span>
  )
}

function ZoomScaleButtons() {
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const project = useEditor((s) => s.project)
  const dispatch = useEditor((s) => s.dispatch)
  const clip = project.tracks.flatMap((track) => track.clips).find((row) => row.id === selectedClipId)
  if (!clip || !isZoomClip(clip)) return null
  const scale = clip.transform.scale
  return (
    <span className="rate-chips" data-zoom-scale>
      {ZOOM_SCALES.map((rate) => (
        <button
          key={rate}
          className="chip"
          data-active={Math.abs(scale - rate) < 0.01 || undefined}
          title={`Punch in at ${rate}×`}
          onClick={() => dispatch({ type: 'setTransform', clipId: clip.id, transform: { scale: rate } })}
        >
          {rate}×
        </button>
      ))}
    </span>
  )
}

function RateButtons({ inMenu = false }: { inMenu?: boolean } = {}) {
  const reviewRate = usePlayback((s) => s.reviewRate)
  const setReviewRate = usePlayback((s) => s.setReviewRate)
  return (
    <span className={inMenu ? 'overflow-section' : 'rate-chips'}>
      {REVIEW_RATES.map((rate) => (
        <button
          key={rate}
          className={inMenu ? 'overflow-item' : 'chip'}
          data-active={reviewRate === rate}
          title={describeReviewRate(rate)}
          onClick={() => setReviewRate(rate)}
        >
          {rate}×
        </button>
      ))}
    </span>
  )
}

function FullScreenButton({ inMenu = false }: { inMenu?: boolean }) {
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
      className={inMenu ? 'overflow-item' : 'chip'}
      data-active={full}
      title="Fill the window with the program (F)"
      onClick={() => setFull((on) => !on)}
    >
      {full ? 'Exit full' : 'Full screen'}
    </button>
  )
}

function LoopButton({ inMenu = false }: { inMenu?: boolean } = {}) {
  const loop = usePlayback((s) => s.loop)
  return (
    <button
      className={inMenu ? 'overflow-item' : 'chip'}
      data-active={loop}
      onClick={() => usePlayback.setState({ loop: !loop })}
      title="Loop the marked range, or the whole reel (/)"
    >
      {loop ? 'Loop on' : 'Loop'}
    </button>
  )
}

function PictureTextLayer({
  layer,
  className,
  opacity,
  editing,
  style,
  onToast,
  onClose,
  onAdvance,
  onStart
}: {
  layer: GraphLayer
  className: string
  opacity: number
  editing: boolean
  style: CSSProperties
  onToast?: (msg: string) => void
  onClose: (mode?: 'keep') => void
  onAdvance?: (clipId: string) => void
  onStart: () => void
}) {
  const cancelRef = useRef(false)
  const placeholder = pictureTextPlaceholder({
    text: layer.text,
    style: { position: layer.position, fontSize: layer.fontSize }
  })

  function finish(draft: string) {
    if (layer.id && !cancelRef.current) {
      const result = commitPictureText(layer.id, draft)
      if (result.toast) onToast?.(result.toast)
      cancelRef.current = false
      if (result.nextClipId) {
        onAdvance?.(result.nextClipId)
        return
      }
      onClose('keep')
      return
    }
    cancelRef.current = false
    onClose()
  }

  return (
    <div
      className={className}
      data-clip-id={layer.id}
      data-pos={layer.position ?? (className === 'caption-burn' ? 'lower' : undefined)}
      data-align={layer.align ?? (className === 'caption-burn' ? 'center' : undefined)}
      data-editing={editing || undefined}
      style={{ ...style, opacity }}
      title={
        layer.id
          ? className === 'overlay-card'
            ? 'Click to type · right-click for Type…'
            : 'Double-click to type · right-click for Type…'
          : undefined
      }
      onClick={(event) => {
        if (className !== 'overlay-card' || !layer.id || editing) return
        event.preventDefault()
        event.stopPropagation()
        onStart()
      }}
      onDoubleClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (layer.id) onStart()
      }}
    >
      {editing && layer.id ? (
        <input
          className="picture-text-edit"
          data-clip-id={layer.id}
          autoFocus
          defaultValue={pictureTextDraft(layer.text)}
          placeholder={placeholder}
          aria-label={placeholder}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => finish(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelRef.current = true
              onClose()
            }
          }}
        />
      ) : (
        layer.text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
          part.startsWith('**') && part.endsWith('**') ? (
            <strong key={i}>{part.slice(2, -2)}</strong>
          ) : (
            <span key={i}>{part}</span>
          )
        )
      )}
    </div>
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

function MarkButtons({ inMenu = false }: { inMenu?: boolean } = {}) {
  const project = useEditor((s) => s.project)
  const programTime = usePlayback((s) => s.programTime)
  const dispatch = useEditor((s) => s.dispatch)
  return (
    <span className={inMenu ? 'overflow-section' : 'marks'}>
      <button
        className={inMenu ? 'overflow-item' : 'chip'}
        title="Mark In at the playhead (I). With words selected, marks the start of the selection."
        onClick={() => dispatch({ type: 'setMarks', markIn: programTime })}
      >
        {project.markIn == null
          ? inMenu ? 'Set start here' : 'Set start'
          : `${inMenu ? 'Move start here' : 'Start'} · ${formatTimecode(project.markIn, project.fps)}`}
      </button>
      <button
        className={inMenu ? 'overflow-item' : 'chip'}
        title="Mark Out at the playhead (O)"
        onClick={() => dispatch({ type: 'setMarks', markOut: programTime })}
      >
        {project.markOut == null
          ? inMenu ? 'Set end here' : 'Set end'
          : `${inMenu ? 'Move end here' : 'End'} · ${formatTimecode(project.markOut, project.fps)}`}
      </button>
    </span>
  )
}
