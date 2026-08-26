import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelQueueStatus } from '../../../shared/modelQueue'
import { host } from '../host'
import {
  agentActivityState,
  recordAgentTurn,
  selectAgentTurn,
  subscribeAgentActivity
} from '../lib/agentActivity'
import { renderAgentBrief } from '../lib/agentContext'
import { askEditor } from '../lib/askModel'
import { currentEditorSession } from '../lib/editorSession'
import { planIntent } from '../lib/intent'
import { MCP_TOOLS, type ToolDomain } from '../lib/mcpTools'
import { formatClock } from '../lib/time'
import { useEditor } from '../store'

const QUICK = [
  { label: 'Auto-cut the reel', intent: 'auto-cut the reel' },
  { label: 'Auto-cut, keep tagged demo', intent: 'auto-cut this like Auto-Editor but skip the silent demo I tagged' },
  { label: 'Cut the product-name fumble', intent: 'remove the part where I fumble the product name' },
  { label: 'Find scenes / retakes', intent: 'Find scenes and mark retakes. Do not cut yet.' },
  { label: 'Collapse retakes', intent: 'collapse retakes' },
  { label: 'Put back silence', intent: 'put back silence' }
]

const TOOL_DOMAIN_LABEL: Record<ToolDomain, string> = {
  read_context: 'Read only',
  timeline_edit: 'Timeline',
  review_suggestions: 'Review',
  annotations: 'Annotation',
  scene_structure: 'Scene structure',
  transcript_content: 'Transcript content',
  visible_graphics: 'Visible graphics',
  media_layers: 'Media layer',
  picture_effects: 'Picture effect',
  audio_mix: 'Audio mix',
  internal_orchestration: 'Internal'
}

function elapsed(start: number | undefined, now: number): string {
  if (start == null) return '0s'
  const seconds = Math.max(0, Math.floor((now - start) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function AgentPanel({ onToast }: { onToast: (msg: string) => void }) {
  const project = useEditor((s) => s.project)
  const dispatch = useEditor((s) => s.dispatch)
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [modelQueue, setModelQueue] = useState<ModelQueueStatus>({ active: false, pending: 0, jobs: [] })
  const [activity, setActivity] = useState(() => agentActivityState(project.id))
  const input = useRef<HTMLTextAreaElement>(null)
  const inspectorTab = useEditor((s) => s.inspectorTab)
  const retakes = (project.scenes ?? []).filter((scene) => scene.kind === 'retake').length
  const demos = (project.scenes ?? []).filter((scene) => scene.kind === 'demo').length
  const recipe = useMemo(() => (intent.trim() ? planIntent(project, intent) : null), [intent, project])
  const followUp = activity.turns.find((turn) => turn.id === activity.selectedId)
  const liveJobs = modelQueue.jobs.filter((job) => job.state === 'running' || job.state === 'waiting' || job.state === 'error')

  useEffect(() => {
    if (inspectorTab === 'agent') input.current?.focus()
  }, [inspectorTab])

  useEffect(() => {
    void host.modelQueueStatus().then(setModelQueue).catch(() => undefined)
    return host.onModelQueue(setModelQueue)
  }, [])

  useEffect(() => {
    setActivity(agentActivityState(project.id))
    return subscribeAgentActivity(project.id, setActivity)
  }, [project.id])

  useEffect(() => {
    if (followUp) input.current?.focus()
  }, [followUp?.id])

  useEffect(() => {
    if (!modelQueue.active) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [modelQueue.active])

  async function run(text: string) {
    const question = text.trim()
    if (!question) return
    const before = useEditor.getState().project
    const sourceProjectId = before.id
    setBusy(true)
    try {
      const result = await askEditor(before, question, currentEditorSession(), followUp)
      const changed = result.project !== before
      const stillOnSourceProject = useEditor.getState().project.id === sourceProjectId
      if (changed && stillOnSourceProject) dispatch({ type: 'replaceProject', project: result.project })
      const recorded = recordAgentTurn(sourceProjectId, {
        question,
        answer: stillOnSourceProject
          ? result.message
          : `Finished after you switched projects, so no edit was applied. ${result.message}`,
        calls: result.calls,
        changed: changed && stillOnSourceProject,
        parentId: followUp?.id
      })
      if (followUp) selectAgentTurn(sourceProjectId, recorded.id)
      onToast(
        stillOnSourceProject
          ? `${changed ? 'Applied to reel' : 'No edit made'} · ${result.message}`
          : `Assistant finished for ${before.name}. Switch back to that project to review it.`
      )
      setIntent('')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Agent failed.'
      recordAgentTurn(sourceProjectId, { question, answer: message, calls: [], changed: false, failed: true, parentId: followUp?.id })
      onToast(`Agent failed · ${message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="agent-panel">
      <p className="help">
        {formatClock(project.sourceDuration)} recording · {(project.scenes ?? []).length}{' '}
        scene{(project.scenes ?? []).length === 1 ? '' : 's'}
        {retakes ? ` · ${retakes} retake${retakes === 1 ? '' : 's'}` : ''}
        {demos ? ` · ${demos} demo${demos === 1 ? '' : 's'}` : ''}
      </p>

      {(liveJobs.length > 0 || activity.turns.length > 0) && (
        <section className="agent-activity-feed" aria-live="polite">
          <header>
            <strong>Activity</strong>
            <span>{modelQueue.active ? 'Assistant is working' : `${activity.turns.length} completed`}</span>
          </header>
          {liveJobs.length > 0 && (
            <ol className="agent-job-list">
              {liveJobs.map((job, index) => (
                <li key={job.id} data-state={job.state}>
                  <span className="agent-status-dot" aria-hidden="true" />
                  <span>
                    <strong>{job.label}</strong>
                    <small>
                      {job.state === 'running'
                        ? `Working · ${elapsed(job.startedAt, now)}`
                        : job.state === 'waiting'
                          ? `Waiting · #${index + 1}`
                          : `Failed · ${job.error ?? 'Model error'}`}
                    </small>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {activity.turns.length > 0 && (
            <ol className="agent-turn-list">
              {activity.turns.slice(0, 8).map((turn) => (
                <li key={turn.id} data-state={turn.failed ? 'failed' : turn.changed ? 'applied' : 'unchanged'}>
                  <button type="button" onClick={() => selectAgentTurn(project.id, turn.id)}>
                    <span className="agent-turn-outcome">
                      {turn.failed ? 'Failed' : turn.changed ? 'Applied to reel' : 'No edit made'}
                    </span>
                    <strong>{turn.question}</strong>
                    <span>{turn.answer}</span>
                    <small>Click to ask a contextual follow-up</small>
                  </button>
                  {turn.calls.length > 0 && (
                    <details className="agent-details">
                      <summary>{turn.calls.length} tool action{turn.calls.length === 1 ? '' : 's'}</summary>
                      <ul className="agent-calls">
                        {turn.calls.map((call, index) => (
                          <li key={`${call.name}-${index}`}>
                            <span className="agent-tool-domain">
                              {TOOL_DOMAIN_LABEL[MCP_TOOLS.find((tool) => tool.name === call.name)?.contract.domain ?? 'internal_orchestration']}
                            </span>
                            <code>{call.name}</code>
                            <span>{call.message}</span>
                            {Object.keys(call.args).length > 0 && <small>{JSON.stringify(call.args)}</small>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <div className="script-tools" style={{ padding: 0 }}>
        {QUICK.map((item) => (
          <button key={item.label} className="chip" disabled={busy} onClick={() => void run(item.intent)}>
            {item.label}
          </button>
        ))}
      </div>

      <label className="field">
        <span>{followUp ? 'Follow-up' : 'Ask Assistant'}</span>
        {followUp && (
          <span className="agent-followup">
            <span><small>Using context from</small><strong>{followUp.question}</strong></span>
            <button type="button" aria-label="Start a new question" onClick={() => selectAgentTurn(project.id, null)}>×</button>
          </span>
        )}
        <textarea
          ref={input}
          rows={3}
          placeholder={followUp ? 'Ask a follow-up about that result…' : 'Remove the part where I fumble the product name…'}
          value={intent}
          disabled={busy}
          onChange={(event) => setIntent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void run(intent)
            }
          }}
        />
      </label>
      {recipe && recipe.commands.length > 0 && (
        <p className="help agent-recipe" data-ready="true">Will apply: {recipe.note}</p>
      )}
      <button className="chip agent-submit" disabled={busy || !intent.trim()} onClick={() => void run(intent)}>
        {busy ? (modelQueue.pending > 0 ? `Waiting · ${modelQueue.pending} ahead` : 'Assistant is working…') : followUp ? 'Ask follow-up' : 'Send request'}
      </button>
      <p className="help agent-apply-note">Successful edits apply immediately. Use Undo to reverse them.</p>

      <details className="agent-details agent-context">
        <summary>Editor context sent to Assistant</summary>
        <pre className="agent-brief">{renderAgentBrief(project, currentEditorSession())}</pre>
      </details>
    </div>
  )
}
