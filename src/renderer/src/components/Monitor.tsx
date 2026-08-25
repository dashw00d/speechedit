import { useEffect, useMemo, useRef } from 'react'
import { mediaUrl } from '../host'
import { programLength } from '../lib/commands'
import { currentWord } from '../lib/edl'
import { audioBeds, duckGainAt } from '../lib/exportJob'
import { cssTransform, fadeGain } from '../lib/keyframes'
import { pictureAt, programToSourceOf, segmentAtProgram, segmentsAtProgram } from '../lib/resolver'
import { formatTimecode } from '../lib/time'
import { useEditor, usePlayback } from '../store'
import { useEngine } from '../useEngine'

export function Monitor() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const underRef = useRef<HTMLVideoElement>(null)
  useEngine(videoRef, underRef)
  const project = useEditor((s) => s.project)
  const programTime = usePlayback((s) => s.programTime)
  const playing = usePlayback((s) => s.playing)
  const toggle = usePlayback((s) => s.toggle)
  const duration = programLength(project)
  const sourceTime = programToSourceOf(project, programTime)
  const word = currentWord(project.transcript.words, sourceTime)
  const asset = Object.values(project.assets)[0]
  const src = asset?.path ? mediaUrl(asset.path) : ''
  const picture = pictureAt(project, programTime)
  const segment = segmentAtProgram(project, programTime)
  const stack = segmentsAtProgram(project, programTime)
  const outgoing = stack.length > 1 ? stack[0] : undefined
  const volume =
    (project.audioMaster.muted ? 0 : project.audioMaster.volume) *
    (segment?.volume ?? 1) *
    duckGainAt(project, programTime)

  useEffect(() => {
    const video = videoRef.current
    if (video) video.volume = Math.min(1, Math.max(0, volume))
  }, [volume])

  const caption = project.tracks
    .filter((t) => t.type === 'caption' && !t.hidden)
    .flatMap((t) => t.clips)
    .find((c) => programTime >= c.start && programTime < c.start + c.duration)
  const overlays = project.tracks
    .filter((t) => t.type === 'overlay' && !t.hidden)
    .flatMap((t) => t.clips)
    .filter((c) => programTime >= c.start && programTime < c.start + c.duration)
  const pictureFade = segment
    ? fadeGain(programTime - segment.start, segment.duration, segment.fadeIn, segment.fadeOut)
    : 1
  const crop = picture.crop
  const angle = useMemo(() => 18 + sourceTime * 37, [sourceTime])

  return (
    <section className="panel monitor">
      <div className="panel-head">
        Program
        <span>
          {project.name}
          {segment && segment.speed !== 1 ? ` · ${segment.speed}×` : ''}
        </span>
      </div>
      <div className="crt">
        {src ? (
          <>
            {outgoing && (
              <video
                ref={underRef}
                className="dissolve-under"
                src={src}
                muted
                playsInline
                style={{
                  opacity:
                    picture.opacity *
                    fadeGain(
                      programTime - outgoing.start,
                      outgoing.duration,
                      outgoing.fadeIn,
                      outgoing.fadeOut
                    )
                }}
              />
            )}
            <video
              ref={videoRef}
              src={src}
              muted={project.audioMaster.muted}
              playsInline
              style={{
                transform: cssTransform(picture),
                opacity: picture.opacity * pictureFade,
                transformOrigin: 'center center',
                clipPath: `inset(${(crop?.y ?? 0) * 100}% ${(1 - (crop?.x ?? 0) - (crop?.w ?? 1)) * 100}% ${(1 - (crop?.y ?? 0) - (crop?.h ?? 1)) * 100}% ${(crop?.x ?? 0) * 100}%)`
              }}
              onPlay={() => usePlayback.setState({ playing: true })}
              onPause={() => usePlayback.setState({ playing: false })}
            />
          </>
        ) : (
          <div className="voiceprint" style={{ transform: cssTransform(picture), opacity: picture.opacity }}>
            <div className="ring" />
            <div className="ring" />
            <div className="ring" />
            <div className="needle" style={{ transform: `translate(-50%, -100%) rotate(${angle}deg)` }} />
          </div>
        )}
        {overlays.map((overlay) => {
          const media = overlay.assetId ? project.assets[overlay.assetId] : undefined
          const local = programTime - overlay.start
          const fade = fadeGain(local, overlay.duration, overlay.fadeIn, overlay.fadeOut)
          if (overlay.effect === 'blur') {
            return (
              <div
                key={overlay.id}
                className="redact"
                style={{
                  transform: cssTransform(overlay.transform),
                  opacity: overlay.transform.opacity * fade,
                  width: `${Math.max(12, overlay.transform.scale * 100)}%`
                }}
              />
            )
          }
          if (media?.path) {
            const url = mediaUrl(media.path)
            return media.kind === 'video' ? (
              <video
                key={overlay.id}
                className="broll"
                src={url}
                muted
                autoPlay
                loop
                style={{
                  transform: cssTransform(overlay.transform),
                  opacity: overlay.transform.opacity * fade
                }}
              />
            ) : (
              <img
                key={overlay.id}
                className="broll"
                src={url}
                alt={overlay.text ?? media.name}
                style={{
                  transform: cssTransform(overlay.transform),
                  opacity: overlay.transform.opacity * fade
                }}
              />
            )
          }
          if (!overlay.text) return null
          return (
            <div
              key={overlay.id}
              className="overlay-card"
              style={{
                transform: cssTransform(overlay.transform),
                opacity: overlay.transform.opacity * fade
              }}
            >
              {overlay.text}
            </div>
          )
        })}
        {caption?.text && (
          <div
            className="caption-burn"
            data-pos={caption.style?.position ?? 'lower'}
            data-align={caption.style?.align ?? 'center'}
            style={{
              fontSize: caption.style?.fontSize,
              textAlign: caption.style?.align,
              color: caption.style?.fill,
              WebkitTextStrokeColor: caption.style?.stroke
            }}
          >
            {caption.text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
              part.startsWith('**') && part.endsWith('**') ? (
                <strong key={i}>{part.slice(2, -2)}</strong>
              ) : (
                <span key={i}>{part}</span>
              )
            )}
          </div>
        )}
        {word && <div className="now-word">{word.text}</div>}
      </div>
      <div className="transport">
        <button className="play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❙❙' : '▶'}
        </button>
        <span className="timecode">
          {formatTimecode(programTime, project.fps)}
          <small>/ {formatTimecode(duration, project.fps)}</small>
        </span>
        <span>src {formatTimecode(sourceTime, project.fps)}</span>
        <span>vol {Math.round(volume * 100)}</span>
        <LoopButton />
        <MarkButtons />
        <div className="beds" hidden>
          {audioBeds(project).map((bed) => (
            <audio key={bed.id} data-bed={bed.id} src={mediaUrl(bed.path)} preload="auto" />
          ))}
        </div>
      </div>
    </section>
  )
}

function LoopButton() {
  const loop = usePlayback((s) => s.loop)
  return (
    <button
      className="chip"
      data-active={loop}
      onClick={() => usePlayback.setState({ loop: !loop })}
      title="Loop the I/O range, or the whole reel"
    >
      {loop ? 'Loop on' : 'Loop'}
    </button>
  )
}

function MarkButtons() {
  const project = useEditor((s) => s.project)
  const programTime = usePlayback((s) => s.programTime)
  const dispatch = useEditor((s) => s.dispatch)
  return (
    <span className="marks">
      <button className="chip" onClick={() => dispatch({ type: 'setMarks', markIn: programTime })}>
        I {project.markIn == null ? '—' : formatTimecode(project.markIn, project.fps)}
      </button>
      <button className="chip" onClick={() => dispatch({ type: 'setMarks', markOut: programTime })}>
        O {project.markOut == null ? '—' : formatTimecode(project.markOut, project.fps)}
      </button>
    </span>
  )
}
