import { useEditor } from '../store'
import { useDialog } from '../useDialog'
import { shortcutLabel } from '../lib/keyboard'

const GROUPS: { title: string; rows: { keys: string; does: string }[] }[] = [
  {
    title: 'Play',
    rows: [
      { keys: 'Space', does: 'Play or pause from the current position.' },
      { keys: 'K / J / L', does: 'Play · skip back 2s · skip ahead 2s' },
      { keys: 'Home / End', does: 'Jump to the start or end' },
      { keys: 'P', does: 'Play the marked range, or the selected words' },
      { keys: '/', does: 'Loop the marks, or the whole reel' },
      { keys: '0.5× 1× 1.5× 2×', does: 'Review speed on the monitor' },
      { keys: 'F', does: 'Full-screen program' }
    ]
  },
  {
    title: 'Cut',
    rows: [
      { keys: 'Delete', does: 'Remove the selection. Close gaps joins the remaining video; Leave gaps keeps its timing.' },
      { keys: '.', does: 'Cut this sentence and hear the join.' },
      { keys: ',', does: 'Cut the previous sentence. On a restart, that is Cut previous.' },
      { keys: 'Gap', does: 'Insert a 1s hold at the playhead' },
      { keys: 'Q / W', does: 'Trim the start / end up to the playhead' },
      { keys: 'S', does: 'Split at the playhead' },
      { keys: 'I / O', does: 'Mark In / Out' },
      { keys: 'M', does: 'Mark the selected words. With no selection, clear In and Out.' }
    ]
  },
  {
    title: 'Clips',
    rows: [
      { keys: '← →', does: 'Nudge a selected clip one frame. Shift 1s. Alt 10 frames.' },
      { keys: '⌘C / ⌘V', does: 'Copy quote (words) or clip · paste at the playhead' },
      { keys: '⌘⇧C / ⌘⇧V', does: 'Copy look · paste look onto the selection' },
      { keys: 'E', does: 'Extend the clip to the playhead' },
      { keys: 'N / ⇧N', does: 'Next / previous note. Toast names Mark clip or the next mark.' },
      { keys: 'Alt-drag', does: 'Slip media inside the clip' },
      { keys: 'Shift-drag', does: 'Slide the clip. Shift-drag a handle to roll.' }
    ]
  },
  {
    title: 'Words',
    rows: [
      { keys: ', / .', does: 'Cut the previous sentence / this sentence' },
      { keys: 'A', does: 'Select the paragraph, then Remove paragraph hears the join' },
      { keys: '⌘F', does: 'Find in the transcript' },
      { keys: 'Enter', does: 'Next match · Shift+Enter previous' },
      { keys: '[ / ]', does: 'Fewer / more words, or previous / next chapter' },
      { keys: 'F2', does: 'Rename the selected chapter or speaker. Enter opens the next.' },
      { keys: 'Follow', does: 'Keep the current word in view. Scroll to pause it.' }
    ]
  },
  {
    title: 'App',
    rows: [
      { keys: '⌘K', does: 'Command palette' },
      { keys: '⌘J', does: 'Open Assistant' },
      { keys: '⌘Z', does: 'Undo the last edit' },
      { keys: '⌘⇧Z', does: 'Redo an undone edit (Ctrl+Y also works)' },
      { keys: '⌘S', does: 'Save project' },
      { keys: '\\', does: 'Fit the timeline' },
      { keys: 'G', does: 'Protect words so Auto Edit skips them' },
      { keys: '?', does: 'This list' },
      { keys: 'Alt 1–4', does: 'Preview · Review · Script · Timeline when a pane is collapsed' }
    ]
  }
]

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useDialog(open, onClose)
  if (!open) return null
  return (
    <div className="confirm-back shortcuts-back" onMouseDown={onClose}>
      <div
        className="confirm-sheet shortcuts-sheet"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p id="shortcuts-title" className="confirm-title">
          Editing help
        </p>
        <p className="confirm-copy">Start with select, preview, and remove. Undo is always available. Escape closes this guide.</p>
        <ol className="editing-quick-start">
          <li><strong>Choose what to change.</strong> Click a word, or drag across several. Click a pause or timeline clip to see its tools.</li>
          <li><strong>Listen, then edit.</strong> Preview plays your words. Remove cuts them from the video. Correct word fixes a transcription mistake.</li>
          <li><strong>Change your mind.</strong> Undo reverses an edit. Select crossed-out words and choose Restore words to bring them back.</li>
          <li><strong>Keep your work.</strong> Save keeps an editable project. Export creates the finished video, audio, or captions.</li>
        </ol>
        <div className="shortcuts-grid">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.rows.map((row) => (
                  <div key={row.keys} className="shortcuts-row">
                    <dt>{shortcutLabel(row.keys)}</dt>
                    <dd>{row.does}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="confirm-actions">
          <button type="button" className="chip" onClick={() => { onClose(); useEditor.getState().setPalette(true) }}>Find an editing action</button>
          <button type="button" className="chip" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
