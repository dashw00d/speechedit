import { useState } from 'react'
import { useEditor } from '../store'
import { askEditor } from '../lib/askModel'
import { findRetakesAndReview, startBreathReview, describeBreathReview, startRetakeReview, describeRetakeReview } from '../lib/firstEdit'
import { leftoverItems } from '../lib/analysis'
import { OverflowMenu } from './OverflowMenu'

export function ReviewTools({ onToast }: { onToast?: (text: string) => void }) {
  const notify = onToast ?? (() => undefined)
  const project = useEditor((s) => s.project)
  const dispatch = useEditor((s) => s.dispatch)
  const [finding, setFinding] = useState(false)
  const pending = project.suggestions.filter((row) => !row.applied && !row.blockedBy)
  const safe = pending.filter((row) => row.safe && (row.action === 'cut' || row.action === 'normalize'))
  const model = pending.filter((row) => row.type === 'model' && row.action === 'cut')
  return (
    <OverflowMenu tone="chip" place="below" label={finding ? 'Finding scenes…' : 'Review tools'} title="Find, apply, or put back automatic edits">
      <span className="overflow-section-label">Find things to review</span>
      <button className="overflow-item" disabled={!project.transcript.words.length || finding} onClick={() => notify(findRetakesAndReview().toast)}>Find chapters & retakes locally</button>
      <button className="overflow-item" disabled={!project.transcript.words.length || finding} onClick={async () => {
        setFinding(true)
        const original = useEditor.getState().project
        try {
          const result = await askEditor(original, 'Find scenes and mark retakes. Do not cut yet.')
          if (useEditor.getState().project !== original) {
            notify('The project changed while finding scenes. Run this again to include your latest edits.')
            return
          }
          dispatch({ type: 'replaceProject', project: result.project })
          notify(result.message)
        } catch (error) {
          notify(error instanceof Error ? error.message : 'Could not find scenes.')
        } finally { setFinding(false) }
      }}>Find chapters & retakes with AI…</button>
      <button className="overflow-item" disabled={!project.sourceDuration} onClick={() => dispatch({ type: 'rebuildSuggestions' })}>Refresh edit suggestions</button>
      <button className="overflow-item" disabled={!project.transcript.words.length} onClick={() => dispatch({ type: 'rebuildIntelligence' })}>Refresh scene analysis</button>
      {leftoverItems(project, 'breath').length > 0 && <button className="overflow-item" onClick={() => {
        const found = startBreathReview()
        notify(describeBreathReview(found ? leftoverItems(useEditor.getState().project, 'breath').length : 0))
      }}>Review remaining breaths</button>}
      {(safe.length > 0 || model.length > 0 || project.scenes.some((scene) => scene.kind === 'retake')) && <span className="overflow-section-label">Apply · Undo puts edits back</span>}
      {safe.length > 0 && <button className="overflow-item" onClick={() => dispatch({ type: 'applySafeSuggestions' })}>Apply {safe.length} safe suggestions</button>}
      {model.length > 0 && <button className="overflow-item" onClick={() => dispatch({ type: 'applyModelSuggestions' })}>Apply {model.length} AI cuts</button>}
      {project.scenes.some((scene) => scene.kind === 'retake') && <button className="overflow-item" onClick={() => {
        dispatch({ type: 'collapseRetakes' })
        const scene = startRetakeReview()
        notify(describeRetakeReview(useEditor.getState().project, scene))
      }}>Collapse retakes</button>}
      {project.suggestions.some((row) => row.applied) && <span className="overflow-section-label">Put back · Keep other edits</span>}
      {(['silence', 'filler', 'repeat', 'model'] as const).filter((type) => project.suggestions.some((row) => row.applied && row.type === type)).map((type) => (
        <button key={type} className="overflow-item" onClick={() => dispatch({ type: 'revertSuggestionType', suggestionType: type })}>
          Put back {{ silence: 'silence cuts', filler: 'fillers', repeat: 'retakes', model: 'AI cuts' }[type]}
        </button>
      ))}
    </OverflowMenu>
  )
}
