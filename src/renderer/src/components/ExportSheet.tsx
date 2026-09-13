import { useDialog } from '../useDialog'
import { useEffect, useState } from 'react'
import { captionsForExport } from '../lib/captions'
import {
  exportContentPackage,
  exportPrimaryCopy,
  exportSidecar,
  exportVideoAction,
  projectHasPicture,
  relinkProxyOriginals,
  SIDECARS
} from '../lib/exportActions'
import type { ToastDispatch } from '../lib/toastActions'
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
  onToast: ToastDispatch
}) {
  const project = useEditor((s) => s.project)
  const exporting = useEditor((s) => s.exporting)
  const analyzing = useEditor((s) => s.analyzing)
  const [pipeline, setPipeline] = useState(false)
  const [markedOnly, setMarkedOnly] = useState(false)
  const [audioOnly, setAudioOnly] = useState(false)
  const [burnCaptions, setBurnCaptions] = useState(true)
  const exportOpts = { markedOnly, audioOnly, burnCaptions }
  const primary = exportPrimaryCopy(project, exportOpts)
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

  const dialogRef = useDialog(open, () => { if (exporting) void cancelExport(); else onClose() })

  if (!open) return null

  return (
    <div className="confirm-back export-back" onMouseDown={onClose}>
      <div
        className="confirm-sheet export-sheet"
        ref={dialogRef}
        tabIndex={-1}
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
            : primary.kind === 'relink'
              ? 'This shared copy can preview but not render. Relink the original recording, then export.'
              : hasPicture
                ? primary.kind === 'pack'
                  ? 'MP4 needs a recording on disk and the desktop app. Download the words now.'
                  : 'The movie, or just the words. Pipeline formats stay under More.'
                : primary.kind === 'pack'
                  ? 'This reel is audio and has no file on disk. Download the words, or open a recording for M4A.'
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
          disabled={ffmpegImportBusy(analyzing) || (!exporting && primary.kind === 'blocked')}
          onClick={() => {
            if (exporting) {
              void cancelExport()
              return
            }
            if (primary.kind === 'relink') {
              void relinkProxyOriginals(onToast, () => void exportVideoAction(onToast, exportOpts))
              return
            }
            if (primary.kind === 'pack') {
              void exportContentPackage(
                onToast,
                audioOnly
                  ? 'Downloaded the words. M4A needs the desktop app and a linked recording.'
                  : 'Downloaded captions and the transcript. MP4 needs the desktop app and a linked recording.'
              )
              return
            }
            void exportVideoAction(onToast, exportOpts)
          }}
        >
          <strong>
            {exporting ? 'Cancel video export' : primary.label}
          </strong>
          <span>{exporting ? 'Stop the render' : primary.detail}</span>
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
