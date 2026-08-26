import { blockedByLabel, leftoverItems, leftoverKind } from '../lib/analysis'
import { isFillerToken } from '../lib/transcript'
import {
  leftoverReviewItems,
  reviewDecisionScenes,
  reviewDrawerCopy,
  reviewJob,
  reviewJobCount,
  reviewOtherPending
} from '../lib/reviewDrawer'
import { PACE_PRESETS, paceFromMargin, suggestTask, toastForEdit } from '../lib/contextActions'
import {
  describeBreathReview,
  describeTakeDecision,
  findRetakesAndReview,
  nextLeftoverToHear,
  openReviewFromContext,
  startBreathReview
} from '../lib/firstEdit'
import { applyTitleFromContext } from '../lib/title'
import { addSceneLowerThirdsFromContext, applyLowerThirdFromContext } from '../lib/lowerThird'
import { captionsNeedFilling, hasSceneLowerThirds } from '../lib/captions'
import { watchEditedReel } from '../lib/watchReel'
import { applyZoomFromContext } from '../lib/zoom'
import { applyRedactionFromContext } from '../lib/redaction'
import { addBrollFromContext } from '../lib/broll'
import { addMusicFromContext, hasMusicBed } from '../lib/music'
import { copyStillFromContext } from '../lib/still'
import {
  leftoverAllows,
  leftoverCutFromContext,
  leftoverDemoFromContext,
  leftoverHearFromContext,
  leftoverHearTarget,
  leftoverActiveTarget,
  leftoverHearLabel,
  leftoverIsBreath,
  leftoverKeepFromContext,
  leftoverQuietFromContext,
  leftoverSpeedFromContext
} from '../lib/leftoverDecide'
import { planSuggestBar, suggestBarJob, type BarActionId } from '../lib/suggestBar'
import { OverflowMenu } from './OverflowMenu'
import { chapterMergeTarget, chapterSplitPlacement, mergeChapterFromContext, splitChapterFromContext } from '../lib/chapterShape'
import { removeSceneFromContext, sceneIsRemoved, sceneRemoveTarget } from '../lib/sceneRemove'
import { isVerticalFrame, setFrameFromContext } from '../lib/canvas'
import { clearMarksFromContext, cutMarksFromContext, markClipFromContext, tightenMarksFromContext } from '../lib/marks'
import { exportSidecar, hasExportableCaptions, hasYouTubeChapters, projectHasPicture } from '../lib/exportActions'
import { toggleNormalizeFromContext } from '../lib/loudness'
import { protectCutTarget, protectFromContext, protectParkedCut } from '../lib/protect'
import { applyCaptionStyleToAllFromContext, canApplyCaptionStyleAll, textClipsOf } from '../lib/captionStyle'
import { addNoteFromContext } from '../lib/noteEdit'
import { copyQuoteFromContext } from '../lib/quote'
import { cutPreviousFromContext } from '../lib/cutPrevious'
import { cutThisFromContext } from '../lib/cutSentence'
import { isParagraphSelection, liveSentenceRange, restartBeforeWord } from '../lib/transcriptEdit'
import { cutParagraphFromContext } from '../lib/scriptActions'
import { generateCaptionsFromContext } from '../lib/captionGenerate'
import {
  commandForScene,
  retakeReviewQueue,
  retakeSceneDropped,
  takeFamily,
  uncollapsedRetakeCount
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
  const selectedWordIds = useEditor((s) => s.selectedWordIds)
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const selectSuggestion = useEditor((s) => s.selectSuggestion)
  const selectScene = useEditor((s) => s.selectScene)
  const clearSelection = useEditor((s) => s.clearSelection)
  const selectedGap = useEditor((s) => s.selectedGap)
  const dispatch = useEditor((s) => s.dispatch)
  const ripple = useEditor((s) => s.ripple)
  const playLoop = usePlayback((s) => s.playLoop)
  const programTime = usePlayback((s) => s.programTime)
  const task = suggestTask(project)
  const pace = paceFromMargin(project.cutMargin)
  const previewSafeCuts = useEditor((s) => s.previewSafeCuts)
  const setPreviewSafeCuts = useEditor((s) => s.setPreviewSafeCuts)
  const primaryApply = Boolean(task.applyLabel)
  const primaryReview = !primaryApply && task.reviewCount > 0
  const showReviewToggle = !reviewing && primaryApply && task.reviewCount > 0

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
  const parked = Boolean(selectedSceneId) || selectedWordIds.length > 0 || Boolean(selectedClipId)
  const showDecorate = (hasEdits || parked) && !task.showMarkedExport
  const showBroll = showDecorate
  const showMusic = showBroll && !hasMusicBed(project)
  const showCopyFrame = showDecorate
  const showCopyChapters =
    task.showWatch && hasEdits && !task.showMarkedExport && hasYouTubeChapters(project)
  const showCopyNotes =
    task.showWatch && hasEdits && !task.showMarkedExport && project.transcript.words.some((word) => !word.deleted)
  const showExportSrt =
    task.showWatch &&
    hasEdits &&
    !task.showMarkedExport &&
    hasExportableCaptions(project) &&
    !showCaptions
  const headingSelected = Boolean(selectedSceneId)
  const showSplitChapter = Boolean(
    chapterSplitPlacement(project, programTime, selectedWordIds, selectedSceneId)
  )
  const leftover = leftoverHearTarget(project, selected)
  const activeLeftover = leftoverActiveTarget(project, selected)
  const showHearLeftover = !task.showMarkedExport && Boolean(leftover)
  const showSpeedLeftover = Boolean(activeLeftover && leftoverAllows(activeLeftover, 'speed'))
  const showDemoLeftover = Boolean(activeLeftover && leftoverAllows(activeLeftover, 'demo'))
  const showCutLeftover = Boolean(activeLeftover && leftoverAllows(activeLeftover, 'cut'))
  const showKeepLeftover = Boolean(activeLeftover && leftoverAllows(activeLeftover, 'keep'))
  const showQuietLeftover = Boolean(activeLeftover && leftoverAllows(activeLeftover, 'quiet'))
  const protectParked = protectParkedCut(project)
  const showProtectPause =
    !task.showMarkedExport && Boolean(protectParked || protectCutTarget(project))
  const showProtectNow = !task.showMarkedExport && Boolean(protectParked)
  const selectedTextClip =
    Boolean(selectedClipId) && textClipsOf(project).some((clip) => clip.id === selectedClipId)
  const showApplyStyle = selectedTextClip && canApplyCaptionStyleAll(project, selectedClipId)
  const showCopyQuote =
    !task.showMarkedExport &&
    selectedWordIds.some((id) => project.transcript.words.some((word) => word.id === id && !word.deleted))
  const showCutPrev =
    showCopyQuote && Boolean(restartBeforeWord(project.transcript.words, selectedWordIds[0] ?? ''))
  const fillerOnly =
    selectedWordIds.length > 0 &&
    selectedWordIds.every((id) => {
      const word = project.transcript.words.find((row) => row.id === id)
      return Boolean(word && !word.deleted && isFillerToken(word.text))
    })
  const showCutParagraph =
    showCopyQuote &&
    !headingSelected &&
    !fillerOnly &&
    isParagraphSelection(project.transcript.words, selectedWordIds)
  const showCutSentence =
    showCopyQuote &&
    !showCutPrev &&
    !showCutParagraph &&
    !headingSelected &&
    !fillerOnly &&
    Boolean(liveSentenceRange(project.transcript.words, selectedWordIds[0] ?? ''))
  const mergePrev = chapterMergeTarget(project, programTime, selectedWordIds, selectedSceneId, -1)
  const mergeNext = chapterMergeTarget(project, programTime, selectedWordIds, selectedSceneId, 1)
  const showMergePrev = Boolean(mergePrev) && (headingSelected || showCopyQuote)
  const showMergeNext = Boolean(mergeNext) && (headingSelected || showCopyQuote)
  const showMarkClip = !task.showMarkedExport && (headingSelected || showCopyQuote)
  const showAddNote = showMarkClip
  const removeScene = sceneRemoveTarget(project, programTime, selectedWordIds, selectedSceneId)
  const showRemoveScene = Boolean(removeScene) && (headingSelected || showCopyQuote)
  const selecting = showCopyQuote || headingSelected || selectedTextClip || showProtectNow
  const barJob = suggestBarJob({
    marked: task.showMarkedExport,
    selecting,
    leftover: showHearLeftover,
    leftoverDecide: Boolean(activeLeftover),
    retake: task.collapseRetakes || task.findRetakes,
    preClean: Boolean(task.applyLabel) && !hasEdits
  })
  const available: BarActionId[] = (
    [
      showHearLeftover && 'hear-leftover',
      showDemoLeftover && 'silent-demo',
      showSpeedLeftover && 'speed-4x',
      showCutLeftover && 'cut-leftover',
      showKeepLeftover && 'keep-leftover',
      showQuietLeftover && 'quiet-leftover',
      showProtectPause && 'protect-pause',
      showCutPrev && 'cut-prev',
      showCutSentence && 'cut-sentence',
      showCutParagraph && 'cut-paragraph',
      task.showBreaths && 'breaths',
      task.fillerCount > 0 && 'cut-fillers',
      task.findRetakes && 'find-retakes',
      task.collapseRetakes && 'collapse-retakes',
      showReviewToggle && 'review',
      task.showTitle && 'add-title',
      showChapterNames && 'chapter-names',
      showApplyStyle && 'apply-style',
      task.showLowerThird && 'add-lower-third',
      task.showZoom && 'add-zoom',
      task.showZoom && 'add-redaction',
      showBroll && 'add-broll',
      showMusic && 'add-music',
      showCopyQuote && 'copy-quote',
      showCopyFrame && 'copy-frame',
      showMarkClip && 'mark-clip',
      showAddNote && 'add-note',
      showRemoveScene && 'remove-scene',
      showMergePrev && 'merge-prev',
      showMergeNext && 'merge-next',
      showSplitChapter && 'split-chapter',
      showCopyNotes && 'copy-notes',
      showCopyChapters && 'copy-chapters',
      showCaptions && 'caption-remaining',
      task.showWatch && 'watch',
      task.showWatch && hasEdits && !task.showMarkedExport && 'normalize',
      task.showWatch && hasEdits && !task.showMarkedExport && 'export',
      showExportSrt && 'export-srt',
      task.showMarkedExport && 'cut-marked',
      task.showMarkedExport && 'tighten-marked',
      task.showMarkedExport && 'frame-9-16',
      task.showMarkedExport && 'export-marked',
      task.showMarkedExport && 'clear-marks'
    ] as const
  ).filter((id): id is BarActionId => Boolean(id))
  const { now: barNow, more: barMore } = planSuggestBar(barJob, available)
  const selectionOn = Boolean(
    selectedWordIds.length || selectedSceneId || selected || selectedClipId || selectedGap
  )
  const reviewCopy = reviewDrawerCopy(project)
  const issueCount = reviewJobCount(project)
  const selectedReviewScene = reviewing && selectedSceneId
    ? project.scenes.find((scene) => scene.id === selectedSceneId)
    : undefined
  const cueCopy = activeLeftover?.label ?? selectedReviewScene?.title ?? task.headline
  const cueKicker = activeLeftover || selectedReviewScene
    ? 'Current issue'
    : barJob === 'selection'
      ? 'Selected'
      : barJob === 'marked'
        ? 'Marked'
        : 'Up next'

  function hearSuggestion(s: EditSuggestion, currentProject = useEditor.getState().project) {
    selectSuggestion(s.id)
    playLoop(sourceToProgramOf(currentProject, s.start), sourceToProgramOf(currentProject, s.end))
  }

  function continueReview(currentProject: typeof project): EditorialScene | undefined {
    const job = reviewJob(currentProject)
    if (job === 'leftover' || job === 'breath') {
      const next = nextLeftoverToHear(currentProject)
      if (next) hearSuggestion(next, currentProject)
      return undefined
    }
    if (job === 'retake') {
      const next = retakeReviewQueue(currentProject).find((row) => !retakeSceneDropped(currentProject, row))
      if (next) hearScene(next, currentProject)
      return next
    }
    clearSelection()
    usePlayback.getState().pause()
    if (job === 'applied' || job === 'empty') setReviewing(false)
    return undefined
  }

  function resolveLeftover(command: Command) {
    const before = useEditor.getState().project
    dispatch(command)
    const toast = toastForEdit(before, command)
    if (toast) onToast?.(toast)
    continueReview(useEditor.getState().project)
  }

  function hearScene(scene: EditorialScene, currentProject = useEditor.getState().project) {
    selectScene(scene.id)
    playLoop(sourceToProgramOf(currentProject, scene.start), sourceToProgramOf(currentProject, scene.end))
  }

  function openReview() {
    onToast?.(openReviewFromContext().toast)
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
    const continued = next ? (hearScene(next, nextProject), next) : continueReview(nextProject)
    onToast?.(describeTakeDecision(nextProject, continued))
  }

  function sceneKindChip(kind: string, takeIndex?: number) {
    if (kind === 'demo') return 'Silent demo'
    if (kind === 'retake' || takeIndex) return takeIndex ? `Take ${takeIndex}` : 'Retake'
    return 'Scene'
  }

  function barAction(id: BarActionId, inMenu = false) {
    const className = inMenu ? 'overflow-item' : id === 'export' || id === 'export-marked' ? 'safe-btn' : 'review-btn'
    const button = (label: string, title: string, onClick: () => void, extra?: { active?: boolean }) => (
      <button
        key={id}
        className={className}
        type="button"
        title={title}
        data-active={extra?.active}
        onClick={onClick}
      >
        {label}
      </button>
    )
    switch (id) {
      case 'hear-leftover':
        return leftoverIsBreath(leftover)
          ? button(
              leftoverHearLabel(task.breathCount || leftoverItems(project, 'breath').length),
              'Loop this breath. Cut if it hisses, Keep if it should stay.',
              () => onToast?.(leftoverHearFromContext().toast)
            )
          : button('Review next issue', 'Play the next section that needs a decision.', () =>
              onToast?.(leftoverHearFromContext().toast)
            )
      case 'silent-demo':
        return button('Silent demo', 'Keep this leftover click-through. Auto Edit will skip pauses here.', () =>
          onToast?.(leftoverDemoFromContext().toast)
        )
      case 'speed-4x':
        return button('Speed 4×', 'Play this leftover wait at 4×.', () => onToast?.(leftoverSpeedFromContext().toast))
      case 'cut-leftover':
        return leftoverIsBreath(activeLeftover)
          ? button('Cut breath', 'Remove this hiss and close the gap. Undo puts it back.', () =>
              onToast?.(leftoverCutFromContext().toast)
            )
          : button('Cut', 'Remove this leftover fidget and close the gap. Undo puts it back.', () =>
              onToast?.(leftoverCutFromContext().toast)
            )
      case 'keep-leftover':
        return leftoverIsBreath(activeLeftover)
          ? button('Keep breath', 'Leave this air in the reel so the line still breathes.', () =>
              onToast?.(leftoverKeepFromContext().toast)
            )
          : button('Keep', 'Protect this leftover. Auto Edit will skip it.', () =>
              onToast?.(leftoverKeepFromContext().toast)
            )
      case 'quiet-leftover':
        return button('Quiet', 'Lower this leftover spike toward -16 LUFS. Length stays.', () =>
          onToast?.(leftoverQuietFromContext().toast)
        )
      case 'protect-pause':
        return button('Protect pause', 'Put this cut pause back and skip it next time.', () =>
          onToast?.(protectFromContext().toast)
        )
      case 'cut-prev':
        return button('Cut previous', 'Cut the short line before this restart and close the gap. Hear the join.', () =>
          onToast?.(cutPreviousFromContext().toast)
        )
      case 'cut-sentence':
        return button('Cut sentence', 'Cut this spoken line and close the gap. Hear the join.', () =>
          onToast?.(cutThisFromContext().toast)
        )
      case 'cut-paragraph':
        return button('Remove paragraph', 'Cut this stretch and close the gap. Hear the join.', () =>
          onToast?.(cutParagraphFromContext().toast)
        )
      case 'breaths':
        return button(
          `${task.breathCount} breath${task.breathCount === 1 ? '' : 's'}`,
          "They're in the reel. Hear the first one, then Cut or Keep.",
          () => {
            const found = startBreathReview()
            onToast?.(describeBreathReview(found ? leftoverItems(useEditor.getState().project, 'breath').length : 0))
          }
        )
      case 'cut-fillers':
        return button(`Cut ${task.fillerCount} fillers`, 'Remove every um, uh, and you know in one undo', () =>
          dispatch({ type: 'applySuggestionsByType', suggestionType: 'filler' })
        )
      case 'find-retakes':
        return button('Find retakes', 'Mark retakes from the transcript, then hear the first one', () =>
          onToast?.(findRetakesAndReview().toast)
        )
      case 'collapse-retakes':
        return button('Collapse retakes', 'Drop every superseded take. Undo, or use Put back retakes in Auto Edit.', () => {
          const count = uncollapsedRetakeCount(useEditor.getState().project)
          dispatch({ type: 'collapseRetakes' })
          clearSelection()
          usePlayback.getState().pause()
          onToast?.(`Dropped ${count} false take${count === 1 ? '' : 's'}. Undo to put ${count === 1 ? 'it' : 'them'} back.`)
        })
      case 'review':
        return button(task.reviewLabel, 'Open the review drawer. Close it with ×, outside, or Esc.', () =>
          openReview()
        )
      case 'add-title':
        return button('Add title', 'A 3-second title at the start. Type the subject on the picture.', () =>
          onToast?.(applyTitleFromContext().toast)
        )
      case 'chapter-names':
        return button('Chapter names', 'A name on each chapter. Type the first one on the picture.', () =>
          onToast?.(addSceneLowerThirdsFromContext().toast)
        )
      case 'apply-style':
        return button(
          'Apply style',
          'Copy this card’s fill, stroke, and size onto every title. Position stays. The next card plays.',
          () => onToast?.(applyCaptionStyleToAllFromContext().toast)
        )
      case 'add-lower-third':
        return button(
          'Add lower third',
          'A name on these words, this chapter, or 3 seconds from here. Type it, then Fill.',
          () => onToast?.(applyLowerThirdFromContext().toast)
        )
      case 'add-zoom':
        return button('Add zoom', 'Punch in on the selected words or chapter. Scale is on the picture.', () =>
          onToast?.(applyZoomFromContext().toast)
        )
      case 'add-redaction':
        return button('Add redaction', 'Blur on the selected words or chapter. Drag the box on the picture.', () =>
          onToast?.(applyRedactionFromContext().toast)
        )
      case 'add-broll':
        return button('Add B-roll', 'A silent face cam or still in the corner.', () => {
          void addBrollFromContext().then((result) => onToast?.(result.toast))
        })
      case 'add-music':
        return button('Add music', 'A bed under the voice from here to the end.', () => {
          void addMusicFromContext().then((result) => onToast?.(result.toast))
        })
      case 'copy-quote':
        return button('Copy quote', 'Copy this line with the speaker and time. Paste it, or Mark clip.', () =>
          onToast?.(copyQuoteFromContext().toast)
        )
      case 'copy-frame':
        return button('Copy frame', 'Copy the picture with this chapter or these words under it. Paste the PNG.', () => {
          void copyStillFromContext().then((result) => onToast?.(result.toast))
        })
      case 'mark-clip':
        return button('Mark clip', 'Mark In–Out on these words or this chapter. Export just that range.', () =>
          onToast?.(markClipFromContext().toast)
        )
      case 'add-note':
        return button('Note', 'Park a mark on this line. Type hook, ask, or why you parked.', () =>
          onToast?.(addNoteFromContext().toast)
        )
      case 'remove-scene':
        return button(
          removeScene && sceneIsRemoved(project, removeScene) ? 'Put chapter back' : 'Remove scene',
          removeScene && sceneIsRemoved(project, removeScene)
            ? 'Put this chapter back.'
            : 'Remove this whole chapter. The next heading plays.',
          () => onToast?.(removeSceneFromContext().toast)
        )
      case 'merge-prev':
        return button(
          mergePrev ? `Merge ${mergePrev.other.title}` : 'Merge prev',
          mergePrev
            ? `Join “${mergePrev.other.title}”. The joined chapter plays.`
            : 'Join this chapter with the one before it.',
          () => onToast?.(mergeChapterFromContext(-1).toast)
        )
      case 'merge-next':
        return button(
          mergeNext ? `Merge ${mergeNext.other.title}` : 'Merge next',
          mergeNext
            ? `Join “${mergeNext.other.title}”. The joined chapter plays.`
            : 'Join this chapter with the one after it.',
          () => onToast?.(mergeChapterFromContext(1).toast)
        )
      case 'split-chapter':
        return button('Split chapter', 'Split at this line. Type the new heading.', () =>
          onToast?.(splitChapterFromContext().toast)
        )
      case 'copy-notes':
        return button('Copy notes', 'Copy chapter headings and speaker turns. Paste into Slack or Notion.', () =>
          void exportSidecar('md', onToast ?? (() => undefined))
        )
      case 'copy-chapters':
        return button('Copy chapters', 'Copy 0:00 timestamps. Paste into the YouTube description.', () =>
          void exportSidecar('chapters', onToast ?? (() => undefined))
        )
      case 'caption-remaining':
        return button('Caption remaining', 'Fill the tape from the live words. Titles and edited cards stay.', () =>
          onToast?.(generateCaptionsFromContext().toast)
        )
      case 'watch':
        return button(
          hasEdits ? 'Watch edited reel' : 'Watch full reel',
          hasEdits ? 'Starts at 1.5× so you can skim.' : 'Play from the start',
          () => onToast?.(watchEditedReel({ skim: hasEdits }).toast)
        )
      case 'normalize':
        return button(
          'Normalize',
          project.audioMaster.normalize
            ? 'On — voice hits -16 LUFS on export. Click to leave the recording as-is.'
            : 'Off. Click to hit -16 LUFS on export.',
          () => onToast?.(toggleNormalizeFromContext().toast),
          { active: project.audioMaster.normalize }
        )
      case 'export':
        return button(
          audioReel ? 'Export audio' : 'Export',
          audioReel ? 'M4A of the cut.' : 'MP4 with captions burned in unless you turn that off',
          () => window.dispatchEvent(new Event('speechedit:export'))
        )
      case 'export-srt':
        return button('Export SRT', 'Copy the captions and download the SRT. Upload it next to the MP4.', () =>
          void exportSidecar('srt', onToast ?? (() => undefined))
        )
      case 'cut-marked':
        return button(
          ripple ? 'Cut marked' : 'Lift marked',
          ripple
            ? 'Remove In–Out and close the gap. The join plays. Then mark the next stretch.'
            : 'Lift In–Out. The hole stays. Then mark the next stretch.',
          () => onToast?.(cutMarksFromContext().toast)
        )
      case 'tighten-marked':
        return button('Tighten marked', 'Shorten pauses inside In–Out. The clip plays. Cut or Export is next.', () =>
          onToast?.(tightenMarksFromContext().toast)
        )
      case 'frame-9-16':
        return button(
          isVerticalFrame(project) ? '16:9' : '9:16',
          'Tall 9:16 frame. Face position is on the picture.',
          () => onToast?.(setFrameFromContext(isVerticalFrame(project) ? 'youtube' : 'vertical').toast),
          { active: isVerticalFrame(project) }
        )
      case 'export-marked':
        return button('Export marked range', 'Export only In–Out.', () =>
          window.dispatchEvent(new Event('speechedit:export'))
        )
      case 'clear-marks':
        return button('Clear marks', 'Clear In and Out, then find the next clip', () =>
          onToast?.(clearMarksFromContext().toast)
        )
    }
  }

  return (
    <>
      <footer className="suggest-bar">
        <div className="suggest-cue">
          <span className="suggest-kicker">{cueKicker}</span>
          <span className="suggest-copy">{cueCopy}</span>
        </div>
        {!selectionOn && (task.showPreviewToggle || task.showPace) && (
          <OverflowMenu label="Preview & pace" title="Compare the original, preview cuts, and choose pause spacing">
            {task.showPreviewToggle && (
              <>
              <button
                type="button"
                className="overflow-item"
                data-active={!previewSafeCuts}
                title="Hear the raw recording before applying safe cuts"
                onClick={() => setPreviewSafeCuts(false)}
              >
                Original
              </button>
              <button
                type="button"
                className="overflow-item"
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
                className="overflow-item"
                data-active={pace === preset.id}
                title={preset.hint}
                onClick={() => dispatch({ type: 'setCutMargin', margin: preset.margin })}
              >
                {preset.label}
              </button>
            ))}
          </OverflowMenu>
        )}
        <div className="suggest-actions">
          {barNow.map((id) => barAction(id))}
          {barMore.length > 0 && (
            <OverflowMenu title="More actions for this moment">
              {barMore.map((id) => barAction(id, true))}
            </OverflowMenu>
          )}
          {selectionOn && (
            <button
              className="review-btn"
              type="button"
              title="Deselect words, chapter, or title (Esc)"
              onClick={() => clearSelection()}
            >
              Clear
            </button>
          )}
        </div>
        {primaryApply && !selectionOn && (
          <button className="safe-btn" onClick={() => dispatch({ type: 'applySafeSuggestions' })}>
            {task.applyLabel}
          </button>
        )}
        {primaryReview && !reviewing && !selectionOn && (
          <button className="safe-btn" onClick={openReview}>
            {task.reviewLabel}
          </button>
        )}
      </footer>
      {reviewing && (
        <div className="drawer-back" onMouseDown={() => setReviewing(false)}>
        <div
          className="drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Review"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="drawer-overview">
            <div className="drawer-overview-copy">
              <span className="drawer-eyebrow">{reviewCopy.kicker}</span>
              <strong>{reviewCopy.detail}</strong>
              <span className="drawer-progress">{issueCount ? `${issueCount} ${issueCount === 1 ? 'item' : 'items'} left in this step` : 'Review complete'}</span>
            </div>
            <span className="drawer-head-actions">
              {reviewJob(project) === 'pending' && reviewOtherPending(project).length > 0 && (
                <button
                  className="chip"
                  type="button"
                  title="Clear every unused suggestion in one undo"
                  onClick={() => dispatch({ type: 'dismissPendingSuggestions' })}
                >
                  Dismiss all
                </button>
              )}
              <button
                className="drawer-close"
                type="button"
                title="Close review (Esc)"
                aria-label="Close review"
                onClick={() => setReviewing(false)}
              >
                ×
              </button>
            </span>
          </header>
          {reviewJob(project) === 'retake' && reviewDecisionScenes(project).map((scene) => {
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
            const job = reviewJob(project)
            const { activities, stills, breaths, statics, hots } = leftoverReviewItems(project)
            if (job !== 'leftover' && job !== 'breath') return null
            return (
              <>
                {job === 'leftover' && activities.length > 0 && (
                  <section className="drawer-group">
                    <div className="drawer-row drawer-head">
                      <span className="kind">Quiet picture</span>
                      <span>Picture changed during silence</span>
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
                {job === 'leftover' && stills.length > 0 && (
                  <section className="drawer-group">
                    <div className="drawer-row drawer-head">
                      <span className="kind">Silent stills</span>
                      <span>No visible movement</span>
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
                {job === 'breath' && breaths.length > 0 && (
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
                          onClick={() => {
                            dispatch({
                              type: 'dismissSuggestions',
                              suggestionIds: breaths.map((row) => row.id)
                            })
                            onToast?.('Kept in the reel. They stay between words.')
                          }}
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
                        onApply={() => resolveLeftover({ type: 'applySuggestion', suggestionId: s.id })}
                        onSkip={() => resolveLeftover({ type: 'resolveSuggestion', suggestionId: s.id, resolution: 'keep' })}
                      />
                    ))}
                  </section>
                )}
                {job === 'leftover' && statics.length > 0 && (
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
                {job === 'leftover' && hots.length > 0 && (
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
          {reviewJob(project) === 'pending' && GROUPS.map((group) => {
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
          {reviewJob(project) === 'applied' && applied.length > 0 && (
            <div className="drawer-row applied-head">
              <span className="kind">applied</span>
              <span>Put back one auto-edit, or a whole type, without undoing the rest</span>
              <span />
              <span />
            </div>
          )}
          {reviewJob(project) === 'applied' && GROUPS.map((group) => {
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
          {reviewJob(project) === 'empty' && (
            <div className="drawer-row">Nothing waiting. Close when you are done.</div>
          )}
        </div>
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
              ? 'picture change'
              : leftover === 'still'
              ? 'still frame'
              : leftover === 'breath'
                ? 'breath'
                : leftover === 'static'
                  ? 'static screen'
                  : leftover === 'low-motion'
                    ? 'slow picture'
                    : leftover === 'loud'
                      ? 'loud audio'
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
