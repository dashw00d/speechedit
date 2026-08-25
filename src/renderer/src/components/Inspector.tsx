import { useEffect, useState, type ReactNode } from 'react'
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
  type InspectorAction,
  type InspectorNext
} from '../lib/contextActions'
import { takeFamily } from '../lib/sceneAnalysis'
import { programToSourceOf, sourceToProgramOf } from '../lib/resolver'
import { currentDocumentTitle, relinkAssetInteractive } from '../lib/documentIo'
import { cancelExport, cancelImport } from '../lib/mediaJobs'
import { formatClock } from '../lib/time'
import { useEditor, usePlayback } from '../store'
import type { Command, EncoderOption } from '../types'
import { AgentPanel } from './AgentPanel'
import { ModelsPanel } from './ModelsPanel'
import { StartGuide } from './StartGuide'

export function Inspector({ onToast }: { onToast?: (msg: string) => void }) {
  const project = useEditor((s) => s.project)
  const tab = useEditor((s) => s.inspectorTab)
  const setTab = useEditor((s) => s.setInspectorTab)
  const selectedClipId = useEditor((s) => s.selectedClipId)
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
  const overlayClip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId)
  const ownerTrack = project.tracks.find((t) => t.clips.some((c) => c.id === selectedClipId))
  const segments = primarySegments(project)
  const clip = overlayClip ?? segments.find((c) => c.id === selectedClipId)
  const isPrimary = Boolean(clip && segments.some((s) => s.id === clip.id))
  const clipKind =
    ownerTrack?.type === 'caption' || (overlayClip && overlayClip.text)
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
  const suggestionDetail = selectedSuggestionId
    ? suggestionInspectorDetail(project, selectedSuggestionId)
    : null
  const gapDetail = selectedGap ? gapInspectorDetail(project, selectedGap.start, selectedGap.end) : null
  const projectDetail = projectInspectorDetail(project)
  const task = suggestTask(project)
  const pace = paceFromMargin(project.cutMargin)

  function goToNext(next: InspectorNext) {
    if (next.suggestionId) {
      const sug = project.suggestions.find((s) => s.id === next.suggestionId)
      selectSuggestion(next.suggestionId)
      if (sug) seekProgram(sourceToProgramOf(project, sug.start))
      return
    }
    if (next.gap) {
      const sug = pendingSuggestionForGap(project, next.gap.start, next.gap.end)
      if (sug) {
        selectSuggestion(sug.id)
        seekProgram(sourceToProgramOf(project, sug.start))
      } else {
        selectGap(next.gap)
        seekProgram(sourceToProgramOf(project, next.gap.start))
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
              detail={exporting ? 'Writing the program you see.' : 'Import is building the transcript and suggestions.'}
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
            <HelperHead headline={wordsDetail.headline} detail={wordsDetail.clock} />
            <p className="helper-excerpt">"{wordsDetail.excerpt}"</p>
            <HelperActions dispatch={dispatch} actions={wordsDetail.actions} onNavigate={compareTakes} />
            <HelperSection title="Adjust">
              {wordsDetail.speakerId != null && (
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
              )}
              {selectedWordIds.length === 1 && (
                <Field label="Text">
                  <input
                    type="text"
                    defaultValue={project.transcript.words.find((w) => w.id === selectedWordIds[0])?.text ?? ''}
                    onBlur={(e) => {
                      const wordId = selectedWordIds[0]
                      if (wordId && e.target.value.trim()) {
                        dispatch({ type: 'setWordText', wordId, text: e.target.value.trim() })
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
                    onClick={() => {
                      const words = project.transcript.words.filter((w) => selectedWordIds.includes(w.id))
                      if (!words.length) return
                      dispatch({
                        type: 'addTag',
                        start: Math.min(...words.map((w) => w.start)),
                        end: Math.max(...words.map((w) => w.end)),
                        kind: 'keep'
                      })
                    }}
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
                    onClick={() => selectSuggestion(s.id)}
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
        {pane === 'scene' && sceneDetail && (
          <>
            <HelperHead headline={sceneDetail.headline} detail={sceneDetail.clock} />
            <p className="help">{sceneDetail.explanation}</p>
            {sceneDetail.excerpt && <p className="helper-excerpt">"{sceneDetail.excerpt}"</p>}
            <HelperActions dispatch={dispatch} actions={sceneDetail.actions} onNavigate={compareTakes} />
            {sceneDetail.nextHint && <HelperNext hint={sceneDetail.nextHint} />}
          </>
        )}
        {pane === 'gap' && gapDetail && (
          <>
            <HelperHead headline={gapDetail.headline} detail={gapDetail.clock} />
            <p className="help">{gapDetail.explanation}</p>
            {gapDetail.tag && (
              <p className="help" data-tag={gapDetail.tag.kind}>
                {gapDetail.tag.label}
              </p>
            )}
            <HelperActions dispatch={dispatch} actions={gapDetail.actions} onNavigate={compareTakes} />
            {gapDetail.similarSafeCount > 1 && (
              <p className="help">{gapDetail.similarSafeCount} safe pauses can be cleaned from the bar below.</p>
            )}
            {gapDetail.nextHint && <HelperNext hint={gapDetail.nextHint} />}
            {gapDetail.next && <HelperNext hint={gapDetail.next.label} onClick={() => goToNext(gapDetail.next!)} />}
          </>
        )}
        {pane === 'suggestion' && suggestionDetail && (
          <>
            <HelperHead headline={suggestionDetail.headline} detail={suggestionDetail.clock} />
            <p className="help">{suggestionDetail.explanation}</p>
            {suggestionDetail.excerpt && <p className="helper-excerpt">"{suggestionDetail.excerpt}"</p>}
            <HelperActions dispatch={dispatch} actions={suggestionDetail.actions} onNavigate={compareTakes} />
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
            {projectDetail.isEmpty && pane === 'project' && <StartGuide compact />}
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
              <input type="text" readOnly value={documentPath || 'Unsaved — use File → Save'} />
            </Field>
            {missingAssets.map((asset) => (
              <p key={asset.id} className="help">
                Missing {asset.name}{' '}
                <button
                  className="chip"
                  type="button"
                  onClick={() => {
                    void relinkAssetInteractive(asset.id).then((path) => {
                      if (path) onToast?.(`Relinked ${asset.name}.`)
                    })
                  }}
                >
                  Relink…
                </button>
              </p>
            ))}
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
                            title={`Leave about ${preset.margin}s between cuts`}
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
                    label="Cut pad"
                    value={project.cutMargin}
                    min={0}
                    max={0.4}
                    step={0.02}
                    onChange={(margin) => dispatch({ type: 'setCutMargin', margin })}
                  />
                )}
                <ModelsPanel onToast={onToast ?? (() => undefined)} />
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

        {pane === 'clip' && clip && (
          <>
            <HelperHead
              headline={clip.text || 'Picture segment'}
              detail={`${formatClock(clip.inPoint)}–${formatClock(clip.outPoint)} · program ${formatClock(clip.start)}–${formatClock(clip.start + clip.duration)}`}
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
                          label: 'Blur/redact here',
                          consequence: 'Adds a redaction overlay at the playhead.',
                          command: {
                            type: 'addRedaction',
                            start: programToSourceOf(project, programTime),
                            duration: 2
                          }
                        } as InspectorAction
                      ]
                    : []),
                {
                  id: 'trim-in',
                  label: 'Trim to playhead (in)',
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
                  label: 'Trim to playhead (out)',
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
                }
              ]}
            />
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
            <Slider
              label="Clip volume"
              value={clip.volume}
              min={0}
              max={2}
              step={0.01}
              onChange={(volume) => dispatch({ type: 'setVolume', clipId: clip.id, volume })}
            />
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
            <HelperHead headline="Caption" detail="Burned on V3 · lower thirds on V2" />
            <button
              className="chip"
              onClick={() =>
                dispatch({
                  type: 'generateCaptions',
                  maxWords: 5,
                  speakerPrefix: project.transcript.speakers.length > 1,
                  emphasize: true
                })
              }
            >
              Caption remaining words
            </button>
            <button className="chip" onClick={() => dispatch({ type: 'addLowerThirds' })}>
              Scene lower thirds
            </button>
            <Field label="Text">
              <textarea
                rows={4}
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
                  <input
                    type="text"
                    value={overlayClip.style?.fill ?? '#F4EEE4'}
                    onChange={(e) =>
                      dispatch({ type: 'setCaptionStyle', clipId: overlayClip.id, style: { fill: e.target.value } })
                    }
                  />
                </Field>
                <Field label="Stroke">
                  <input
                    type="text"
                    value={overlayClip.style?.stroke ?? '#16140F'}
                    onChange={(e) =>
                      dispatch({
                        type: 'setCaptionStyle',
                        clipId: overlayClip.id,
                        style: { stroke: e.target.value }
                      })
                    }
                  />
                </Field>
                <button
                  className="chip"
                  onClick={() =>
                    dispatch({
                      type: 'setCaptionStyleAll',
                      style: overlayClip.style ?? {}
                    })
                  }
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

function HelperHead({ headline, detail }: { headline: string; detail?: string }) {
  return (
    <div className="helper-head">
      <p className="helper-headline">{headline}</p>
      {detail && <p className="help">{detail}</p>}
    </div>
  )
}

function HelperActions({
  actions,
  dispatch,
  onNavigate
}: {
  actions: InspectorAction[]
  dispatch: (command: Command) => void
  onNavigate?: () => void
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
            else if (action.command) dispatch(action.command)
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
