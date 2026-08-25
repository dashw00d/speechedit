const GROUPS: { title: string; rows: { keys: string; does: string }[] }[] = [
  {
    title: 'Play',
    rows: [
      { keys: 'Space', does: 'Play or pause. With a word selected, loops that sentence.' },
      { keys: 'K / J / L', does: 'Play · skip back 2s · skip ahead 2s' },
      { keys: 'Home / End', does: 'Jump to the start or end' },
      { keys: 'P', does: 'Play the marked range, or the selected words' },
      { keys: '/', does: 'Loop the marks, or the whole reel' },
      { keys: '0.5× 1× 2×', does: 'Review speed on the monitor' },
      { keys: 'F', does: 'Full-screen program' }
    ]
  },
  {
    title: 'Cut',
    rows: [
      { keys: 'Delete', does: 'Cut the selection. Ripple off leaves a hold.' },
      { keys: 'Gap', does: 'Insert a 1s hold at the playhead' },
      { keys: 'Q / W', does: 'Trim the start / end up to the playhead' },
      { keys: 'S', does: 'Split at the playhead' },
      { keys: 'I / O', does: 'Mark In / Out' },
      { keys: 'M', does: 'Clear In and Out' }
    ]
  },
  {
    title: 'Clips',
    rows: [
      { keys: '← →', does: 'Nudge a selected clip one frame. Shift 1s. Alt 10 frames.' },
      { keys: '⌘C / ⌘V', does: 'Copy clip · paste at the playhead' },
      { keys: '⌘⇧C / ⌘⇧V', does: 'Copy look · paste look onto the selection' },
      { keys: 'E', does: 'Extend the clip to the playhead' },
      { keys: 'N / ⇧N', does: 'Next / previous note' },
      { keys: 'Alt-drag', does: 'Slip media inside the clip' },
      { keys: 'Shift-drag', does: 'Slide the clip. Shift-drag a handle to roll.' }
    ]
  },
  {
    title: 'Words',
    rows: [
      { keys: '⌘F', does: 'Find in the transcript' },
      { keys: 'Enter', does: 'Next match · Shift+Enter previous' },
      { keys: '[ / ]', does: 'Fewer / more words, or previous / next chapter' },
      { keys: 'Follow', does: 'Keep the current word in view. Scroll to pause it.' }
    ]
  },
  {
    title: 'App',
    rows: [
      { keys: '⌘K', does: 'Command palette' },
      { keys: '⌘J', does: 'Agent' },
      { keys: '⌘Z', does: 'Undo' },
      { keys: '\\', does: 'Fit the timeline' },
      { keys: 'G', does: 'Protect words so Auto Edit skips them' },
      { keys: '?', does: 'This list' }
    ]
  }
]

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="confirm-back shortcuts-back" onMouseDown={onClose}>
      <div
        className="confirm-sheet shortcuts-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p id="shortcuts-title" className="confirm-title">
          Keyboard
        </p>
        <p className="confirm-copy">The ones you need with a headache. ? closes this.</p>
        <div className="shortcuts-grid">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.rows.map((row) => (
                  <div key={row.keys} className="shortcuts-row">
                    <dt>{row.keys}</dt>
                    <dd>{row.does}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="confirm-actions">
          <button type="button" className="chip" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
