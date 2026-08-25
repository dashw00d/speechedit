import { useState } from 'react'
import { confirmLoseWork } from '../lib/documentIo'
import { openRecentAction } from '../lib/fileActions'
import { listRecents, recentWhen } from '../lib/recents'
import { useEditor } from '../store'

export function StartGuide({
  compact = false,
  onToast
}: {
  compact?: boolean
  onToast?: (msg: string) => void
}) {
  const loadDemo = useEditor((s) => s.loadDemo)
  const [hover, setHover] = useState(false)
  const recents = listRecents().slice(0, compact ? 3 : 8)
  const toast = onToast ?? (() => undefined)

  function openMedia() {
    window.dispatchEvent(new CustomEvent('speechedit:open-media'))
  }

  function openTranscript() {
    window.dispatchEvent(new CustomEvent('speechedit:open-transcript'))
  }

  function openProject() {
    window.dispatchEvent(new CustomEvent('speechedit:open-project'))
  }

  async function tryDemo() {
    if (!(await confirmLoseWork())) return
    loadDemo()
  }

  return (
    <div
      className={`start-guide${compact ? ' compact' : ''}${hover ? ' drop-hover' : ''}`}
      onDragEnter={() => setHover(true)}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setHover(false)
      }}
      onDrop={() => setHover(false)}
    >
      <p className="start-guide-lead">
        {compact
          ? 'Open a recording, drop a file here, or try the studio demo.'
          : 'Edit video by editing words. Open a recording to transcribe, or drop a transcript if you already have one.'}
      </p>
      <div className="start-cards">
        <button type="button" className="start-card" data-primary="true" onClick={openMedia}>
          <strong>Open media</strong>
          <span>Import a recording — we transcribe, find pauses, and suggest cuts</span>
        </button>
        <button type="button" className="start-card" data-kind="drop" onClick={openTranscript}>
          <strong>{hover ? 'Drop to open' : 'Open or drop transcript'}</strong>
          <span>SRT, VTT, TXT, or Whisper JSON — or drop a recording / project on this panel</span>
        </button>
        <button type="button" className="start-card" onClick={() => void tryDemo()}>
          <strong>Studio demo</strong>
          <span>Walk the editor with a sample reel — retakes, pauses, and suggestions</span>
        </button>
        <button type="button" className="start-card" onClick={openProject}>
          <strong>Open project</strong>
          <span>Continue a saved .speechedit.json reel</span>
        </button>
      </div>
      {recents.length > 0 && (
        <div className="start-recents">
          <p className="start-recents-label">Recent reels</p>
          {recents.map((recent) => (
            <button
              key={recent.path}
              type="button"
              className="start-card start-recent"
              title={recent.path}
              onClick={() => void openRecentAction(recent.path, toast)}
            >
              <strong>{recent.name}</strong>
              <span>{recentWhen(recent.savedAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
