import { blockedByLabel } from '../lib/analysis'
import { PACE_PRESETS, paceFromMargin, suggestTask } from '../lib/contextActions'
import { commandForScene, suggestionForScene, takeFamily } from '../lib/sceneAnalysis'
import { sourceToProgramOf } from '../lib/resolver'
import { formatClock } from '../lib/time'
import { useEditor, usePlayback } from '../store'
import type { EditSuggestion, SuggestionType } from '../types'

const GROUPS: { types: SuggestionType[]; title: string; putBack: string }[] = [
  { types: ['silence'], title: 'Silence', putBack: 'Put back silence' },
  { types: ['filler'], title: 'Fillers', putBack: 'Put back fillers' },
  { types: ['repeat'], title: 'Retakes', putBack: 'Put back retakes' },
  { types: ['static', 'low-motion'], title: 'Static', putBack: 'Put back static' },
  { types: ['loud'], title: 'Loudness', putBack: 'Put back loudness' },
  { types: ['pace'], title: 'Pace', putBack: 'Dismiss pace' },
  { types: ['model'], title: 'Model', putBack: 'Put back model' }
]

export function Suggestions() {
  const project = useEditor((s) => s.project)
  const reviewing = useEditor((s) => s.reviewing)
  const setReviewing = useEditor((s) => s.setReviewing)
  const selected = useEditor((s) => s.selectedSuggestionId)
  const selectSuggestion = useEditor((s) => s.selectSuggestion)
  const dispatch = useEditor((s) => s.dispatch)
  const seekProgram = usePlayback((s) => s.seekProgram)
  const playFromSource = usePlayback((s) => s.playFromSource)
  const task = suggestTask(project)
  const pace = paceFromMargin(project.cutMargin)
  const previewSafeCuts = useEditor((s) => s.previewSafeCuts)
  const setPreviewSafeCuts = useEditor((s) => s.setPreviewSafeCuts)
  const primaryApply = Boolean(task.applyLabel)
  const primaryReview = !primaryApply && task.reviewCount > 0
  const showReviewToggle = (primaryApply && task.reviewCount > 0) || (primaryReview && reviewing)

  const pending = project.suggestions.filter((s) => !s.applied)
  const applied = project.suggestions.filter((s) => s.applied)
  const hasEdits = project.cuts.length > 0 || applied.length > 0

  function park(s: EditSuggestion) {
    selectSuggestion(s.id)
    seekProgram(sourceToProgramOf(project, s.start))
  }

  return (
    <>
      <footer className="suggest-bar">
        <span className="spark">✦</span>
        <span className="suggest-copy">{task.headline}</span>
        <div className="chips">
          {task.showPreviewToggle && (
            <>
              <button
                type="button"
                className="chip"
                data-active={!previewSafeCuts}
                title="Hear the raw recording before applying safe cuts"
                onClick={() => setPreviewSafeCuts(false)}
              >
                Original
              </button>
              <button
                type="button"
                className="chip"
                data-active={previewSafeCuts}
                title="Preview how safe cuts will sound — undo still works after apply"
                onClick={() => setPreviewSafeCuts(true)}
              >
                With cuts
              </button>
            </>
          )}
          {task.showPace &&
            PACE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className="chip"
                data-active={pace === preset.id}
                title={`Cut pad ${preset.margin}s`}
                onClick={() => dispatch({ type: 'setCutMargin', margin: preset.margin })}
              >
                {preset.label}
              </button>
            ))}
        </div>
        {task.findRetakes && (
          <button className="review-btn" onClick={() => dispatch({ type: 'inferScenes' })}>
            Find retakes
          </button>
        )}
        {task.collapseRetakes && (
          <button className="review-btn" onClick={() => dispatch({ type: 'collapseRetakes' })}>
            Collapse retakes
          </button>
        )}
        {showReviewToggle && (
          <button className="review-btn" onClick={() => setReviewing(!reviewing)}>
            {reviewing ? 'Hide review' : task.reviewLabel}
          </button>
        )}
        {task.showWatch && (
          <button className="review-btn" type="button" onClick={() => playFromSource(0)}>
            {hasEdits ? 'Watch edited reel' : 'Watch full reel'}
          </button>
        )}
        {primaryApply && (
          <button className="safe-btn" onClick={() => dispatch({ type: 'applySafeSuggestions' })}>
            {task.applyLabel}
          </button>
        )}
        {primaryReview && !reviewing && (
          <button className="safe-btn" onClick={() => setReviewing(true)}>
            {task.reviewLabel}
          </button>
        )}
      </footer>
      {reviewing && (
        <div className="drawer">
          {project.scenes.map((scene) => {
            const family = takeFamily(project.scenes, scene.id)
            const spoken = project.transcript.words.filter((w) => w.start >= scene.start && w.end <= scene.end)
            const dropped =
              Boolean(suggestionForScene(project, scene)?.applied) ||
              (spoken.length > 0 && spoken.every((w) => w.deleted))
            return (
              <div key={scene.id} className="drawer-row" data-kind={scene.kind} data-applied={dropped}>
                <span className="kind">{scene.kind}</span>
                <span>
                  {scene.takeIndex ? `Take ${scene.takeIndex} · ` : ''}
                  {scene.title}
                </span>
                <span className="kind">
                  {formatClock(scene.start)}–{formatClock(scene.end)}
                </span>
                <span>
                  <button className="chip" onClick={() => seekProgram(sourceToProgramOf(project, scene.start))}>
                    Park
                  </button>{' '}
                  {dropped ? (
                    <button className="chip" onClick={() => dispatch(commandForScene(project, scene, 'revert'))}>
                      Put back
                    </button>
                  ) : scene.kind === 'retake' ? (
                    <button className="chip" onClick={() => dispatch(commandForScene(project, scene, 'apply'))}>
                      Drop take
                    </button>
                  ) : family.length > 1 ? (
                    <button className="chip" onClick={() => dispatch({ type: 'keepTake', sceneId: scene.id })}>
                      Keep this take
                    </button>
                  ) : null}
                </span>
              </div>
            )
          })}
          {GROUPS.map((group) => {
            const rows = pending.filter((s) => group.types.includes(s.type))
            if (!rows.length) return null
            return (
              <section key={group.title} className="drawer-group">
                <div className="drawer-row drawer-head">
                  <span className="kind">{group.title}</span>
                  <span>
                    {rows.length} open
                    {rows.some((s) => s.blockedBy) ? ` · ${rows.filter((s) => s.blockedBy).length} guarded` : ''}
                  </span>
                  <span />
                  <span />
                </div>
                {rows.map((s) => (
                  <SuggestionRow
                    key={s.id}
                    s={s}
                    selected={selected === s.id}
                    blockedLabel={blockedByLabel(project.tags, s.blockedBy)}
                    onPark={() => park(s)}
                    onApply={() => dispatch({ type: 'applySuggestion', suggestionId: s.id })}
                    onSkip={() => dispatch({ type: 'dismissSuggestion', suggestionId: s.id })}
                  />
                ))}
              </section>
            )
          })}
          {applied.length > 0 && (
            <div className="drawer-row applied-head">
              <span className="kind">applied</span>
              <span>Put back one auto-edit, or a whole type, without undoing the rest</span>
              <span />
              <span />
            </div>
          )}
          {GROUPS.map((group) => {
            const rows = applied.filter((s) => group.types.includes(s.type))
            if (!rows.length) return null
            return (
              <section key={`applied-${group.title}`} className="drawer-group" data-applied="true">
                <div className="drawer-row drawer-head applied-head">
                  <span className="kind">{group.title}</span>
                  <span>{rows.length} applied</span>
                  <span />
                  <span>
                    {group.types
                      .filter((type) => rows.some((s) => s.type === type))
                      .map((type) => (
                        <button
                          key={type}
                          className="chip"
                          onClick={() => dispatch({ type: 'revertSuggestionType', suggestionType: type })}
                        >
                          {group.putBack}
                        </button>
                      ))}
                  </span>
                </div>
                {rows.map((s) => (
                  <div key={s.id} className="drawer-row" data-on={selected === s.id} data-applied="true">
                    <span className="kind">{s.type}</span>
                    <span>{s.label}</span>
                    <span className="kind">
                      {formatClock(s.start)}–{formatClock(s.end)}
                    </span>
                    <span>
                      <button className="chip" onClick={() => park(s)}>
                        Park
                      </button>{' '}
                      <button className="chip" onClick={() => dispatch({ type: 'revertSuggestion', suggestionId: s.id })}>
                        Put back one
                      </button>
                    </span>
                  </div>
                ))}
              </section>
            )
          })}
          {pending.length === 0 && applied.length === 0 && project.scenes.length === 0 && (
            <div className="drawer-row">No open suggestions.</div>
          )}
        </div>
      )}
    </>
  )
}

function SuggestionRow({
  s,
  selected,
  blockedLabel,
  onPark,
  onApply,
  onSkip
}: {
  s: EditSuggestion
  selected: boolean
  blockedLabel?: string
  onPark: () => void
  onApply: () => void
  onSkip: () => void
}) {
  return (
    <div className="drawer-row" data-on={selected} data-blocked={Boolean(s.blockedBy)}>
      <span className="kind">{s.blockedBy ? 'guarded' : s.type}</span>
      <span>
        {s.label}
        {blockedLabel ? <em className="blocked-by">Blocked by {blockedLabel}</em> : null}
      </span>
      <span className="kind">
        {formatClock(s.start)}–{formatClock(s.end)}
      </span>
      <span>
        <button className="chip" onClick={onPark}>
          Park
        </button>{' '}
        {s.blockedBy ? (
          <button className="chip" onClick={onSkip}>
            Skip
          </button>
        ) : s.action === 'review' ? (
          <button className="chip" onClick={onSkip}>
            Keep
          </button>
        ) : (
          <button className="chip" onClick={onApply}>
            {s.action === 'speed' ? `Speed ${s.speed ?? 4}×` : s.action === 'normalize' ? 'Normalize' : 'Apply'}
          </button>
        )}
      </span>
    </div>
  )
}
