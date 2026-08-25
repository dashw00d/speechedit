import { useEffect, useState, type ReactNode } from 'react'
import { host } from '../host'
import { primarySegments, programLength } from '../lib/commands'
import { formatClock } from '../lib/time'
import { useEditor, usePlayback } from '../store'
import type { EncoderOption } from '../types'
import { ModelsPanel } from './ModelsPanel'

const TABS = [
  ['transform', 'Transform'],
  ['audio', 'Audio'],
  ['caption', 'Caption'],
  ['project', 'Project']
] as const

export function Inspector({ onToast }: { onToast?: (msg: string) => void }) {
  const project = useEditor((s) => s.project)
  const tab = useEditor((s) => s.inspectorTab)
  const setTab = useEditor((s) => s.setInspectorTab)
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const dispatch = useEditor((s) => s.dispatch)
  const programTime = usePlayback((s) => s.programTime)

  const [encoders, setEncoders] = useState<EncoderOption[]>([
    { id: 'libx264', label: 'x264 (CPU)', hardware: false }
  ])
  const overlayClip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId)
  const segments = primarySegments(project)
  const clip = overlayClip ?? segments.find((c) => c.id === selectedClipId)
  const isPrimary = Boolean(clip && segments.some((s) => s.id === clip.id))

  useEffect(() => {
    void host.encoders().then((list) => {
      if (list.length) setEncoders(list)
    })
  }, [])

  return (
    <aside className="panel inspector">
      <div className="panel-head">Inspector</div>
      <div className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className="tab" data-on={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="fields">
        {tab === 'project' && (
          <>
            <Field label="Reel name">
              <input
                type="text"
                value={project.name}
                onChange={(e) => dispatch({ type: 'setName', name: e.target.value })}
              />
            </Field>
            <p className="help">
              Program {formatClock(programLength(project))} · source {formatClock(project.sourceDuration)} ·{' '}
              {project.transcript.words.filter((w) => !w.deleted).length} live words · {project.cuts.length}{' '}
              cuts · {project.suggestions.filter((s) => !s.applied).length} open edits
            </p>
            <Field label="Encoder">
              <select
                value={project.encoder ?? 'auto'}
                onChange={(e) => dispatch({ type: 'setEncoder', encoder: e.target.value })}
              >
                <option value="auto">Auto (prefer hardware)</option>
                {encoders.map((enc) => (
                  <option key={enc.id} value={enc.id}>
                    {enc.label}
                    {enc.hardware ? ' · GPU' : ''}
                  </option>
                ))}
              </select>
            </Field>
            {project.transcript.speakers.map((speaker) => (
              <Field key={speaker.id} label={speaker.name}>
                <input
                  type="text"
                  value={speaker.name}
                  onChange={(e) =>
                    dispatch({ type: 'renameSpeaker', speakerId: speaker.id, name: e.target.value })
                  }
                />
              </Field>
            ))}
            <button className="chip" onClick={() => dispatch({ type: 'addSpeaker' })}>
              Add speaker
            </button>
            <Slider
              label="Cut pad"
              value={project.cutMargin}
              min={0}
              max={0.4}
              step={0.02}
              onChange={(margin) => dispatch({ type: 'setCutMargin', margin })}
            />
            <ModelsPanel onToast={onToast ?? (() => undefined)} />
            <p className="help">
              Transcript, timeline, and Auto Edit all call the same commands. One undo stack. Export
              burns the program you see. Hardware encode and -16 LUFS normalize ride with the
              program.
            </p>
          </>
        )}

        {tab === 'transform' && clip && (
          <>
            <Slider
              label="X"
              value={clip.transform.x}
              min={-800}
              max={800}
              onChange={(x) => dispatch({ type: 'setTransform', clipId: clip.id, transform: { x } })}
            />
            <Slider
              label="Y"
              value={clip.transform.y}
              min={-800}
              max={800}
              onChange={(y) => dispatch({ type: 'setTransform', clipId: clip.id, transform: { y } })}
            />
            <Slider
              label="Scale"
              value={clip.transform.scale}
              min={0.2}
              max={4}
              step={0.01}
              onChange={(scale) =>
                dispatch({ type: 'setTransform', clipId: clip.id, transform: { scale } })
              }
            />
            <Slider
              label="Rotation"
              value={clip.transform.rotation}
              min={-180}
              max={180}
              onChange={(rotation) =>
                dispatch({ type: 'setTransform', clipId: clip.id, transform: { rotation } })
              }
            />
            <Slider
              label="Opacity"
              value={clip.transform.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(opacity) =>
                dispatch({ type: 'setTransform', clipId: clip.id, transform: { opacity } })
              }
            />
            <Slider
              label="Fade in"
              value={clip.fadeIn}
              min={0}
              max={2}
              step={0.05}
              onChange={(duration) =>
                dispatch({ type: 'setFade', targetId: clip.id, edge: 'in', duration })
              }
            />
            <Slider
              label="Fade out"
              value={clip.fadeOut}
              min={0}
              max={2}
              step={0.05}
              onChange={(duration) =>
                dispatch({ type: 'setFade', targetId: clip.id, edge: 'out', duration })
              }
            />
            <Slider
              label="Crop"
              value={clip.transform.crop?.w ?? 1}
              min={0.3}
              max={1}
              step={0.01}
              onChange={(w) =>
                dispatch({
                  type: 'setTransform',
                  clipId: clip.id,
                  transform: { crop: { x: (1 - w) / 2, y: (1 - w) / 2, w, h: w } }
                })
              }
            />
            {isPrimary && (
              <>
                <Slider
                  label="Speed"
                  value={clip.speed}
                  min={0.25}
                  max={8}
                  step={0.05}
                  onChange={(speed) =>
                    dispatch({ type: 'setSpeed', start: clip.inPoint, end: clip.outPoint, speed })
                  }
                />
                <button
                  className="chip"
                  onClick={() =>
                    dispatch({
                      type: 'addKeyframe',
                      segmentId: clip.id,
                      time: Math.min(
                        1,
                        Math.max(0, (programTime - clip.start) / Math.max(0.05, clip.duration))
                      ),
                      transform: clip.transform
                    })
                  }
                >
                  Add keyframe here
                </button>
              </>
            )}
          </>
        )}

        {tab === 'audio' && (
          <>
            <Slider
              label="Master"
              value={project.audioMaster.volume}
              min={0}
              max={2}
              step={0.01}
              onChange={(volume) => dispatch({ type: 'setAudioMaster', patch: { volume } })}
            />
            <Slider
              label="Fade in"
              value={project.audioMaster.fadeIn}
              min={0}
              max={3}
              step={0.05}
              onChange={(fadeIn) => dispatch({ type: 'setAudioMaster', patch: { fadeIn } })}
            />
            <Slider
              label="Fade out"
              value={project.audioMaster.fadeOut}
              min={0}
              max={3}
              step={0.05}
              onChange={(fadeOut) => dispatch({ type: 'setAudioMaster', patch: { fadeOut } })}
            />
            <Slider
              label="Low EQ"
              value={project.audioMaster.eqLow}
              min={-12}
              max={12}
              step={0.5}
              onChange={(eqLow) => dispatch({ type: 'setAudioMaster', patch: { eqLow } })}
            />
            <Slider
              label="Mid EQ"
              value={project.audioMaster.eqMid}
              min={-12}
              max={12}
              step={0.5}
              onChange={(eqMid) => dispatch({ type: 'setAudioMaster', patch: { eqMid } })}
            />
            <Slider
              label="High EQ"
              value={project.audioMaster.eqHigh}
              min={-12}
              max={12}
              step={0.5}
              onChange={(eqHigh) => dispatch({ type: 'setAudioMaster', patch: { eqHigh } })}
            />
            <Slider
              label="Duck under B-roll"
              value={project.audioMaster.duck}
              min={0}
              max={1}
              step={0.05}
              onChange={(duck) => dispatch({ type: 'setAudioMaster', patch: { duck } })}
            />
            <p className="help">Lowers A1 while a still or video sits on an overlay track.</p>
            <label className="field check">
              <span>Compressor</span>
              <input
                type="checkbox"
                checked={project.audioMaster.compress}
                onChange={(e) =>
                  dispatch({ type: 'setAudioMaster', patch: { compress: e.target.checked } })
                }
              />
            </label>
            <label className="field check">
              <span>Normalize -16 LUFS</span>
              <input
                type="checkbox"
                checked={project.audioMaster.normalize}
                onChange={(e) =>
                  dispatch({ type: 'setAudioMaster', patch: { normalize: e.target.checked } })
                }
              />
            </label>
            {clip && (
              <Slider
                label="Clip volume"
                value={clip.volume}
                min={0}
                max={2}
                step={0.01}
                onChange={(volume) => dispatch({ type: 'setVolume', clipId: clip.id, volume })}
              />
            )}
          </>
        )}

        {tab === 'caption' && (
          <>
            <Field label="Text">
              <textarea
                rows={4}
                value={overlayClip?.text ?? ''}
                onChange={(e) =>
                  overlayClip && dispatch({ type: 'setText', clipId: overlayClip.id, text: e.target.value })
                }
              />
            </Field>
            {overlayClip?.style && (
              <Slider
                label="Size"
                value={overlayClip.style.fontSize}
                min={18}
                max={96}
                onChange={(fontSize) =>
                  dispatch({ type: 'setCaptionStyle', clipId: overlayClip.id, style: { fontSize } })
                }
              />
            )}
          </>
        )}

        {!clip && tab !== 'project' && tab !== 'audio' && (
          <p className="help">Select a picture segment or overlay on the tape.</p>
        )}
      </div>
    </aside>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="slider">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span>{Number(value).toFixed(step < 1 ? 2 : 0)}</span>
      </div>
    </div>
  )
}
