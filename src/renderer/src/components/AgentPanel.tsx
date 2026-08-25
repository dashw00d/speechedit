import { useEffect, useRef, useState } from 'react'
import { askEditor } from '../lib/askModel'
import { renderAgentBrief } from '../lib/agentContext'
import { currentEditorSession } from '../lib/editorSession'
import { formatClock } from '../lib/time'
import { useEditor } from '../store'
import type { AgentCall } from '../lib/agent'

const QUICK = [
  { label: 'Auto-cut the reel', intent: 'auto-cut the reel' },
  { label: 'Auto-cut, keep tagged demo', intent: 'auto-cut this like Auto-Editor but skip the silent demo I tagged' },
  { label: 'Cut the product-name fumble', intent: 'remove the part where I fumble the product name' },
  { label: 'Find scenes / retakes', intent: 'Find scenes and mark retakes. Do not cut yet.' },
  { label: 'Collapse retakes', intent: 'collapse retakes' },
  { label: 'Put back silence', intent: 'put back silence' }
]

export function AgentPanel({
  onToast,
  variant = 'inspector'
}: {
  onToast: (msg: string) => void
  variant?: 'inspector' | 'dock'
}) {
  const project = useEditor((s) => s.project)
  const dispatch = useEditor((s) => s.dispatch)
  const setAgentOpen = useEditor((s) => s.setAgentOpen)
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<{ q: string; a: string; calls: AgentCall[] }[]>([])
  const input = useRef<HTMLTextAreaElement>(null)
  const retakes = (project.scenes ?? []).filter((s) => s.kind === 'retake').length
  const demos = (project.scenes ?? []).filter((s) => s.kind === 'demo').length

  useEffect(() => {
    if (variant === 'dock') input.current?.focus()
  }, [variant])

  async function run(text: string) {
    const q = text.trim()
    if (!q) return
    setBusy(true)
    try {
      const before = useEditor.getState().project
      const result = await askEditor(before, q, currentEditorSession())
      if (result.project !== before) {
        dispatch({ type: 'replaceProject', project: result.project })
      }
      setLog((rows) => [...rows, { q, a: result.message, calls: result.calls }].slice(-8))
      onToast(result.message)
      setIntent('')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Agent failed.')
    } finally {
      setBusy(false)
    }
  }

  const body = (
    <div className="agent-panel">
      <p className="help">
        Same command bus as the mouse. Every tool call is an <code>applyCommand</code>. Undo (⌘Z) reverts the
        whole turn.
      </p>
      <p className="help">
        {formatClock(project.sourceDuration)} source · {(project.scenes ?? []).length} scenes
        {retakes ? ` · ${retakes} retakes` : ''}
        {demos ? ` · ${demos} demos` : ''} · {project.suggestions.filter((s) => !s.applied).length} open
        edits
      </p>
      <div className="script-tools" style={{ padding: 0 }}>
        {QUICK.map((item) => (
          <button key={item.label} className="chip" disabled={busy} onClick={() => void run(item.intent)}>
            {item.label}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Ask</span>
        <textarea
          ref={input}
          rows={3}
          placeholder='Remove the part where I fumble the product name…'
          value={intent}
          disabled={busy}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void run(intent)
            }
            if (e.key === 'Escape' && variant === 'dock') {
              e.preventDefault()
              setAgentOpen(false)
            }
          }}
        />
      </label>
      <button className="chip" disabled={busy || !intent.trim()} onClick={() => void run(intent)}>
        {busy ? 'Editing…' : 'Run tools'}
      </button>
      {log.length > 0 && (
        <ol className="agent-log">
          {log.map((row, i) => (
            <li key={`${row.q}-${i}`}>
              <strong>{row.q}</strong>
              <span>{row.a}</span>
              {row.calls.length > 0 && (
                <ul className="agent-calls">
                  {row.calls.map((call, j) => (
                    <li key={`${call.name}-${j}`}>
                      <code>{call.name}</code> {call.message}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      <pre className="agent-brief">{renderAgentBrief(project, currentEditorSession())}</pre>
    </div>
  )

  if (variant !== 'dock') return body

  return (
    <div className="agent-dock-back" onClick={() => setAgentOpen(false)}>
      <div className="agent-dock" onClick={(e) => e.stopPropagation()}>
        <header className="agent-dock-head">
          <span>Agent</span>
          <span className="help">⌘J · ⌘Z undoes the last turn</span>
          <button className="chip" onClick={() => setAgentOpen(false)}>
            Close
          </button>
        </header>
        {body}
      </div>
    </div>
  )
}
