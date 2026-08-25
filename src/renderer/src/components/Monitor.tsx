import { useEffect, useMemo, useRef } from 'react'
import { mediaUrl } from '../host'
import { playbackPath } from '../../../shared/proxy'
import { programLength } from '../lib/commands'
import { currentWord } from '../lib/edl'
import { projectToExportJob } from '../lib/exportJob'
import { cssTransform } from '../lib/keyframes'
import { sampleProgram } from '../lib/programLook'
import { pictureAt } from '../lib/resolver'
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
  const job = useMemo(() => projectToExportJob(project), [project])
  const look = useMemo(() => sampleProgram(job, programTime), [job, programTime])
  const duration = job.duration && job.duration > 0 ? job.duration : programLength(project)
  const sourceTime = look.sourceTime
  const word = currentWord(project.transcript.words, sourceTime)
  const asset = Object.values(project.assets)[0]
  const src = asset?.path ? mediaUrl(playbackPath(asset)) : ''
  const picture = pictureAt(project, programTime)
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
    <section className="panel monitor">
      <div className="panel-head">
        Program
        <span>
          {project.name}
          {look.incoming && look.incoming.speed !== 1 ? ` · ${look.incoming.speed}×` : ''}
        </span>
      </div>
      <div className="crt">
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
        {overlays.map(({ layer, opacity }) => {
          if (layer.kind === 'blur') {
            return (
              <div
                key={layer.id ?? `${layer.start}-blur`}
                className="redact"
                style={{
                  transform: `translate(${layer.x}px, ${layer.y}px) scale(${layer.scale}) rotate(${layer.rotation ?? 0}deg)`,
                  opacity,
                  width: `${Math.max(12, layer.scale * 100)}%`
                }}
              />
            )
          }
          if (layer.kind === 'image' && layer.path) {
            const media = Object.values(project.assets).find((a) => a.path === layer.path)
            const url = mediaUrl(media ? playbackPath(media) : layer.path)
            const xf = `translate(${layer.x}px, ${layer.y}px) scale(${layer.scale}) rotate(${layer.rotation ?? 0}deg)`
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
                transform: `translate(${layer.x}px, ${layer.y}px) scale(${layer.scale}) rotate(${layer.rotation ?? 0}deg)`,
                opacity,
                fontSize: layer.fontSize,
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
                fontSize: layer.fontSize,
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
        {word && <div className="now-word">{word.text}</div>}
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
        <span>vol {Math.round(volume * 100)}</span>
        {ducked && (
          <span className="duck-flag" title="Voice is ducked under B-roll">
            duck −{Math.round(duckAmount * 100)}
          </span>
        )}
        <LoopButton />
        <button
          className="chip"
          title="Play I/O, or the word selection if marks are empty (P)"
          onClick={() => usePlayback.getState().playSelectionOrMarks()}
        >
          Play I/O
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
