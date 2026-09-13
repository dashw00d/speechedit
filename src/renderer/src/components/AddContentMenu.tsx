import { useEditor } from '../store'
import { addBrollFromContext } from '../lib/broll'
import { addMusicFromContext } from '../lib/music'
import { applyTitleFromContext } from '../lib/title'
import { applyLowerThirdFromContext } from '../lib/lowerThird'
import { applyZoomFromContext } from '../lib/zoom'
import { applyRedactionFromContext } from '../lib/redaction'
import { generateCaptionsFromContext } from '../lib/captionGenerate'
import { ffmpegImportBusy } from '../lib/mediaJobs'
import { OverflowMenu } from './OverflowMenu'

/** Creation uses the same context-aware operations in the preview and timeline. */
export function AddContentMenu({ onToast, place = 'below' }: { onToast?: (text: string) => void; place?: 'above' | 'below' }) {
  const notify = onToast ?? (() => undefined)
  const project = useEditor((s) => s.project)
  const analyzing = useEditor((s) => s.analyzing)
  const exporting = useEditor((s) => s.exporting)
  const busy = ffmpegImportBusy(analyzing) || exporting
  const hasMedia = project.sourceDuration > 0
  return (
    <OverflowMenu tone="chip" place={place} label="+ Add" title="Add text, pictures, or sound">
      <span className="overflow-section-label">Text on the picture</span>
      <button className="overflow-item" disabled={!hasMedia} onClick={() => notify(applyTitleFromContext().toast)}>Title</button>
      <button className="overflow-item" disabled={!hasMedia} onClick={() => notify(applyLowerThirdFromContext().toast)}>Lower third · name or label</button>
      <button className="overflow-item" disabled={!project.transcript.words.some((word) => !word.deleted)} onClick={() => notify(generateCaptionsFromContext().toast)}>Captions from remaining words</button>
      <span className="overflow-section-label">Selected words, chapter, or playhead</span>
      <button className="overflow-item" disabled={!hasMedia} onClick={() => notify(applyZoomFromContext().toast)}>Zoom in</button>
      <button className="overflow-item" disabled={!hasMedia} onClick={() => notify(applyRedactionFromContext().toast)}>Blur private information</button>
      <button className="overflow-item" disabled={!hasMedia || busy} onClick={() => void addBrollFromContext().then((result) => notify(result.toast))}>Picture or B-roll…</button>
      <span className="overflow-section-label">Sound</span>
      <button className="overflow-item" disabled={!hasMedia || busy} onClick={() => void addMusicFromContext().then((result) => notify(result.toast))}>Music bed…</button>
    </OverflowMenu>
  )
}
