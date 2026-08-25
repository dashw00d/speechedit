import { useEffect, useRef, useState, type ReactNode } from 'react'
import { host } from '../host'
import { primarySegments, programLength } from '../lib/commands'
import {
  gapInspectorDetail,
  inspectorFocus,
  inspectorTabs,
  PACE_PRESETS,
  paceFromMargin,
  pendingSuggestionForGap,
  projectInspectorDetail,
  sceneInspectorDetail,
  suggestTask,
  suggestionInspectorDetail,
  wordsInspectorDetail,
  toastForCommand,
  toastForEdit,
  type InspectorAction,
  type InspectorNext
} from '../lib/contextActions'
import { toastForCaptionFollow } from '../lib/captions'
import { captionDefaults } from '../lib/theme'
import { isTitleCard, TITLE_PLACEHOLDER } from '../lib/title'
import { generateCaptionsFromContext } from '../lib/captionGenerate'
import { isVerticalFrame, setFrameFromContext } from '../lib/canvas'
import { applyCaptionStyleToAllFromContext } from '../lib/captionStyle'
import { addSceneLowerThirdsFromContext, isLowerThirdCard, LOWER_THIRD_PLACEHOLDER } from '../lib/lowerThird'
import { takeFamily } from '../lib/sceneAnalysis'
import { neighborScene } from '../lib/sceneChip'
import { toastForSceneRename } from '../lib/sceneRename'
import { toastForSpeakerRename } from '../lib/speakerRename'
import { copyQuoteFromContext } from '../lib/quote'
import { removeSceneFromContext } from '../lib/sceneRemove'
import { protectFromContext } from '../lib/protect'
import { describeRedaction, redactionCommand, redactionPlacement } from '../lib/redaction'
import { mergeChapterFromContext, splitChapterFromContext } from '../lib/chapterShape'
import { programToSourceOf, sourceToProgramOf } from '../lib/resolver'
import {
  currentDocumentTitle,
  relinkAllMissing,
  relinkAssetInteractive,
  relinkToast,
  saveCurrentDocument
} from '../lib/documentIo'
import { cancelExport, cancelImport } from '../lib/mediaJobs'
import { copySelectedClip, pasteClipboard } from '../lib/clipClipboard'
import { slugInsertId } from '../lib/inserts'
import { pickAudio, pickBroll } from '../lib/pickFile'
import { formatClock } from '../lib/time'
import { useEditor, usePlayback } from '../store'
import type { Command, Crop, EncoderOption } from '../types'

function cropRightOf(crop: Crop) {
  return 1 - crop.x - crop.w
}

function cropBottomOf(crop: Crop) {
  return 1 - crop.y - crop.h
}
import { AgentPanel } from './AgentPanel'
import { ModelsPanel } from './ModelsPanel'
import { StartGuide } from './StartGuide'

export function Inspector({ onToast }: { onToast?: (msg: string) => void }) {
  const project = useEditor((s) => s.project)
  const tab = useEditor((s) => s.inspectorTab)
  const setTab = useEditor((s) => s.setInspectorTab)
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const selectedClipIds = useEditor((s) => s.selectedClipIds)
  const selectedWordIds = useEditor((s) => s.selectedWordIds)
  const selectedSceneId = useEditor((s) => s.selectedSceneId)
  const selectedSuggestionId = useEditor((s) => s.selectedSuggestionId)
  const selectedGap = useEditor((s) => s.selectedGap)
  const selectSuggestion = useEditor((s) => s.selectSuggestion)
  const selectScene = useEditor((s) => s.selectScene)
  const selectGap = useEditor((s) => s.selectGap)
  const setReviewing = useEditor((s) => s.setReviewing)
  const exporting = useEditor((s) => s.exporting)
  const analyzing = useEditor((s) => s.analyzing)
  const dispatch = useEditor((s) => s.dispatch)
  const documentPath = useEditor((s) => s.documentPath)
  const dirty = useEditor((s) => s.dirty)
  const missingAssets = useEditor((s) => s.missingAssets)
  const programTime = usePlayback((s) => s.programTime)
  const seekProgram = usePlayback((s) => s.seekProgram)
  const playFromSource = usePlayback((s) => s.playFromSource)
  const playLoop = usePlayback((s) => s.playLoop)
  const showNowWord = useEditor((s) => s.showNowWord)
  const setShowNowWord = useEditor((s) => s.setShowNowWord)

  const [advanced, setAdvanced] = useState(false)
  const [encoders, setEncoders] = useState<EncoderOption[]>([
    { id: 'libx264', label: 'x264 (CPU)', hardware: false }
  ])
  const titleFieldRef = useRef<HTMLTextAreaElement>(null)
  const overlayClip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId)
  const titleCard = isTitleCard(overlayClip)
  const lowerThirdCard = isLowerThirdCard(overlayClip)
  const ownerTrack = project.tracks.find((t) => t.clips.some((c) => c.id === selectedClipId))
  const segments = primarySegments(project)
  const clip = overlayClip ?? segments.find((c) => c.id === selectedClipId)
  const isPrimary = Boolean(clip && segments.some((s) => s.id === clip.id))
  const clipKind =
    ownerTrack?.type === 'caption' || (overlayClip && overlayClip.text && !overlayClip.assetId)
      ? 'caption'
      : ownerTrack
        ? ownerTrack.type === 'audio'
          ? 'audio'
          : 'picture'
        : null
  const focus = inspectorFocus({
    exporting,
    analyzing,
    selectedWordIds,
    selectedSceneId,
    selectedClipId,
    selectedSuggestionId,
    selectedGap,
    clipKind
  })
  const tabs = inspectorTabs(focus)
  const pane = tab === 'agent' ? 'agent' : focus
  const wordsDetail = wordsInspectorDetail(project, selectedWordIds)
  const sceneDetail = selectedSceneId ? sceneInspectorDetail(project, selectedSceneId) : null
  const scenePrev = selectedSceneId ? neighborScene(project.scenes ?? [], selectedSceneId, -1) : undefined
  const sceneNext = selectedSceneId ? neighborScene(project.scenes ?? [], selectedSceneId, 1) : undefined
  const selectedScene = selectedSceneId ? project.scenes.find((s) => s.id === selectedSceneId) : undefined
  const suggestionDetail = selectedSuggestionId
    ? suggestionInspectorDetail(project, selectedSuggestionId)
    : null
  const gapDetail = selectedGap ? gapInspectorDetail(project, selectedGap.start, selectedGap.end) : null
  const projectDetail = projectInspectorDetail(project)
  const task = suggestTask(project)
  const pace = paceFromMargin(project.cutMargin)

  function hearSource(start: number, end: number) {
    playLoop(sourceToProgramOf(project, start), sourceToProgramOf(project, end))
  }

  function goToNext(next: InspectorNext) {
    if (next.suggestionId) {
      const sug = project.suggestions.find((s) => s.id === next.suggestionId)
      selectSuggestion(next.suggestionId)
      if (sug) hearSource(sug.start, sug.end)
      return
    }
    if (next.gap) {
      const sug = pendingSuggestionForGap(project, next.gap.start, next.gap.end)
      if (sug) {
        selectSuggestion(sug.id)
        hearSource(sug.start, sug.end)
      } else {
        selectGap(next.gap)
        hearSource(next.gap.start, next.gap.end)
      }
    }
  }

  function compareTakes() {
    if (!selectedSceneId) return
    const family = takeFamily(project.scenes ?? [], selectedSceneId)
    if (family.length < 2) return
    const idx = family.findIndex((s) => s.id === selectedSceneId)
    const a = family[idx]
    const b = family[(idx + 1) % family.length]
    const lo = Math.min(sourceToProgramOf(project, a.start), sourceToProgramOf(project, b.start))
    const hi = Math.max(sourceToProgramOf(project, a.end), sourceToProgramOf(project, b.end))
    selectScene(a.id)
    playLoop(lo, hi)
  }

  useEffect(() => {
    void host.encoders().then((list) => {
      if (list.length) setEncoders(list)
    })
  }, [])

  useEffect(() => {
    if (overlayClip?.text !== TITLE_PLACEHOLDER && overlayClip?.text !== LOWER_THIRD_PLACEHOLDER) return
    const field = titleFieldRef.current
    if (!field) return
    field.focus()
    field.select()
  }, [overlayClip?.id, overlayClip?.text])

  useEffect(() => {
    if (tab !== 'agent') return
    if (focus === 'words' || focus === 'suggestion' || focus === 'gap' || focus === 'scene') setTab('project')
    else if (focus === 'clip') setTab('transform')
    else if (focus === 'caption') setTab('caption')
  }, [focus, selectedWordIds, selectedSceneId, selectedSuggestionId, selectedClipId, selectedGap, tab, setTab])

  const panelTitle =
    pane === 'words' && wordsDetail
      ? wordsDetail.title
      : pane === 'scene' && sceneDetail
        ? sceneDetail.title
      : pane === 'gap' && gapDetail
        ? gapDetail.title
      : pane === 'suggestion' && suggestionDetail
        ? suggestionDetail.title
        : pane === 'job'
          ? 'Job'
          : pane === 'agent'
            ? 'Agent'
            : projectDetail.title

  return (
    <aside className="panel inspector">
      <div className="panel-head">{panelTitle}</div>
      <div className="tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            className="tab"
            data-on={pane === item.id}
            onClick={() => {
              if (item.id === 'agent') setTab('agent')
              else if (item.id === 'caption') setTab('caption')
              else if (item.id === 'clip') setTab('transform')
              else setTab('project')
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="fields">
        {pane === 'agent' && <AgentPanel onToast={onToast ?? (() => undefined)} />}
        {pane === 'job' && (
          <>
            <HelperHead
              headline={exporting ? 'Export in progress' : `Analyzing · ${analyzing}`}
              detail={
                exporting
                  ? analyzing && /transcript|whisper/i.test(analyzing)
                    ? 'Writing the program. Transcription is parked until this finishes.'
                    : 'Writing the program you see.'
                  : 'Import is building the transcript and suggestions.'
              }
            />
            <button
              className="chip"
              type="button"
              onClick={() => {
                if (exporting) void cancelExport()
                else void cancelImport()
              }}
            >
              {exporting ? 'Cancel export' : 'Cancel import'}
            </button>
          </>
        )}
        {pane === 'words' && wordsDetail && (
          <>
            <HelperHead
              headline={wordsDetail.headline}
              detail={wordsDetail.clock}
              onHear={() => {
                const words = project.transcript.words.filter((w) => selectedWordIds.includes(w.id))
                if (!words.length) return
                hearSource(Math.min(...words.map((w) => w.start)), Math.max(...words.map((w) => w.end)))
              }}
            />
            <p className="helper-excerpt">"{wordsDetail.excerpt}"</p>
            <HelperActions dispatch={dispatch} onToast={onToast} actions={wordsDetail.actions} onNavigate={compareTakes} />
            <div className="chips">
              <button
                className="chip"
                type="button"
                title="Copy with the speaker and time. Paste into Slack or a deck."
                onClick={() => onToast?.(copyQuoteFromContext().toast)}
              >
                Copy quote
              </button>
            </div>
            <HelperSection title="Adjust">
              {wordsDetail.speakerId != null && (
                <>
                  <Field label="Speaker">
                    <select
                      value={wordsDetail.speakerId}
                      onChange={(e) =>
                        dispatch({ type: 'setSpeaker', wordIds: selectedWordIds, speakerId: e.target.value })
                      }
                    >
                      {project.transcript.speakers.map((speaker) => (
                        <option key={speaker.id} value={speaker.id}>
                          {speaker.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Name">
                    <input
                      key={wordsDetail.speakerId}
                      type="text"
                      defaultValue={
                        project.transcript.speakers.find((speaker) => speaker.id === wordsDetail.speakerId)?.name ?? ''
                      }
                      aria-label="Speaker name"
                      onBlur={(e) => {
                        const speaker = project.transcript.speakers.find((row) => row.id === wordsDetail.speakerId)
                        if (!speaker) return
                        const toast = toastForSpeakerRename(speaker.name, e.target.value)
                        if (e.target.value.trim() && e.target.value.trim() !== speaker.name) {
                          dispatch({ type: 'renameSpeaker', speakerId: speaker.id, name: e.target.value.trim() })
                        }
                        if (toast) onToast?.(toast)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      }}
                    />
                  </Field>
                </>
              )}
              {selectedWordIds.length === 1 && (
                <Field label="Text">
                  <input
                    type="text"
                    defaultValue={project.transcript.words.find((w) => w.id === selectedWordIds[0])?.text ?? ''}
                    onBlur={(e) => {
                      const wordId = selectedWordIds[0]
                      if (wordId && e.target.value.trim()) {
                        const before = useEditor.getState().project
                        dispatch({ type: 'setWordText', wordId, text: e.target.value.trim() })
                        const follow = toastForCaptionFollow(before, useEditor.getState().project)
                        if (follow) onToast?.(follow)
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    }}
                  />
                </Field>
              )}
              {wordsDetail.scene && (
                <p className="help">
                  Scene · {wordsDetail.scene.title}
                  {wordsDetail.scene.summary ? ` — ${wordsDetail.scene.summary}` : ''}
                </p>
              )}
              {wordsDetail.tag ? (
                <p className="help" data-tag={wordsDetail.tag.kind}>
                  Protected · {wordsDetail.tag.label}. Auto Edit skips this.
                </p>
              ) : (
                <div className="helper-inline">
                  <button
                    className="chip"
                    type="button"
                    onClick={() => onToast?.(protectFromContext().toast)}
                  >
                    Protect
                  </button>
                  <button
                    className="chip"
                    type="button"
                    onClick={() => {
                      const words = project.transcript.words.filter((w) => selectedWordIds.includes(w.id))
                      if (!words.length) return
                      dispatch({
                        type: 'addTag',
                        start: Math.min(...words.map((w) => w.start)),
                        end: Math.max(...words.map((w) => w.end)),
                        kind: 'demo',
                        label: 'Silent product demo'
                      })
                    }}
                  >
                    Mark demo
                  </button>
                </div>
              )}
            </HelperSection>
            {wordsDetail.relatedSuggestions.length > 0 && (
              <HelperSection title="Related edits">
                {wordsDetail.relatedSuggestions.map((s) => (
                  <button
                    key={s.id}
                    className="helper-row"
                    type="button"
                    onClick={() => {
                      selectSuggestion(s.id)
                      const sug = project.suggestions.find((item) => item.id === s.id)
                      if (sug) hearSource(sug.start, sug.end)
                    }}
                  >
                    <span>{s.label}</span>
                    <span className="helper-row-meta">{s.applied ? 'applied' : s.safe ? 'safe' : 'review'}</span>
                  </button>
                ))}
              </HelperSection>
            )}
            {wordsDetail.nextHint && <HelperNext hint={wordsDetail.nextHint} />}
          </>
        )}
        {pane === 'scene' && sceneDetail && selectedSceneId && (
          <>
            <HelperHead
              headline={sceneDetail.headline}
              detail={sceneDetail.clock}
              onHear={() => selectedScene && hearSource(selectedScene.start, selectedScene.end)}
            />
            <p className="help">{sceneDetail.explanation}</p>
            {sceneDetail.excerpt && <p className="helper-excerpt">"{sceneDetail.excerpt}"</p>}
            <HelperActions dispatch={dispatch} onToast={onToast} actions={sceneDetail.actions} onNavigate={compareTakes} />
            <HelperSection title="Chapter">
              <Field label="Name">
                <input
                  key={`${selectedSceneId}-title`}
                  type="text"
                  defaultValue={selectedScene?.title ?? ''}
                  onBlur={(e) => {
                    const title = e.target.value.trim()
                    if (!title || !selectedSceneId) return
                    const toast = toastForSceneRename(selectedScene?.title ?? '', title)
                    dispatch({ type: 'renameScene', sceneId: selectedSceneId, title })
                    if (toast) onToast?.(toast)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                />
              </Field>
              <Field label="Summary">
                <input
                  key={`${selectedSceneId}-summary`}
                  type="text"
                  defaultValue={selectedScene?.summary ?? ''}
                  onBlur={(e) =>
                    dispatch({ type: 'renameScene', sceneId: selectedSceneId, summary: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                />
              </Field>
              <div className="chips">
                {selectedScene &&
                  programToSourceOf(project, programTime) > selectedScene.start + 0.2 &&
                  programToSourceOf(project, programTime) < selectedScene.end - 0.2 && (
                    <button
                      className="chip"
                      type="button"
                      title="Split this chapter at the playhead"
                      onClick={() => onToast?.(splitChapterFromContext(selectedSceneId).toast)}
                    >
                      Split chapter here
                    </button>
                  )}
                {scenePrev && (
                  <button
                    className="chip"
                    type="button"
                    title={`Join with ${scenePrev.title}`}
                    onClick={() => onToast?.(mergeChapterFromContext(-1, selectedSceneId).toast)}
                  >
                    Merge with previous
                  </button>
                )}
                {sceneNext && (
                  <button
                    className="chip"
                    type="button"
                    title={`Join with ${sceneNext.title}`}
                    onClick={() => onToast?.(mergeChapterFromContext(1, selectedSceneId).toast)}
                  >
                    Merge with next
                  </button>
                )}
              </div>
              <div className="helper-inline">
                {scenePrev && (
                  <button
                    className="chip"
                    type="button"
                    onClick={() => {
                      selectScene(scenePrev.id)
                      seekProgram(sourceToProgramOf(project, scenePrev.start))
                      playLoop(sourceToProgramOf(project, scenePrev.start), sourceToProgramOf(project, scenePrev.end))
                    }}
                  >
                    ‹ {scenePrev.title}
                  </button>
                )}
                {sceneNext && (
                  <button
                    className="chip"
                    type="button"
                    onClick={() => {
                      selectScene(sceneNext.id)
                      seekProgram(sourceToProgramOf(project, sceneNext.start))
                      playLoop(sourceToProgramOf(project, sceneNext.start), sourceToProgramOf(project, sceneNext.end))
                    }}
                  >
                    {sceneNext.title} ›
                  </button>
                )}
              </div>
            </HelperSection>
            {sceneDetail.nextHint && <HelperNext hint={sceneDetail.nextHint} />}
          </>
        )}
        {pane === 'gap' && gapDetail && (
          <>
            <HelperHead
              headline={gapDetail.headline}
              detail={gapDetail.clock}
              onHear={() => selectedGap && hearSource(selectedGap.start, selectedGap.end)}
            />
            <p className="help">{gapDetail.explanation}</p>
            {gapDetail.tag && (
              <p className="help" data-tag={gapDetail.tag.kind}>
                {gapDetail.tag.label}
              </p>
            )}
            <HelperActions dispatch={dispatch} onToast={onToast} actions={gapDetail.actions} onNavigate={compareTakes} />
            {gapDetail.similarSafeCount > 1 && (
              <p className="help">{gapDetail.similarSafeCount} safe pauses can be cleaned from the bar below.</p>
            )}
            {gapDetail.nextHint && <HelperNext hint={gapDetail.nextHint} />}
            {gapDetail.next && <HelperNext hint={gapDetail.next.label} onClick={() => goToNext(gapDetail.next!)} />}
          </>
        )}
        {pane === 'suggestion' && suggestionDetail && (
          <>
            <HelperHead
              headline={suggestionDetail.headline}
              detail={suggestionDetail.clock}
              onHear={() => {
                const sug = project.suggestions.find((s) => s.id === selectedSuggestionId)
                if (sug) hearSource(sug.start, sug.end)
              }}
            />
            <p className="help">{suggestionDetail.explanation}</p>
            {suggestionDetail.excerpt && <p className="helper-excerpt">"{suggestionDetail.excerpt}"</p>}
            <HelperActions dispatch={dispatch} onToast={onToast} actions={suggestionDetail.actions} onNavigate={compareTakes} />
            {suggestionDetail.similarCount > 0 && (
              <p className="help">
                {suggestionDetail.similarSafeCount} of {suggestionDetail.similarCount} similar{' '}
                {suggestionDetail.title} edits are safe.
              </p>
            )}
            {suggestionDetail.nextHint && <HelperNext hint={suggestionDetail.nextHint} />}
            {suggestionDetail.next && (
              <HelperNext hint={suggestionDetail.next.label} onClick={() => goToNext(suggestionDetail.next!)} />
            )}
          </>
        )}
        {(pane === 'project' || pane === 'job') && (
          <>
            {projectDetail.isEmpty && pane === 'project' && <StartGuide compact onToast={onToast} />}
            <HelperHead headline={projectDetail.headline} />
            {projectDetail.pendingByType.length > 0 && (
              <HelperSection title="Waiting">
                {projectDetail.pendingByType.map((row) => (
                  <div key={row.type} className="helper-row static">
                    <span>{row.type}</span>
                    <span className="helper-row-meta">
                      {row.safe ? `${row.safe} safe` : ''}
                      {row.safe && row.count > row.safe ? ' · ' : ''}
                      {row.count > row.safe
                        ? `${row.count - row.safe} review`
                        : row.count === row.safe
                          ? ''
                          : `${row.count} open`}
                    </span>
                  </div>
                ))}
                <button className="chip" type="button" onClick={() => setReviewing(true)}>
                  Open review
                </button>
              </HelperSection>
            )}
            {projectDetail.nextHint && pane === 'project' && <HelperNext hint={projectDetail.nextHint} />}
            {projectDetail.agentHint && pane === 'project' && (
              <p className="help agent-hint">{projectDetail.agentHint}</p>
            )}
            {!projectDetail.isEmpty && (
            <>
            <Field label="Reel name">
              <input
                type="text"
                value={project.name}
                onChange={(e) => dispatch({ type: 'setName', name: e.target.value })}
              />
            </Field>
            <p className="help">
              Program {formatClock(programLength(project))} · source {formatClock(project.sourceDuration)} ·{' '}
              {project.transcript.words.filter((w) => !w.deleted).length} live words · {project.cuts.length}{' '}
              cuts · {project.suggestions.filter((s) => !s.applied).length} open edits
            </p>
            <Field label="Document">
              <input type="text" readOnly value={documentPath || 'Unsaved — click Save'} />
            </Field>
            {(dirty || !documentPath) && (
              <button
                className="chip"
                type="button"
                onClick={() => {
                  void saveCurrentDocument().then((path) => {
                    if (path) onToast?.(`Saved ${currentDocumentTitle()}.`)
                  })
                }}
              >
                Save reel…
              </button>
            )}
            {missingAssets.map((asset) => (
              <p key={asset.id} className="help">
                Missing {asset.name}{' '}
                <button
                  className="chip"
                  type="button"
                  onClick={() => {
                    void relinkAssetInteractive(asset.id).then((result) => {
                      if (result) onToast?.(relinkToast(asset.name, result.nearby))
                    })
                  }}
                >
                  Relink…
                </button>
              </p>
            ))}
            {missingAssets.length > 1 && (
              <button
                className="chip"
                type="button"
                onClick={() => {
                  void relinkAllMissing((name) => onToast?.(`Relinked ${name}.`)).then((n) => {
                    if (n) onToast?.(`Relinked ${n} file${n === 1 ? '' : 's'}.`)
                  })
                }}
              >
                Relink all missing…
              </button>
            )}
            <button className="chip" type="button" onClick={() => setAdvanced((on) => !on)}>
              {advanced ? 'Hide advanced' : 'Advanced'}
            </button>
            {advanced && (
              <>
                <Field label="Encoder">
                  <select
                    value={project.encoder ?? 'auto'}
                    onChange={(e) => dispatch({ type: 'setEncoder', encoder: e.target.value })}
                  >
                    <option value="auto">Auto (prefer hardware)</option>
                    {encoders.map((enc) => (
                      <option key={enc.id} value={enc.id}>
                        {enc.label}
                        {enc.hardware ? ' · GPU' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                {project.transcript.speakers.map((speaker) => (
                  <Field key={speaker.id} label={speaker.name}>
                    <input
                      type="text"
                      value={speaker.name}
                      onChange={(e) =>
                        dispatch({ type: 'renameSpeaker', speakerId: speaker.id, name: e.target.value })
                      }
                    />
                  </Field>
                ))}
                <button className="chip" onClick={() => dispatch({ type: 'addSpeaker' })}>
                  Add speaker
                </button>
                {!task.showPace && (
                  <>
                    <HelperSection title="Pause padding">
                      <div className="chips">
                        {PACE_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className="chip"
                            data-active={pace === preset.id}
                            title={preset.hint}
                            onClick={() => dispatch({ type: 'setCutMargin', margin: preset.margin })}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </HelperSection>
                    <Slider
                      label="Fine-tune padding"
                      value={project.cutMargin}
                      min={0}
                      max={0.4}
                      step={0.02}
                      onChange={(margin) => dispatch({ type: 'setCutMargin', margin })}
                    />
                  </>
                )}
                {task.showPace && (
                  <Slider
                    label="Pause padding"
                    value={project.cutMargin}
                    min={0}
                    max={0.4}
                    step={0.02}
                    onChange={(margin) => dispatch({ type: 'setCutMargin', margin })}
                  />
                )}
                <ModelsPanel onToast={onToast ?? (() => undefined)} />
                <HelperSection title="Master picture">
                  <p className="help">Applies to the whole reel. Clip transform still wins on overlays.</p>
                  <div className="chips">
                    <button
                      className="chip"
                      type="button"
                      data-active={!isVerticalFrame(project)}
                      onClick={() => onToast?.(setFrameFromContext('youtube').toast)}
                    >
                      YouTube 1080
                    </button>
                    <button
                      className="chip"
                      type="button"
                      data-active={isVerticalFrame(project)}
                      title="Tall frame, centered. Drag X/Y to pick the face."
                      onClick={() => onToast?.(setFrameFromContext('vertical').toast)}
                    >
                      Vertical 9:16
                    </button>
                  </div>
                  <Slider
                    label="Scale"
                    value={project.picture.scale}
                    min={0.4}
                    max={3}
                    step={0.01}
                    onChange={(scale) => dispatch({ type: 'setPicture', transform: { scale } })}
                  />
                  <Slider
                    label="X"
                    value={project.picture.x}
                    min={-800}
                    max={800}
                    onChange={(x) => dispatch({ type: 'setPicture', transform: { x } })}
                  />
                  <Slider
                    label="Y"
                    value={project.picture.y}
                    min={-800}
                    max={800}
                    onChange={(y) => dispatch({ type: 'setPicture', transform: { y } })}
                  />
                  <Slider
                    label="Rotation"
                    value={project.picture.rotation}
                    min={-180}
                    max={180}
                    onChange={(rotation) => dispatch({ type: 'setPicture', transform: { rotation } })}
                  />
                  <Slider
                    label="Opacity"
                    value={project.picture.opacity}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(opacity) => dispatch({ type: 'setPicture', transform: { opacity } })}
                  />
                </HelperSection>
                <HelperSection title="Monitor">
                  <label className="field inline">
                    <input
                      type="checkbox"
                      checked={showNowWord}
                      onChange={(e) => setShowNowWord(e.target.checked)}
                    />
                    <span>Show current word under video</span>
                  </label>
                </HelperSection>
                {Object.values(project.assets).some((asset) => asset.proxyPath) && (
                  <p className="help">
                    Editing with a lighter preview. Export still uses the original camera file.
                  </p>
                )}
              </>
            )}
            </>
            )}
            {projectDetail.showMcpHint && pane === 'project' && (
              <p className="help mcp-hint">
                Cursor MCP: <code>bun run mcp</code> — tools read/write the live reel.
              </p>
            )}
          </>
        )}

        {pane === 'clip' && clip && clip.kind === 'slug' && (
          <>
            <HelperHead
              headline="Hold"
              detail={`${formatClock(clip.duration)} of black / silence · later clips stay put`}
              onHear={() => playLoop(clip.start, clip.start + clip.duration)}
            />
            <HelperActions
              dispatch={dispatch}
              actions={[
                {
                  id: 'close-gap',
                  label: 'Close gap',
                  consequence: 'Removes the hold and slides later clips left.',
                  command: { type: 'removeInsert', insertId: slugInsertId(clip.id) ?? '' },
                  primary: true
                }
              ]}
            />
            <div className="chips">
              {([0.5, 1, 2] as const).map((seconds) => (
                <button
                  key={seconds}
                  className="chip"
                  type="button"
                  title={`Replace this hold with ${seconds}s`}
                  onClick={() => {
                    const id = slugInsertId(clip.id)
                    if (!id) return
                    dispatch({ type: 'removeInsert', insertId: id })
                    dispatch({ type: 'insertGap', time: clip.start, duration: seconds })
                  }}
                >
                  {seconds}s
                </button>
              ))}
            </div>
          </>
        )}
        {pane === 'clip' && clip && clip.kind !== 'slug' && (
          <>
            <HelperHead
              headline={clip.text || 'Picture segment'}
              detail={`${formatClock(clip.inPoint)}–${formatClock(clip.outPoint)} · program ${formatClock(clip.start)}–${formatClock(clip.start + clip.duration)}`}
              onHear={() => playLoop(clip.start, clip.start + clip.duration)}
            />
            <HelperActions
              dispatch={dispatch}
              actions={[
                ...(clip.effect === 'blur'
                  ? [
                      {
                        id: 'remove-redact',
                        label: 'Remove redaction',
                        consequence: 'Deletes this blur region from the timeline.',
                        command: { type: 'removeClip', clipId: clip.id },
                        primary: true
                      } as InspectorAction
                    ]
                  : ownerTrack?.type === 'overlay' && !isPrimary
                    ? [
                        {
                          id: 'add-redact',
                          label: 'Add redaction',
                          consequence: describeRedaction(
                            redactionPlacement(project, programTime, selectedWordIds, selectedSceneId)
                          ),
                          command: redactionCommand(
                            redactionPlacement(project, programTime, selectedWordIds, selectedSceneId)
                          )
                        } as InspectorAction
                      ]
                    : []),
                {
                  id: 'trim-in',
                  label: 'Trim start to here',
                  consequence: isPrimary
                    ? 'Cuts everything before the playhead in this segment.'
                    : 'Moves the clip in-point to the playhead.',
                  command: isPrimary
                    ? {
                        type: 'trimPrimary',
                        segmentId: clip.id,
                        edge: 'in',
                        sourceTime: programToSourceOf(project, programTime)
                      }
                    : {
                        type: 'trimClip',
                        clipId: clip.id,
                        edge: 'in',
                        time: programTime
                      },
                  primary: true
                },
                {
                  id: 'trim-out',
                  label: 'Trim end to here',
                  consequence: isPrimary
                    ? 'Cuts everything after the playhead in this segment.'
                    : 'Moves the clip out-point to the playhead.',
                  command: isPrimary
                    ? {
                        type: 'trimPrimary',
                        segmentId: clip.id,
                        edge: 'out',
                        sourceTime: programToSourceOf(project, programTime)
                      }
                    : {
                        type: 'trimClip',
                        clipId: clip.id,
                        edge: 'out',
                        time: programTime
                      }
                },
                {
                  id: 'split',
                  label: 'Split at playhead',
                  consequence: 'Blades the clip at the current playhead position.',
                  command: { type: 'splitAt', time: programToSourceOf(project, programTime) }
                },
                ...(!isPrimary
                  ? [
                      {
                        id: 'duplicate',
                        label: 'Duplicate clip',
                        consequence: 'Places a copy right after this clip.',
                        command: { type: 'duplicateClip', clipId: clip.id }
                      } as InspectorAction,
                      {
                        id: 'extend',
                        label: 'Extend to playhead',
                        consequence: 'Grows the clip so it meets the playhead (E).',
                        command: { type: 'extendClip', clipId: clip.id, time: programTime }
                      } as InspectorAction
                    ]
                  : [])
              ]}
            />
            {selectedClipIds.length > 1 && (
              <p className="help">{selectedClipIds.length} clips selected · Delete removes all · ← → nudge together</p>
            )}
            {!isPrimary && (
              <>
                <p className="help">
                  ← → nudge one frame · Shift 1s · Alt 10 frames. Alt-drag slips media. Shift-drag slides. Shift-drag a
                  handle rolls the cut.
                </p>
                <div className="chips">
                  <button
                    className="chip"
                    type="button"
                    title="Nudge one frame earlier"
                    onClick={() =>
                      dispatch({
                        type: 'nudgeClips',
                        clipIds: selectedClipIds.length ? selectedClipIds : [clip.id],
                        delta: -1 / Math.max(1, project.fps)
                      })
                    }
                  >
                    ← Frame
                  </button>
                  <button
                    className="chip"
                    type="button"
                    title="Nudge one frame later"
                    onClick={() =>
                      dispatch({
                        type: 'nudgeClips',
                        clipIds: selectedClipIds.length ? selectedClipIds : [clip.id],
                        delta: 1 / Math.max(1, project.fps)
                      })
                    }
                  >
                    Frame →
                  </button>
                  <button
                    className="chip"
                    type="button"
                    title="Slip media one frame earlier (keep the clip where it sits)"
                    onClick={() => dispatch({ type: 'slipClip', clipId: clip.id, delta: -1 / Math.max(1, project.fps) })}
                  >
                    Slip ←
                  </button>
                  <button
                    className="chip"
                    type="button"
                    title="Slip media one frame later"
                    onClick={() => dispatch({ type: 'slipClip', clipId: clip.id, delta: 1 / Math.max(1, project.fps) })}
                  >
                    Slip →
                  </button>
                  <button
                    className="chip"
                    type="button"
                    title="Copy this clip (⌘C). Paste lands at the playhead."
                    onClick={() => {
                      if (copySelectedClip('clip')) onToast?.('Copied. ⌘V pastes at the playhead.')
                    }}
                  >
                    Copy
                  </button>
                  <button
                    className="chip"
                    type="button"
                    title="Paste the copied clip at the playhead (⌘V)"
                    onClick={() => {
                      if (pasteClipboard('clip')) onToast?.('Pasted at the playhead.')
                    }}
                  >
                    Paste here
                  </button>
                  <button
                    className="chip"
                    type="button"
                    title="Copy transform, volume, and fades onto the selected clip (⌘⇧V)"
                    onClick={() => {
                      if (pasteClipboard('look')) onToast?.('Pasted look.')
                    }}
                  >
                    Paste look
                  </button>
                </div>
              </>
            )}
            <Slider
              label="Clip volume"
              value={clip.volume}
              min={0}
              max={2}
              step={0.01}
              onChange={(volume) => dispatch({ type: 'setVolume', clipId: clip.id, volume })}
            />
            <Slider
              label="Pan"
              value={clip.pan ?? 0}
              min={-1}
              max={1}
              step={0.01}
              onChange={(pan) => dispatch({ type: 'setPan', clipId: clip.id, pan })}
            />
            {!isPrimary && (
              <>
                <p className="help">Picture-in-picture corners. Same look you can paste with ⌘⇧V.</p>
                <div className="chips">
                  {(
                    [
                      ['Top right', { x: 420, y: -280, scale: 0.32 }],
                      ['Bottom right', { x: 420, y: 280, scale: 0.32 }],
                      ['Top left', { x: -420, y: -280, scale: 0.32 }],
                      ['Bottom left', { x: -420, y: 280, scale: 0.32 }],
                      ['Center', { x: 0, y: 0, scale: 0.45 }],
                      ['Full', { x: 0, y: 0, scale: 1 }]
                    ] as const
                  ).map(([label, transform]) => (
                    <button
                      key={label}
                      className="chip"
                      type="button"
                      title={`Place this overlay ${label.toLowerCase()}`}
                      onClick={() => dispatch({ type: 'setTransform', clipId: clip.id, transform })}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    className="chip"
                    type="button"
                    title="Swap the file on this clip. The edit stays put."
                    onClick={() => {
                      void (ownerTrack?.type === 'audio' ? pickAudio() : pickBroll()).then((asset) => {
                        if (!asset) return
                        dispatch({ type: 'replaceClipMedia', clipId: clip.id, asset })
                        onToast?.(`Replaced with ${asset.name}`)
                      })
                    }}
                  >
                    Replace footage
                  </button>
                </div>
              </>
            )}
            {!isPrimary && (
              <label className="field check">
                <span>Mute clip</span>
                <input
                  type="checkbox"
                  checked={clip.muted}
                  onChange={(e) => dispatch({ type: 'setMuted', clipId: clip.id, muted: e.target.checked })}
                />
              </label>
            )}
            <button className="chip" type="button" onClick={() => setAdvanced((value) => !value)}>
              {advanced ? 'Hide transform' : 'Transform & fades'}
            </button>
            {advanced && (
              <>
            <Slider
              label="X"
              value={clip.transform.x}
              min={-800}
              max={800}
              onChange={(x) => dispatch({ type: 'setTransform', clipId: clip.id, transform: { x } })}
            />
            <Slider
              label="Y"
              value={clip.transform.y}
              min={-800}
              max={800}
              onChange={(y) => dispatch({ type: 'setTransform', clipId: clip.id, transform: { y } })}
            />
            <Slider
              label="Scale"
              value={clip.transform.scale}
              min={0.2}
              max={4}
              step={0.01}
              onChange={(scale) =>
                dispatch({ type: 'setTransform', clipId: clip.id, transform: { scale } })
              }
            />
            <Slider
              label="Rotation"
              value={clip.transform.rotation}
              min={-180}
              max={180}
              onChange={(rotation) =>
                dispatch({ type: 'setTransform', clipId: clip.id, transform: { rotation } })
              }
            />
            <Slider
              label="Opacity"
              value={clip.transform.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(opacity) =>
                dispatch({ type: 'setTransform', clipId: clip.id, transform: { opacity } })
              }
            />
            <Slider
              label="Fade in"
              value={clip.fadeIn}
              min={0}
              max={2}
              step={0.05}
              onChange={(duration) =>
                dispatch({ type: 'setFade', targetId: clip.id, edge: 'in', duration })
              }
            />
            <Slider
              label="Fade out"
              value={clip.fadeOut}
              min={0}
              max={2}
              step={0.05}
              onChange={(duration) =>
                dispatch({ type: 'setFade', targetId: clip.id, edge: 'out', duration })
              }
            />
            <Slider
              label="Crop"
              value={clip.transform.crop?.w ?? 1}
              min={0.3}
              max={1}
              step={0.01}
              onChange={(w) =>
                dispatch({
                  type: 'setTransform',
                  clipId: clip.id,
                  transform: { crop: { x: (1 - w) / 2, y: (1 - w) / 2, w, h: w } }
                })
              }
            />
            <Slider
              label="Crop left"
              value={clip.transform.crop?.x ?? 0}
              min={0}
              max={0.45}
              step={0.01}
              onChange={(x) => {
                const crop = clip.transform.crop
                const right = 1 - crop.x - crop.w
                const width = Math.max(0.2, 1 - x - right)
                dispatch({
                  type: 'setTransform',
                  clipId: clip.id,
                  transform: { crop: { ...crop, x, w: width } }
                })
              }}
            />
            <Slider
              label="Crop right"
              value={cropRightOf(clip.transform.crop)}
              min={0}
              max={0.45}
              step={0.01}
              onChange={(right) => {
                const crop = clip.transform.crop
                const width = Math.max(0.2, 1 - crop.x - right)
                dispatch({
                  type: 'setTransform',
                  clipId: clip.id,
                  transform: { crop: { ...crop, w: width } }
                })
              }}
            />
            <Slider
              label="Crop top"
              value={clip.transform.crop?.y ?? 0}
              min={0}
              max={0.45}
              step={0.01}
              onChange={(y) => {
                const crop = clip.transform.crop
                const bottom = 1 - crop.y - crop.h
                const height = Math.max(0.2, 1 - y - bottom)
                dispatch({
                  type: 'setTransform',
                  clipId: clip.id,
                  transform: { crop: { ...crop, y, h: height } }
                })
              }}
            />
            <Slider
              label="Crop bottom"
              value={cropBottomOf(clip.transform.crop)}
              min={0}
              max={0.45}
              step={0.01}
              onChange={(bottom) => {
                const crop = clip.transform.crop
                const height = Math.max(0.2, 1 - crop.y - bottom)
                dispatch({
                  type: 'setTransform',
                  clipId: clip.id,
                  transform: { crop: { ...crop, h: height } }
                })
              }}
            />
            {isPrimary && (
              <>
                <Slider
                  label="Speed"
                  value={clip.speed}
                  min={0.25}
                  max={8}
                  step={0.05}
                  onChange={(speed) =>
                    dispatch({ type: 'setSpeed', start: clip.inPoint, end: clip.outPoint, speed })
                  }
                />
                <button
                  className="chip"
                  onClick={() =>
                    dispatch({
                      type: 'addKeyframe',
                      segmentId: clip.id,
                      time: Math.min(
                        1,
                        Math.max(0, (programTime - clip.start) / Math.max(0.05, clip.duration))
                      ),
                      transform: clip.transform
                    })
                  }
                >
                  Add keyframe here
                </button>
              </>
            )}
              </>
            )}
          </>
        )}

        {pane === 'project' && advanced && (
          <>
            <Slider
              label="Master"
              value={project.audioMaster.volume}
              min={0}
              max={2}
              step={0.01}
              onChange={(volume) => dispatch({ type: 'setAudioMaster', patch: { volume } })}
            />
            <Slider
              label="Fade in"
              value={project.audioMaster.fadeIn}
              min={0}
              max={3}
              step={0.05}
              onChange={(fadeIn) => dispatch({ type: 'setAudioMaster', patch: { fadeIn } })}
            />
            <Slider
              label="Fade out"
              value={project.audioMaster.fadeOut}
              min={0}
              max={3}
              step={0.05}
              onChange={(fadeOut) => dispatch({ type: 'setAudioMaster', patch: { fadeOut } })}
            />
            <Slider
              label="Low EQ"
              value={project.audioMaster.eqLow}
              min={-12}
              max={12}
              step={0.5}
              onChange={(eqLow) => dispatch({ type: 'setAudioMaster', patch: { eqLow } })}
            />
            <Slider
              label="Mid EQ"
              value={project.audioMaster.eqMid}
              min={-12}
              max={12}
              step={0.5}
              onChange={(eqMid) => dispatch({ type: 'setAudioMaster', patch: { eqMid } })}
            />
            <Slider
              label="High EQ"
              value={project.audioMaster.eqHigh}
              min={-12}
              max={12}
              step={0.5}
              onChange={(eqHigh) => dispatch({ type: 'setAudioMaster', patch: { eqHigh } })}
            />
            <Slider
              label="Duck under B-roll"
              value={project.audioMaster.duck}
              min={0}
              max={1}
              step={0.05}
              onChange={(duck) => dispatch({ type: 'setAudioMaster', patch: { duck } })}
            />
            <label className="field check">
              <span>Compressor</span>
              <input
                type="checkbox"
                checked={project.audioMaster.compress}
                onChange={(e) =>
                  dispatch({ type: 'setAudioMaster', patch: { compress: e.target.checked } })
                }
              />
            </label>
            <label className="field check">
              <span>Normalize -16 LUFS</span>
              <input
                type="checkbox"
                checked={project.audioMaster.normalize}
                onChange={(e) =>
                  dispatch({ type: 'setAudioMaster', patch: { normalize: e.target.checked } })
                }
              />
            </label>
          </>
        )}

        {pane === 'caption' && (
          <>
            <HelperHead
              headline={titleCard ? 'Title' : lowerThirdCard ? 'Lower third' : 'Caption'}
              detail={
                titleCard
                  ? 'Type the subject line. 3 seconds on the tape.'
                  : lowerThirdCard
                    ? 'Type the name. 3 seconds on the tape.'
                    : 'Burned on V3 · lower thirds on V2'
              }
              onHear={
                overlayClip
                  ? () => playLoop(overlayClip.start, overlayClip.start + overlayClip.duration)
                  : undefined
              }
            />
            <button
              className="chip"
              onClick={() => onToast?.(generateCaptionsFromContext().toast)}
            >
              Caption remaining words
            </button>
            <button className="chip" onClick={() => onToast?.(addSceneLowerThirdsFromContext().toast)}>
              Scene lower thirds
            </button>
            <Field label="Text">
              <textarea
                ref={titleFieldRef}
                rows={titleCard ? 2 : 4}
                aria-label={titleCard ? 'Title text' : lowerThirdCard ? 'Name on screen' : 'Caption text'}
                value={overlayClip?.text ?? ''}
                onChange={(e) =>
                  overlayClip && dispatch({ type: 'setText', clipId: overlayClip.id, text: e.target.value })
                }
              />
            </Field>
            {overlayClip && (
              <>
                <Slider
                  label="Size"
                  value={overlayClip.style?.fontSize ?? 42}
                  min={18}
                  max={96}
                  onChange={(fontSize) =>
                    dispatch({ type: 'setCaptionStyle', clipId: overlayClip.id, style: { fontSize } })
                  }
                />
                <Field label="Align">
                  <select
                    value={overlayClip.style?.align ?? 'center'}
                    onChange={(e) =>
                      dispatch({
                        type: 'setCaptionStyle',
                        clipId: overlayClip.id,
                        style: { align: e.target.value as 'left' | 'center' | 'right' }
                      })
                    }
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </Field>
                <Field label="Position">
                  <select
                    value={overlayClip.style?.position ?? 'lower'}
                    onChange={(e) =>
                      dispatch({
                        type: 'setCaptionStyle',
                        clipId: overlayClip.id,
                        style: { position: e.target.value as 'lower' | 'center' | 'upper' }
                      })
                    }
                  >
                    <option value="lower">Lower third</option>
                    <option value="center">Center</option>
                    <option value="upper">Upper</option>
                  </select>
                </Field>
                <Field label="Fill">
                  <ColorField
                    value={overlayClip.style?.fill ?? captionDefaults().fill}
                    fallback={captionDefaults().fill}
                    onChange={(fill) =>
                      dispatch({ type: 'setCaptionStyle', clipId: overlayClip.id, style: { fill } })
                    }
                  />
                </Field>
                <Field label="Stroke">
                  <ColorField
                    value={overlayClip.style?.stroke ?? captionDefaults().stroke}
                    fallback={captionDefaults().stroke}
                    onChange={(stroke) =>
                      dispatch({ type: 'setCaptionStyle', clipId: overlayClip.id, style: { stroke } })
                    }
                  />
                </Field>
                <button
                  className="chip"
                  onClick={() => onToast?.(applyCaptionStyleToAllFromContext().toast)}
                >
                  Apply style to all titles
                </button>
              </>
            )}
          </>
        )}

        {pane === 'clip' && !clip && <p className="help">Select a picture segment or overlay on the tape.</p>}
      </div>
    </aside>
  )
}

function HelperHead({
  headline,
  detail,
  onHear
}: {
  headline: string
  detail?: string
  onHear?: () => void
}) {
  return (
    <div className="helper-head">
      <div className="helper-head-row">
        <p className="helper-headline">{headline}</p>
        {onHear && (
          <button className="chip" type="button" title="Hear this" onClick={onHear}>
            Hear
          </button>
        )}
      </div>
      {detail && <p className="help">{detail}</p>}
    </div>
  )
}

function colorSwatch(value: string, fallback: string): string {
  const raw = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw
      .slice(1)
      .split('')
      .map((c) => c + c)
      .join('')}`
  }
  return fallback
}

function ColorField({
  value,
  fallback,
  onChange
}: {
  value: string
  fallback: string
  onChange: (value: string) => void
}) {
  return (
    <div className="color-field">
      <input
        type="color"
        aria-label="Pick color"
        value={colorSwatch(value, fallback)}
        onChange={(e) => onChange(e.target.value)}
      />
      <input type="text" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function HelperActions({
  actions,
  dispatch,
  onNavigate,
  onToast
}: {
  actions: InspectorAction[]
  dispatch: (command: Command) => void
  onNavigate?: () => void
  onToast?: (msg: string) => void
}) {
  if (!actions.length) return null
  return (
    <div className="helper-actions">
      {actions.map((action) => (
        <button
          key={action.id}
          className="helper-action"
          data-primary={action.primary || undefined}
          type="button"
          title={action.consequence}
          onClick={() => {
            if (action.navigate === 'compare-takes') onNavigate?.()
            else if (action.id === 'cut-scene' || action.id === 'restore-scene') {
              onToast?.(removeSceneFromContext().toast)
            } else if (action.command) {
              const before = useEditor.getState().project
              dispatch(action.command)
              const toast = toastForEdit(before, action.command)
              if (toast) onToast?.(toast)
            }
          }}
        >
          <span className="helper-action-label">{action.label}</span>
          <span className="helper-action-copy">{action.consequence}</span>
        </button>
      ))}
    </div>
  )
}

function HelperSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="helper-section">
      <h3 className="helper-section-title">{title}</h3>
      {children}
    </section>
  )
}

function HelperNext({ hint, onClick }: { hint: string; onClick?: () => void }) {
  if (onClick) {
    return (
      <button className="helper-next helper-next-btn" type="button" onClick={onClick}>
        → {hint}
      </button>
    )
  }
  return <p className="helper-next">→ {hint}</p>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="slider">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span>{Number(value).toFixed(step < 1 ? 2 : 0)}</span>
      </div>
    </div>
  )
}
