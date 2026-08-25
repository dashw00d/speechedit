import { sourceToProgramOf } from '../lib/resolver'
import { formatClock } from '../lib/time'
import { useEditor, usePlayback } from '../store'

export function Suggestions() {
  const project = useEditor((s) => s.project)
  const reviewing = useEditor((s) => s.reviewing)
  const setReviewing = useEditor((s) => s.setReviewing)
  const selected = useEditor((s) => s.selectedSuggestionId)
  const selectSuggestion = useEditor((s) => s.selectSuggestion)
  const dispatch = useEditor((s) => s.dispatch)
  const seekProgram = usePlayback((s) => s.seekProgram)

  const pending = project.suggestions.filter((s) => !s.applied)
  const applied = project.suggestions.filter((s) => s.applied)
  const safe = pending.filter((s) => s.safe && !s.blockedBy && (s.action === 'cut' || s.action === 'normalize'))
  const blocked = pending.filter((s) => s.blockedBy)
  const counts = {
    silence: pending.filter((s) => s.type === 'silence').length,
    filler: pending.filter((s) => s.type === 'filler').length,
    repeat: pending.filter((s) => s.type === 'repeat').length,
    static: pending.filter((s) => s.type === 'static' || s.type === 'low-motion').length,
    pace: pending.filter((s) => s.type === 'pace' || s.type === 'loud').length,
    model: pending.filter((s) => s.type === 'model').length
  }

  return (
    <>
      <footer className="suggest-bar">
        <span className="spark">✦</span>
        <span className="suggest-copy">
          {pending.length} automatic edits
          {safe.length ? ` · ${safe.length} safe` : ''}
          {blocked.length ? ` · ${blocked.length} protected` : ''}
          {applied.length ? ` · ${applied.length} applied` : ''}
        </span>
        <div className="chips">
          <span className="chip">
            <strong>{counts.silence}</strong> silence
          </span>
          <span className="chip">
            <strong>{counts.filler}</strong> fillers
          </span>
          <span className="chip">
            <strong>{counts.repeat}</strong> retakes
          </span>
          {counts.model > 0 && (
            <span className="chip">
              <strong>{counts.model}</strong> model
            </span>
          )}
          <span className="chip">
            <strong>{counts.static}</strong> static
          </span>
          <span className="chip">
            <strong>{counts.pace}</strong> pace
          </span>
        </div>
        <button className="review-btn" onClick={() => setReviewing(!reviewing)}>
          {reviewing ? 'Hide review' : 'Review'}
        </button>
        <button
          className="safe-btn"
          disabled={!safe.length}
          onClick={() => dispatch({ type: 'applySafeSuggestions' })}
        >
          Apply safe edits
        </button>
      </footer>
      {reviewing && (
        <div className="drawer">
          {pending.map((s) => (
            <div key={s.id} className="drawer-row" data-on={selected === s.id} data-blocked={Boolean(s.blockedBy)}>
              <span className="kind">{s.blockedBy ? 'protected' : s.type}</span>
              <span>{s.label}</span>
              <span className="kind">
                {formatClock(s.start)}–{formatClock(s.end)}
              </span>
              <span>
                <button
                  className="chip"
                  onClick={() => {
                    selectSuggestion(s.id)
                    seekProgram(sourceToProgramOf(project, s.start))
                  }}
                >
                  Park
                </button>{' '}
                {s.blockedBy ? (
                  <button className="chip" onClick={() => dispatch({ type: 'dismissSuggestion', suggestionId: s.id })}>
                    Skip
                  </button>
                ) : s.action === 'review' ? (
                  <button className="chip" onClick={() => dispatch({ type: 'dismissSuggestion', suggestionId: s.id })}>
                    Keep
                  </button>
                ) : (
                  <button className="chip" onClick={() => dispatch({ type: 'applySuggestion', suggestionId: s.id })}>
                    {s.action === 'speed' ? `Speed ${s.speed ?? 4}×` : s.action === 'normalize' ? 'Normalize' : 'Apply'}
                  </button>
                )}
              </span>
            </div>
          ))}
          {applied.length > 0 && (
            <div className="drawer-row applied-head">
              <span className="kind">applied</span>
              <span>Put back one auto-edit without undoing the rest</span>
              <span />
              <span>
                <button className="chip" onClick={() => dispatch({ type: 'revertSuggestionType', suggestionType: 'silence' })}>
                  Revert silence
                </button>
              </span>
            </div>
          )}
          {applied.map((s) => (
            <div key={s.id} className="drawer-row" data-on={selected === s.id} data-applied="true">
              <span className="kind">{s.type}</span>
              <span>{s.label}</span>
              <span className="kind">
                {formatClock(s.start)}–{formatClock(s.end)}
              </span>
              <span>
                <button
                  className="chip"
                  onClick={() => {
                    selectSuggestion(s.id)
                    seekProgram(sourceToProgramOf(project, s.start))
                  }}
                >
                  Park
                </button>{' '}
                <button className="chip" onClick={() => dispatch({ type: 'revertSuggestion', suggestionId: s.id })}>
                  Put back
                </button>
              </span>
            </div>
          ))}
          {pending.length === 0 && applied.length === 0 && <div className="drawer-row">No open suggestions.</div>}
        </div>
      )}
    </>
  )
}
