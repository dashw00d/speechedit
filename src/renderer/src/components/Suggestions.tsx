import { blockedByLabel, leftoverItems, leftoverKind, leftoverReviewQueue } from '../lib/analysis'
import { PACE_PRESETS, paceFromMargin, suggestTask, toastForEdit } from '../lib/contextActions'
import {
  describeRetakeReview,
  findRetakesAndReview,
  startLeftoverReview,
  startRetakeReview
} from '../lib/firstEdit'
import { applyTitleFromContext } from '../lib/title'
import { addSceneLowerThirdsFromContext, applyLowerThirdFromContext } from '../lib/lowerThird'
import { captionsNeedFilling, hasSceneLowerThirds } from '../lib/captions'
import { watchEditedReel } from '../lib/watchReel'
import { applyZoomFromContext } from '../lib/zoom'
import { applyRedactionFromContext } from '../lib/redaction'
import { addBrollFromContext } from '../lib/broll'
import { isVerticalFrame, setFrameFromContext } from '../lib/canvas'
import { clearMarksFromContext, cutMarksFromContext } from '../lib/marks'
import { projectHasPicture } from '../lib/exportActions'
import { toggleNormalizeFromContext } from '../lib/loudness'
import { generateCaptionsFromContext } from '../lib/captionGenerate'
import {
  commandForScene,
  retakeReviewQueue,
  retakeSceneDropped,
  takeFamily
} from '../lib/sceneAnalysis'
import { sourceToProgramOf } from '../lib/resolver'
import { formatClock } from '../lib/time'
import { useEditor, usePlayback } from '../store'
import type { Command, EditSuggestion, EditorialScene, SuggestionType } from '../types'

const GROUPS: { types: SuggestionType[]; title: string; putBack: string }[] = [
  { types: ['silence'], title: 'Silence', putBack: 'Put back silence' },
  { types: ['filler'], title: 'Fillers', putBack: 'Put back fillers' },
  { types: ['repeat'], title: 'Retakes', putBack: 'Put back retakes' },
  { types: ['static', 'low-motion'], title: 'Static', putBack: 'Put back static' },
  { types: ['loud'], title: 'Loudness', putBack: 'Put back loudness' },
  { types: ['pace'], title: 'Pace', putBack: 'Dismiss pace' },
  { types: ['model'], title: 'Model', putBack: 'Put back model' }
]

export function Suggestions({ onToast }: { onToast?: (msg: string) => void }) {
  const project = useEditor((s) => s.project)
  const reviewing = useEditor((s) => s.reviewing)
  const setReviewing = useEditor((s) => s.setReviewing)
  const selected = useEditor((s) => s.selectedSuggestionId)
  const selectedSceneId = useEditor((s) => s.selectedSceneId)
  const selectSuggestion = useEditor((s) => s.selectSuggestion)
  const selectScene = useEditor((s) => s.selectScene)
  const dispatch = useEditor((s) => s.dispatch)
  const ripple = useEditor((s) => s.ripple)
  const playLoop = usePlayback((s) => s.playLoop)
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
  const audioReel = !projectHasPicture(project)
  const showCaptions = task.showWatch && hasEdits && captionsNeedFilling(project)
  const showChapterNames =
    task.showWatch &&
    hasEdits &&
    !task.showMarkedExport &&
    (project.scenes ?? []).filter((scene) => scene.kind !== 'retake').length >= 2 &&
    !hasSceneLowerThirds(project)
  const showBroll = project.transcript.words.length > 0 && !task.showMarkedExport

  function hearSuggestion(s: EditSuggestion) {
    selectSuggestion(s.id)
    playLoop(sourceToProgramOf(project, s.start), sourceToProgramOf(project, s.end))
  }

  function resolveLeftover(command: Command) {
    const before = useEditor.getState().project
    dispatch(command)
    const toast = toastForEdit(before, command)
    if (toast) onToast?.(toast)
    const next = leftoverReviewQueue(useEditor.getState().project)[0]
    if (next) hearSuggestion(next)
  }

  function hearScene(scene: EditorialScene) {
    selectScene(scene.id)
    playLoop(sourceToProgramOf(project, scene.start), sourceToProgramOf(project, scene.end))
  }

  function openReview() {
    if (startLeftoverReview()) return
    if (startRetakeReview()) return
    setReviewing(true)
  }

  function resolveRetake(command: Command, scene: EditorialScene) {
    dispatch(command)
    const nextProject = useEditor.getState().project
    const live = retakeReviewQueue(nextProject).filter((row) => !retakeSceneDropped(nextProject, row))
    const dropped = retakeReviewQueue(nextProject).filter((row) => retakeSceneDropped(nextProject, row))
    const next =
      command.type === 'revertSuggestion' || command.type === 'restoreRange'
        ? dropped[0]
        : live.find((row) => row.id !== scene.id) ?? live[0]
    if (next) hearScene(next)
  }

  function sceneKindChip(kind: string, takeIndex?: number) {
    if (kind === 'demo') return 'Silent demo'
    if (kind === 'retake' || takeIndex) return takeIndex ? `Take ${takeIndex}` : 'Retake'
    return 'Scene'
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
                title={preset.hint}
                onClick={() => dispatch({ type: 'setCutMargin', margin: preset.margin })}
              >
                {preset.label}
              </button>
            ))}
        </div>
        {task.findRetakes && (
          <button
            className="review-btn"
            type="button"
            title="Mark retakes from the transcript, then hear the first one"
            onClick={() => onToast?.(findRetakesAndReview().toast)}
          >
            Find retakes
          </button>
        )}
        {task.collapseRetakes && (
          <button
            className="review-btn"
            title="Drop every superseded take. You can put them back from Review."
            onClick={() => {
              dispatch({ type: 'collapseRetakes' })
              const scene = startRetakeReview()
              onToast?.(describeRetakeReview(useEditor.getState().project, scene))
            }}
          >
            Collapse retakes
          </button>
        )}
        {showReviewToggle && (
          <button className="review-btn" onClick={() => (reviewing ? setReviewing(false) : openReview())}>
            {reviewing ? 'Hide review' : task.reviewLabel}
          </button>
        )}
          {task.fillerCount > 0 && (
            <button
              className="review-btn"
              type="button"
              title="Remove every um, uh, and you know in one undo"
              onClick={() => dispatch({ type: 'applySuggestionsByType', suggestionType: 'filler' })}
            >
              Cut {task.fillerCount} fillers
            </button>
          )}
          {task.showTitle && (
            <button
              className="review-btn"
              type="button"
              title="A 3-second title at the start. Type the subject line in the inspector."
              onClick={() => onToast?.(applyTitleFromContext().toast)}
            >
              Add title
            </button>
          )}
          {showChapterNames && (
            <button
              className="review-btn"
              type="button"
              title="A name on each chapter. Edit any one, then Apply style to all titles."
              onClick={() => onToast?.(addSceneLowerThirdsFromContext().toast)}
            >
              Chapter names
            </button>
          )}
          {task.showLowerThird && (
            <button
              className="review-btn"
              type="button"
              title="A 3-second name on screen. Type it in the inspector."
              onClick={() => onToast?.(applyLowerThirdFromContext().toast)}
            >
              Add lower third
            </button>
          )}
          {task.showZoom && (
            <button
              className="review-btn"
              type="button"
              title="Punch in on the selected words or chapter, or 3 seconds from the playhead"
              onClick={() => onToast?.(applyZoomFromContext().toast)}
            >
              Add zoom
            </button>
          )}
          {task.showZoom && (
            <button
              className="review-btn"
              type="button"
              title="Blur the selected words or chapter, or 4 seconds from the playhead. Drag the box over names or PII."
              onClick={() => onToast?.(applyRedactionFromContext().toast)}
            >
              Add redaction
            </button>
          )}
          {showBroll && (
            <button
              className="review-btn"
              type="button"
              title="A silent face cam or still in the corner. Covers the selected words or chapter, or 6 seconds from the playhead."
              onClick={() => {
                void addBrollFromContext().then((result) => onToast?.(result.toast))
              }}
            >
              Add B-roll
            </button>
          )}
          {showCaptions && (
            <button
              className="review-btn"
              type="button"
              title="Fill the tape from the live words. Titles and edited cards stay."
              onClick={() => onToast?.(generateCaptionsFromContext().toast)}
            >
              Caption remaining
            </button>
          )}
          {task.showWatch && (
            <button
              className="review-btn"
              type="button"
              title={
                hasEdits
                  ? 'Starts at 1.5× so you can skim. Switch to 1× on the monitor to hear a line.'
                  : 'Play from the start'
              }
              onClick={() => onToast?.(watchEditedReel({ skim: hasEdits }).toast)}
            >
              {hasEdits ? 'Watch edited reel' : 'Watch full reel'}
            </button>
          )}
          {task.showWatch && hasEdits && !task.showMarkedExport && (
            <>
              <button
                className="review-btn"
                type="button"
                data-active={project.audioMaster.normalize}
                title={
                  project.audioMaster.normalize
                    ? 'Already on. Click to leave the recording’s loudness as-is.'
                    : 'Voice hits -16 LUFS on export. Same as Auto Edit → Normalize.'
                }
                onClick={() => onToast?.(toggleNormalizeFromContext().toast)}
              >
                Normalize
              </button>
              <button
                className="review-btn"
                type="button"
                title={
                  audioReel
                    ? 'M4A of the cut. The sheet already has Audio only on.'
                    : 'MP4 with captions burned in unless you turn that off'
                }
                onClick={() => window.dispatchEvent(new Event('speechedit:export'))}
              >
                {audioReel ? 'Export audio' : 'Export'}
              </button>
            </>
          )}
          {task.showMarkedExport && (
            <>
              <button
                className="review-btn"
                type="button"
                title={
                  ripple
                    ? 'Remove In–Out and close the gap. Undo puts it back.'
                    : 'Lift In–Out. The hole stays. Undo puts it back.'
                }
                onClick={() => onToast?.(cutMarksFromContext().toast)}
              >
                {ripple ? 'Cut marked' : 'Lift marked'}
              </button>
              <button
                className="review-btn"
                type="button"
                data-active={isVerticalFrame(project)}
                title="Tall 9:16 frame, centered on the picture. Drag X/Y to pick the face."
                onClick={() => onToast?.(setFrameFromContext(isVerticalFrame(project) ? 'youtube' : 'vertical').toast)}
              >
                {isVerticalFrame(project) ? '16:9' : '9:16'}
              </button>
              <button
                className="safe-btn"
                type="button"
                title={
                  audioReel
                    ? 'Export only In–Out as M4A. The sheet already has Audio only on.'
                    : 'Export only In–Out. Uncheck Marked range only on the sheet for the whole reel.'
                }
                onClick={() => window.dispatchEvent(new Event('speechedit:export'))}
              >
                Export marked range
              </button>
              <button
                className="review-btn"
                type="button"
                title="Clear In and Out, then find the next clip"
                onClick={() => onToast?.(clearMarksFromContext().toast)}
              >
                Clear marks
              </button>
            </>
          )}
        {primaryApply && (
          <button className="safe-btn" onClick={() => dispatch({ type: 'applySafeSuggestions' })}>
            {task.applyLabel}
          </button>
        )}
        {primaryReview && !reviewing && (
          <button className="safe-btn" onClick={openReview}>
            {task.reviewLabel}
          </button>
        )}
      </footer>
      {reviewing && (
        <div className="drawer">
          {pending.length > 0 && (
            <div className="drawer-row drawer-head">
              <span className="kind">open</span>
              <span>{pending.length} waiting</span>
              <span />
              <span>
                <button
                  className="chip"
                  type="button"
                  title="Clear every unused suggestion in one undo"
                  onClick={() => dispatch({ type: 'dismissPendingSuggestions' })}
                >
                  Dismiss all
                </button>
              </span>
            </div>
          )}
          {project.scenes.map((scene) => {
            const family = takeFamily(project.scenes, scene.id)
            const dropped = retakeSceneDropped(project, scene)
            return (
              <div
                key={scene.id}
                className="drawer-row"
                data-kind={scene.kind}
                data-applied={dropped}
                data-on={selectedSceneId === scene.id}
                onClick={() => hearScene(scene)}
              >
                <span className="kind">{sceneKindChip(scene.kind, scene.takeIndex)}</span>
                <span>
                  {scene.takeIndex ? `Take ${scene.takeIndex} · ` : ''}
                  {scene.title}
                </span>
                <span className="kind">
                  {formatClock(scene.start)}–{formatClock(scene.end)}
                </span>
                <span>
                  <button
                    className="chip"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      hearScene(scene)
                    }}
                  >
                    Hear
                  </button>{' '}
                  {dropped ? (
                    <button
                      className="chip"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        resolveRetake(commandForScene(project, scene, 'revert'), scene)
                      }}
                    >
                      Put back
                    </button>
                  ) : scene.kind === 'retake' ? (
                    <button
                      className="chip"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        resolveRetake(commandForScene(project, scene, 'apply'), scene)
                      }}
                    >
                      Use later take
                    </button>
                  ) : family.length > 1 ? (
                    <button
                      className="chip"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        resolveRetake({ type: 'keepTake', sceneId: scene.id }, scene)
                      }}
                    >
                      Keep this take
                    </button>
                  ) : null}
                </span>
              </div>
            )
          })}
          {(() => {
            const activities = leftoverItems(project, 'activity')
            const stills = leftoverItems(project, 'still')
            const breaths = leftoverItems(project, 'breath')
            const statics = leftoverItems(project, 'static')
            const hots = leftoverItems(project, 'loud')
            return (
              <>
                {activities.length > 0 && (
                  <section className="drawer-group">
                    <div className="drawer-row drawer-head">
                      <span className="kind">Quiet picture</span>
                      <span>{activities.length} need a listen</span>
                      <span />
                      <span />
                    </div>
                    {activities.map((s) => (
                      <SuggestionRow
                        key={s.id}
                        s={s}
                        selected={selected === s.id}
                        blockedLabel={blockedByLabel(project.tags, s.blockedBy)}
                        onHear={() => hearSuggestion(s)}
                        onApply={() =>
                          resolveLeftover({
                            type: 'resolveSuggestion',
                            suggestionId: s.id,
                            resolution: 'cut'
                          })
                        }
                        onSkip={() =>
                          resolveLeftover({
                            type: 'resolveSuggestion',
                            suggestionId: s.id,
                            resolution: 'keep'
                          })
                        }
                        onResolve={(resolution) =>
                          resolveLeftover({ type: 'resolveSuggestion', suggestionId: s.id, resolution })
                        }
                      />
                    ))}
                  </section>
                )}
                {stills.length > 0 && (
                  <section className="drawer-group">
                    <div className="drawer-row drawer-head">
                      <span className="kind">Silent stills</span>
                      <span>{stills.length} need a listen</span>
                      <span />
                      <span />
                    </div>
                    {stills.map((s) => (
                      <SuggestionRow
                        key={s.id}
                        s={s}
                        selected={selected === s.id}
                        blockedLabel={blockedByLabel(project.tags, s.blockedBy)}
                        onHear={() => hearSuggestion(s)}
                        onApply={() =>
                          resolveLeftover({
                            type: 'resolveSuggestion',
                            suggestionId: s.id,
                            resolution: 'cut'
                          })
                        }
                        onSkip={() =>
                          resolveLeftover({
                            type: 'resolveSuggestion',
                            suggestionId: s.id,
                            resolution: 'keep'
                          })
                        }
                        onResolve={(resolution) =>
                          resolveLeftover({ type: 'resolveSuggestion', suggestionId: s.id, resolution })
                        }
                      />
                    ))}
                  </section>
                )}
                {breaths.length > 0 && (
                  <section className="drawer-group">
                    <div className="drawer-row drawer-head">
                      <span className="kind">Breaths</span>
                      <span>{breaths.length} kept in the reel</span>
                      <span />
                      <span>
                        <button
                          className="chip"
                          type="button"
                          title="Leave every leftover breath in the picture"
                          onClick={() =>
                            dispatch({
                              type: 'dismissSuggestions',
                              suggestionIds: breaths.map((row) => row.id)
                            })
                          }
                        >
                          Keep all breaths
                        </button>
                      </span>
                    </div>
                    {breaths.map((s) => (
                      <SuggestionRow
                        key={s.id}
                        s={s}
                        selected={selected === s.id}
                        blockedLabel={blockedByLabel(project.tags, s.blockedBy)}
                        onHear={() => hearSuggestion(s)}
                        onApply={() => dispatch({ type: 'applySuggestion', suggestionId: s.id })}
                        onSkip={() => dispatch({ type: 'dismissSuggestion', suggestionId: s.id })}
                      />
                    ))}
                  </section>
                )}
                {statics.length > 0 && (
                  <section className="drawer-group">
                    <div className="drawer-row drawer-head">
                      <span className="kind">Static screens</span>
                      <span>{statics.length} can be sped up</span>
                      <span />
                      <span>
                        <button
                          className="chip"
                          type="button"
                          title="Play every leftover static screen at 4×. One undo."
                          onClick={() =>
                            dispatch({
                              type: 'applySuggestions',
                              suggestionIds: statics.map((row) => row.id)
                            })
                          }
                        >
                          Speed all
                        </button>
                      </span>
                    </div>
                    {statics.map((s) => (
                      <SuggestionRow
                        key={s.id}
                        s={s}
                        selected={selected === s.id}
                        blockedLabel={blockedByLabel(project.tags, s.blockedBy)}
                        onHear={() => hearSuggestion(s)}
                        onApply={() => resolveLeftover({ type: 'applySuggestion', suggestionId: s.id })}
                        onSkip={() => resolveLeftover({ type: 'dismissSuggestion', suggestionId: s.id })}
                      />
                    ))}
                  </section>
                )}
                {hots.length > 0 && (
                  <section className="drawer-group">
                    <div className="drawer-row drawer-head">
                      <span className="kind">Hot audio</span>
                      <span>{hots.length} can be quieted</span>
                      <span />
                      <span>
                        <button
                          className="chip"
                          type="button"
                          title="Lower every leftover hot spike. One undo."
                          onClick={() =>
                            dispatch({
                              type: 'applySuggestions',
                              suggestionIds: hots.map((row) => row.id)
                            })
                          }
                        >
                          Quiet all
                        </button>
                      </span>
                    </div>
                    {hots.map((s) => (
                      <SuggestionRow
                        key={s.id}
                        s={s}
                        selected={selected === s.id}
                        blockedLabel={blockedByLabel(project.tags, s.blockedBy)}
                        onHear={() => hearSuggestion(s)}
                        onApply={() => resolveLeftover({ type: 'applySuggestion', suggestionId: s.id })}
                        onSkip={() => resolveLeftover({ type: 'dismissSuggestion', suggestionId: s.id })}
                      />
                    ))}
                  </section>
                )}
              </>
            )
          })()}
          {GROUPS.map((group) => {
            const rows = pending.filter(
              (s) =>
                group.types.includes(s.type) &&
                leftoverKind(s) !== 'activity' &&
                leftoverKind(s) !== 'still' &&
                leftoverKind(s) !== 'breath' &&
                leftoverKind(s) !== 'static' &&
                leftoverKind(s) !== 'loud'
            )
            if (!rows.length) return null
            return (
              <section key={group.title} className="drawer-group">
                <div className="drawer-row drawer-head">
                  <span className="kind">{group.title}</span>
                  <span>
                    {rows.length} open
                    {rows.some((s) => s.blockedBy) ? ` · ${rows.filter((s) => s.blockedBy).length} protected` : ''}
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
                    onHear={() => hearSuggestion(s)}
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
                  <div
                    key={s.id}
                    className="drawer-row"
                    data-on={selected === s.id}
                    data-applied="true"
                    onClick={() => hearSuggestion(s)}
                  >
                    <span className="kind">{s.type}</span>
                    <span>{s.label}</span>
                    <span className="kind">
                      {formatClock(s.start)}–{formatClock(s.end)}
                    </span>
                    <span>
                      <button
                        className="chip"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          hearSuggestion(s)
                        }}
                      >
                        Hear
                      </button>{' '}
                      <button
                        className="chip"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          dispatch({ type: 'revertSuggestion', suggestionId: s.id })
                        }}
                      >
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
  onHear,
  onApply,
  onSkip,
  onResolve
}: {
  s: EditSuggestion
  selected: boolean
  blockedLabel?: string
  onHear: () => void
  onApply: () => void
  onSkip: () => void
  onResolve?: (resolution: 'cut' | 'speed' | 'demo' | 'keep') => void
}) {
  const leftover = leftoverKind(s)
  return (
    <div className="drawer-row" data-on={selected} data-blocked={Boolean(s.blockedBy)} onClick={onHear}>
        <span className="kind">
          {s.blockedBy
            ? 'protected'
            : leftover === 'activity'
              ? 'activity'
              : leftover === 'still'
              ? 'still'
              : leftover === 'breath'
                ? 'breath'
                : leftover === 'static'
                  ? 'static'
                  : leftover === 'low-motion'
                    ? 'talking'
                    : leftover === 'loud'
                      ? 'hot'
                      : s.type === 'repeat'
                      ? 'retake'
                      : s.type}
        </span>
      <span>
        {s.label}
        {blockedLabel ? <em className="blocked-by">Blocked by {blockedLabel}</em> : null}
      </span>
      <span className="kind">
        {formatClock(s.start)}–{formatClock(s.end)}
      </span>
      <span>
        <button
          className="chip"
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onHear()
          }}
        >
          Hear
        </button>{' '}
        {s.blockedBy ? (
          <button
            className="chip"
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSkip()
            }}
          >
            Skip
          </button>
        ) : leftover === 'activity' || leftover === 'still' ? (
          <>
            {leftover === 'activity' && onResolve && (
              <>
                <button
                  className="chip"
                  type="button"
                  title="Keep this walkthrough. Auto Edit will skip it next time."
                  onClick={(e) => {
                    e.stopPropagation()
                    onResolve('demo')
                  }}
                >
                  Silent demo
                </button>{' '}
                <button
                  className="chip"
                  type="button"
                  title="Play this stretch at 4×"
                  onClick={(e) => {
                    e.stopPropagation()
                    onResolve('speed')
                  }}
                >
                  Speed 4×
                </button>{' '}
              </>
            )}
            <button
              className="chip"
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onResolve ? onResolve('cut') : onApply()
              }}
            >
              Cut
            </button>{' '}
            {leftover === 'still' && onResolve && (
              <>
                <button
                  className="chip"
                  type="button"
                  title="Keep this hold. Auto Edit will skip it next time."
                  onClick={(e) => {
                    e.stopPropagation()
                    onResolve('demo')
                  }}
                >
                  Silent demo
                </button>{' '}
                <button
                  className="chip"
                  type="button"
                  title="Play this wait at 4×"
                  onClick={(e) => {
                    e.stopPropagation()
                    onResolve('speed')
                  }}
                >
                  Speed 4×
                </button>{' '}
              </>
            )}
            <button
              className="chip"
              type="button"
              title="Keep this. Auto Edit will skip it next time."
              onClick={(e) => {
                e.stopPropagation()
                onResolve ? onResolve('keep') : onSkip()
              }}
            >
              Keep
            </button>
          </>
        ) : s.action === 'review' ? (
          <button
            className="chip"
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSkip()
            }}
          >
            Keep
          </button>
        ) : (
          <>
            <button
              className="chip"
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onApply()
              }}
            >
              {s.action === 'speed'
                ? `Speed ${s.speed ?? 4}×`
                : s.action === 'volume'
                  ? 'Quiet'
                  : s.action === 'normalize'
                    ? 'Normalize'
                    : 'Apply'}
            </button>{' '}
            <button
              className="chip"
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onSkip()
              }}
            >
              Keep
            </button>
          </>
        )}
      </span>
    </div>
  )
}
