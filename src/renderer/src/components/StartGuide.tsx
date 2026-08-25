import { confirmLoseWork } from '../lib/documentIo'
import { useEditor } from '../store'

export function StartGuide({ compact = false }: { compact?: boolean }) {
  const loadDemo = useEditor((s) => s.loadDemo)

  function openMedia() {
    window.dispatchEvent(new CustomEvent('speechedit:open-media'))
  }

  function tryDemo() {
    if (!confirmLoseWork()) return
    loadDemo()
  }

  return (
    <div className={`start-guide${compact ? ' compact' : ''}`}>
      <p className="start-guide-lead">
        {compact
          ? 'Open media, drop a transcript, or try the studio demo.'
          : 'No transcript yet. Edit video by editing words — cut pauses, drop retakes, caption, export.'}
      </p>
      <div className="start-cards">
        <button type="button" className="start-card" onClick={openMedia}>
          <strong>Open media</strong>
          <span>Import a recording · transcribe · find pauses and fillers</span>
        </button>
        <button type="button" className="start-card" data-kind="drop">
          <strong>Drop transcript</strong>
          <span>Drag a .txt, .srt, or .json transcript onto this panel</span>
        </button>
        <button type="button" className="start-card" onClick={tryDemo}>
          <strong>Studio demo</strong>
          <span>Walk the editor with a sample reel — retakes, pauses, and suggestions</span>
        </button>
      </div>
    </div>
  )
}
