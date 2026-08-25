import { useEffect, useState } from 'react'
import { isElectron } from '../host'
import { captionsForExport } from '../lib/captions'
import {
  exportContentPackage,
  exportSidecar,
  exportVideoAction,
  projectHasPicture,
  SIDECARS,
  videoExportCopy
} from '../lib/exportActions'
import { setNormalizeFromContext } from '../lib/loudness'
import { isVerticalFrame, setFrameFromContext } from '../lib/canvas'
import { cancelExport, ffmpegImportBusy } from '../lib/mediaJobs'
import { useEditor } from '../store'

export function ExportSheet({
  open,
  onClose,
  onToast
}: {
  open: boolean
  onClose: () => void
  onToast: (msg: string) => void
}) {
  const project = useEditor((s) => s.project)
  const exporting = useEditor((s) => s.exporting)
  const analyzing = useEditor((s) => s.analyzing)
  const [pipeline, setPipeline] = useState(false)
  const [markedOnly, setMarkedOnly] = useState(false)
  const [audioOnly, setAudioOnly] = useState(false)
  const [burnCaptions, setBurnCaptions] = useState(true)
  const exportOpts = { markedOnly, audioOnly, burnCaptions }
  const video = videoExportCopy(project, exportOpts)
  const hasMarks = project.markIn != null && project.markOut != null
  const hasCaptions = captionsForExport(project).length > 0
  const hasPicture = projectHasPicture(project)
  const common = SIDECARS.filter((item) => item.group === 'common')
  const advanced = SIDECARS.filter((item) => item.group === 'pipeline')

  useEffect(() => {
    if (!open) return
    setMarkedOnly(project.markIn != null && project.markOut != null)
    setAudioOnly(!projectHasPicture(project))
  }, [open, project.markIn, project.markOut, project.assets])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (exporting) void cancelExport()
      else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, exporting, onClose])

  if (!open) return null

  return (
    <div className="confirm-back export-back" onMouseDown={onClose}>
      <div
        className="confirm-sheet export-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p id="export-title" className="confirm-title">
          Export
        </p>
        <p className="confirm-copy">
          {exporting
            ? 'Rendering the program — leave this open or cancel.'
            : hasPicture
              ? 'The movie, or just the words. Pipeline formats stay under More.'
              : 'This reel is audio. M4A is already selected — or export the words below.'}
        </p>
        <div className="chips export-presets">
          <button
            type="button"
            className="chip"
            data-active={project.width === 1920 && project.height === 1080 && !audioOnly}
            title="1920×1080 program frame"
            onClick={() => {
              setAudioOnly(false)
              onToast(setFrameFromContext('youtube').toast)
            }}
          >
            YouTube 1080
          </button>
          <button
            type="button"
            className="chip"
            data-active={isVerticalFrame(project) && !audioOnly}
            title="1080×1920, centered on the face. Drag the picture. Safe keeps captions inside."
            onClick={() => {
              setAudioOnly(false)
              onToast(setFrameFromContext('vertical').toast)
            }}
          >
            Vertical 9:16
          </button>
          <button
            type="button"
            className="chip"
            data-active={audioOnly}
            title="Audio-only M4A — podcast / voice"
            onClick={() => setAudioOnly(true)}
          >
            Podcast audio
          </button>
        </div>
        <div className="export-opts">
          <label className="field inline">
            <input
              type="checkbox"
              checked={markedOnly}
              disabled={!hasMarks}
              onChange={(e) => setMarkedOnly(e.target.checked)}
            />
            <span>{hasMarks ? 'Marked range only (In–Out)' : 'Marked range only — set In and Out first'}</span>
          </label>
          <label className="field inline">
            <input type="checkbox" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)} />
            <span>Audio only · M4A</span>
          </label>
          {hasCaptions && !audioOnly && (
            <label className="field inline">
              <input
                type="checkbox"
                checked={burnCaptions}
                onChange={(e) => setBurnCaptions(e.target.checked)}
              />
              <span title="The client sees captions even if they never turn them on">
                Burn captions into the picture
              </span>
            </label>
          )}
          <label className="field inline">
            <input
              type="checkbox"
              checked={project.audioMaster.normalize}
              onChange={(e) => onToast(setNormalizeFromContext(e.target.checked).toast)}
            />
            <span title="Same loudness YouTube and podcast hosts expect. Uncheck if you already mastered.">
              Normalize -16 LUFS
            </span>
          </label>
        </div>
        <button
          type="button"
          className="export-choice"
          data-primary="true"
          disabled={ffmpegImportBusy(analyzing) || (!exporting && !video.ready)}
          onClick={() => {
            if (exporting) {
              void cancelExport()
              return
            }
            void exportVideoAction(onToast, exportOpts)
          }}
        >
          <strong>
            {exporting ? 'Cancel video export' : audioOnly ? 'Audio · M4A' : 'Video · MP4'}
          </strong>
          <span>
            {exporting
              ? 'Stop the render'
              : !video.ready
                ? video.summary
                : !isElectron
                  ? `${video.summary} · desktop app for MP4`
                  : video.summary}
          </span>
        </button>
        <button
          type="button"
          className="export-choice"
          disabled={exporting || !common.some((item) => item.ready(project))}
          onClick={() => void exportContentPackage(onToast)}
        >
          <strong>Content package</strong>
          <span>SRT, VTT, transcript, and chapters in one go</span>
        </button>
        <div className="export-list">
          {common.map((item) => (
            <button
              key={item.id}
              type="button"
              className="export-choice"
              disabled={!item.ready(project) || exporting}
              onClick={() => void exportSidecar(item.id, onToast)}
            >
              <strong>{item.label}</strong>
              <span>{item.ready(project) ? item.hint : 'Nothing in this reel yet'}</span>
            </button>
          ))}
        </div>
        <button type="button" className="chip" onClick={() => setPipeline((on) => !on)}>
          {pipeline ? 'Hide NLE formats' : 'More · Premiere, Final Cut, OTIO…'}
        </button>
        {pipeline && (
          <div className="export-list">
            {advanced.map((item) => (
              <button
                key={item.id}
                type="button"
                className="export-choice"
                disabled={!item.ready(project) || exporting}
                onClick={() => void exportSidecar(item.id, onToast)}
              >
                <strong>{item.label}</strong>
                <span>{item.hint}</span>
              </button>
            ))}
          </div>
        )}
        <div className="confirm-actions">
          <button type="button" className="chip" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
