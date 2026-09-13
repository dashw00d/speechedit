import { useEffect, useRef, useState } from 'react'
import { useEditor, usePlayback } from '../store'
import { useDialog } from '../useDialog'
import { WORKFLOW_PRESETS, prepareWorkflow, workflowUnavailable, type WorkflowId, type WorkflowResult } from '../lib/workflowPresets'
import { loadSettings } from '../lib/settings'
import { endpointReady } from '../lib/providers'
import { runIntelligence } from '../lib/intelligence'
import { finishActivity, startActivity } from '../lib/activity'
import { formatClock } from '../lib/time'

export function WorkflowSheet({ open, onClose, onToast }: { open: boolean; onClose: () => void; onToast: (text: string) => void }) {
  const project = useEditor((s) => s.project)
  const analyzing = useEditor((s) => s.analyzing)
  const exporting = useEditor((s) => s.exporting)
  const [useAi, setUseAi] = useState(false)
  const [captions, setCaptions] = useState(true)
  const [running, setRunning] = useState<WorkflowId | null>(null)
  const [result, setResult] = useState<WorkflowResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)
  const close = () => { request.current?.abort(); onClose() }
  const ref = useDialog(open, close)
  useEffect(() => {
    if (open) { setResult(null); setError(null) }
    return () => { request.current?.abort() }
  }, [open])
  const unavailable = workflowUnavailable(project)
  const blocked = Boolean(unavailable || analyzing || exporting || running)

  async function run(id: WorkflowId) {
    if (blocked || request.current) return
    const controller = new AbortController()
    request.current = controller
    setRunning(id)
    setError(null)
    setResult(null)
    const before = useEditor.getState().project
    usePlayback.getState().pause()
    const preset = WORKFLOW_PRESETS.find((row) => row.id === id)!
    startActivity({ id: 'quick-edit', label: preset.label, detail: useAi ? 'Finding the edit with AI…' : 'Applying local editing rules…' })
    try {
      const endpoint = loadSettings().intelligence
      const edited = await prepareWorkflow(before, id, {
        captions, useAi, signal: controller.signal,
        analyze: endpointReady(endpoint) ? (source, intent) => runIntelligence(source, endpoint, intent) : undefined
      })
      controller.signal.throwIfAborted()
      if (useEditor.getState().project !== before) throw new Error('Your project changed while this was running. Run the preset again to include those changes.')
      useEditor.getState().dispatch({ type: 'replaceProject', project: edited.project })
      useEditor.getState().clearSelection()
      useEditor.getState().setPreviewSafeCuts(false)
      usePlayback.getState().seekProgram(0)
      setResult({ ...edited, project: useEditor.getState().project })
      onToast(`${preset.label} finished. One Undo puts the whole edit back.`)
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Quick edit failed. Your project was not changed.')
    } finally {
      request.current = null
      setRunning(null)
      finishActivity('quick-edit')
    }
  }

  if (!open) return null
  return (
    <div className="confirm-back" onMouseDown={close}>
      <div className="workflow-sheet" ref={ref} role="dialog" aria-modal="true" aria-labelledby="workflow-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <header className="workflow-heading">
          <div><h2 id="workflow-title">{result ? `${result.preset.label} is ready` : 'Quick edit'}</h2><p>{result ? 'Play the result, adjust anything you like, or export.' : 'Choose the result you want. One click edits the whole reel.'}</p></div>
          <button type="button" className="chip" onClick={close}>{running ? 'Cancel' : 'Close'}</button>
        </header>
        {result ? <>
          <div className="workflow-result" role="status">
            <strong>{result.beforeSeconds < 60 ? `${result.beforeSeconds.toFixed(1)}s` : formatClock(result.beforeSeconds)} → {result.afterSeconds < 60 ? `${result.afterSeconds.toFixed(1)}s` : formatClock(result.afterSeconds)}</strong>
            <span>{Math.max(0, result.beforeSeconds - result.afterSeconds).toFixed(1)} seconds removed · {result.ai === 'used' ? 'Local rules + AI' : 'Local rules'}</span>
          </div>
          <ul className="workflow-change-list">{result.changes.map((change) => <li key={change}>{change}</li>)}</ul>
          {result.aiNote && <p className="workflow-notice">{result.aiNote}</p>}
          <div className="workflow-result-actions">
            <button type="button" className="export-btn" onClick={() => { usePlayback.getState().playLoop(0, result.afterSeconds); onClose() }}>Play result</button>
            <button type="button" className="chip" onClick={() => { onClose(); useEditor.getState().setReviewing(true) }}>Inspect edits</button>
            <button type="button" className="chip" onClick={() => { onClose(); window.dispatchEvent(new Event('speechedit:export')) }}>Export…</button>
            <button type="button" className="chip" disabled={project !== result.project} onClick={() => { useEditor.getState().undo(); setResult(null); onToast('Put the whole quick edit back.') }}>Undo this preset</button>
          </div>
        </> : <>
          <div className="workflow-options">
            <label><input type="checkbox" checked={useAi} disabled={Boolean(running)} onChange={(event) => setUseAi(event.target.checked)} /> Use AI for editorial decisions</label>
            <label><input type="checkbox" checked={captions} disabled={Boolean(running)} onChange={(event) => setCaptions(event.target.checked)} /> Add captions</label>
          </div>
          <p className="workflow-help">{useAi ? 'Uses your configured Assistant provider to analyze the transcript. If it cannot respond, local rules finish the edit.' : 'Runs locally without an AI model. Safe pause and filler detection drives the cleanup.'} Existing manual edits and protected ranges stay respected. One Undo restores the whole reel.</p>
          {unavailable && <p className="workflow-notice">{unavailable}</p>}
          {(analyzing || exporting) && <p className="workflow-notice">Wait for the current import or export to finish.</p>}
          <div className="workflow-cards">
            {WORKFLOW_PRESETS.map((preset) => <button type="button" key={preset.id} className="workflow-card" disabled={blocked} onClick={() => void run(preset.id)}>
              <strong>{preset.label}</strong><span>{preset.description}</span>
              <ul>{preset.steps.map((step) => <li key={step}>{step}</li>)}</ul>
              <b>{running === preset.id ? 'Editing…' : 'Run preset →'}</b>
            </button>)}
          </div>
          {running && <p className="workflow-notice" role="status">{useAi ? 'AI is reviewing the transcript. Local rules will finish if it takes longer than 45 seconds.' : 'Preparing your edit…'} Cancel leaves the reel unchanged.</p>}
          {error && <p className="workflow-notice" role="alert">{error}</p>}
        </>}
      </div>
    </div>
  )
}
