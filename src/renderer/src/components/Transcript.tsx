import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { leftoverForSpan, reviewGap } from '../lib/analysis'
import { isFillerToken, isPlaceholderWord, transcriptIsPlaceholder } from '../lib/transcript'
import { ingestDroppedFile } from '../lib/fileActions'
import { currentWord } from '../lib/edl'
import { programToSourceOf, sourceToProgramOf } from '../lib/resolver'
import {
  appliedForWord,
  extendSelection,
  nearestSpokenWord,
  PARAGRAPH_GAP,
  paragraphIds,
  sentenceIds,
  sentenceRange,
  sortWordIds,
  tagAt,
  wordIdsInRange,
  wordRange
} from '../lib/transcriptEdit'
import { toastForCaptionFollow } from '../lib/captions'
import {
  commandForGapDoubleClick,
  formatSpan,
  sceneInspectorDetail,
  toastForCommand,
  toastForEdit,
  transcriptChoices
} from '../lib/contextActions'
import { SCENE_CHIP_ACTION_IDS, groupScenesByTranscriptAnchor, sceneClockLabel, sceneKindLabel } from '../lib/sceneChip'
import { takeFamily } from '../lib/sceneAnalysis'
import { nextTalkChapter, RENAME_SCENE_EVENT, toastForSceneRename } from '../lib/sceneRename'
import {
  assignSpeakerFromContext,
  nextSpeaker,
  RENAME_SPEAKER_EVENT,
  speakerIdFromSelection,
  toastForSpeakerRename
} from '../lib/speakerRename'
import { splitChapterFromContext } from '../lib/chapterShape'
import { removeSceneFromContext } from '../lib/sceneRemove'
import { protectRange } from '../lib/protect'
import { coveringNote, isTapeNote, noteDraft, notesSorted } from '../lib/clipEdit'
import { describeNoteSaved, EDIT_NOTE_EVENT } from '../lib/noteEdit'
import { findInTranscript, findStepShouldHear, findWordGroups, replacePlan } from '../lib/transcriptFind'
import { speakerColor } from '../lib/theme'
import { exportSidecar, hasExportableCaptions, hasYouTubeChapters } from '../lib/exportActions'
import { copyQuoteFromContext } from '../lib/quote'
import { cutPreviousFromContext } from '../lib/cutPrevious'
import { cutThisFromContext } from '../lib/cutSentence'
import { cutParagraphFromContext } from '../lib/scriptActions'
import { copyStillFromContext } from '../lib/still'
import { describeClearMarks, markClipFromContext } from '../lib/marks'
import { placePopoverInBounds, type PopoverPlacement } from '../lib/popoverPlacement'
import { useEditor, usePlayback } from '../store'
import { StartGuide } from './StartGuide'
import { OverflowMenu } from './OverflowMenu'

type Marquee = { x0: number; y0: number; x1: number; y1: number }

function rectsOverlap(a: Marquee, b: DOMRect): boolean {
  const left = Math.min(a.x0, a.x1)
  const right = Math.max(a.x0, a.x1)
  const top = Math.min(a.y0, a.y1)
  const bottom = Math.max(a.y0, a.y1)
  return left < b.right && right > b.left && top < b.bottom && bottom > b.top
}

export function Transcript({ onToast }: { onToast?: (msg: string) => void }) {
  const project = useEditor((s) => s.project)
  const selected = useEditor((s) => s.selectedWordIds)
  const selectedSceneId = useEditor((s) => s.selectedSceneId)
  const selectWords = useEditor((s) => s.selectWords)
  const selectScene = useEditor((s) => s.selectScene)
  const dispatch = useEditor((s) => s.dispatch)
  const programTime = usePlayback((s) => s.programTime)
  const sourceTime = programToSourceOf(project, programTime)
  const seekSource = usePlayback((s) => s.seekSource)
  const playLoop = usePlayback((s) => s.playLoop)
  const active = currentWord(project.transcript.words, sourceTime)
  const [editing, setEditing] = useState<string | null>(null)
  const [paintIds, setPaintIds] = useState<string[] | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const [findQuery, setFindQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [findNote, setFindNote] = useState<string | null>(null)
  const [findIndex, setFindIndex] = useState(0)
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null)
  const [focusedSpeaker, setFocusedSpeaker] = useState<string | null>(null)
  const [editingScene, setEditingScene] = useState<string | null>(null)
  const [editingTag, setEditingTag] = useState<string | null>(null)
  const [dropHover, setDropHover] = useState(false)
  const dragMoved = useRef(false)
  const pendingDouble = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSpeakerClick = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const pendingHear = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorRef = useRef<string | null>(null)
  const paintAdditiveRef = useRef(false)
  const paintIdsRef = useRef<string[] | null>(null)

  function setPaint(next: string[] | null) {
    paintIdsRef.current = next
    setPaintIds(next)
  }
  const scriptRef = useRef<HTMLDivElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const wordRefs = useRef(new Map<string, HTMLButtonElement>())
  const popoverRef = useRef<HTMLSpanElement>(null)
  const [popoverPlacement, setPopoverPlacement] = useState<(PopoverPlacement & { anchorId: string }) | null>(null)
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const guardKind = useEditor((s) => s.guardKind)
  const setGuardKind = useEditor((s) => s.setGuardKind)
  const analyzing = useEditor((s) => s.analyzing)
  const hasSource = Object.values(project.assets).some((asset) => Boolean(asset.path))
  const selectSuggestion = useEditor((s) => s.selectSuggestion)
  const clearSelection = useEditor((s) => s.clearSelection)
  const selectGap = useEditor((s) => s.selectGap)
  const seekProgram = usePlayback((s) => s.seekProgram)
  const playing = usePlayback((s) => s.playing)
  const followPlayhead = useEditor((s) => s.followPlayhead)
  const setFollowPlayhead = useEditor((s) => s.setFollowPlayhead)
  const followLock = useRef(false)
  const words = project.transcript.words
  const islands = words.length > 0 && transcriptIsPlaceholder(words)
  const findGroups = findWordGroups(words, findQuery)
  const findHitIds = new Set(findGroups.flat())
  const { choices } = transcriptChoices(project, selected)
  const selectedSet = new Set(selected)
  const popoverAnchor =
    selectedSceneId || tool === 'guard' ? undefined : [...words].reverse().find((w) => selectedSet.has(w.id))
  const selectedScene = selectedSceneId ? (project.scenes ?? []).find((s) => s.id === selectedSceneId) : undefined
  const sceneAnchors = groupScenesByTranscriptAnchor(project.scenes ?? [], words)

  useLayoutEffect(() => {
    const script = scriptRef.current
    const anchorId = popoverAnchor?.id
    const anchor = anchorId ? wordRefs.current.get(anchorId) : undefined
    const popover = popoverRef.current
    if (!script || !anchorId || !anchor || !popover) {
      setPopoverPlacement(null)
      return
    }

    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const next = {
          ...placePopoverInBounds(
            script.getBoundingClientRect(),
            anchor.getBoundingClientRect(),
            popover.getBoundingClientRect()
          ),
          anchorId
        }
        setPopoverPlacement((current) =>
          current &&
          current.anchorId === next.anchorId &&
          current.left === next.left &&
          current.top === next.top &&
          current.maxWidth === next.maxWidth &&
          current.maxHeight === next.maxHeight &&
          current.visible === next.visible
            ? current
            : next
        )
      })
    }

    update()
    script.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(script)
    observer?.observe(popover)

    return () => {
      cancelAnimationFrame(frame)
      script.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [popoverAnchor?.id, choices.length])

  function loopSpan(start: number, end: number) {
    playLoop(sourceToProgramOf(project, start), sourceToProgramOf(project, end))
  }

  function hearScene(scene: (typeof project.scenes)[number]) {
    selectScene(scene.id)
    seekSource(scene.start)
    loopSpan(scene.start, scene.end)
  }

  function parkScene(scene: (typeof project.scenes)[number]) {
    selectScene(scene.id)
    const source = programToSourceOf(project, usePlayback.getState().programTime)
    if (source < scene.start - 0.05 || source > scene.end + 0.05) seekSource(scene.start)
  }

  function saveNoteLabel(tagId: string, value: string) {
    dispatch({ type: 'setTagLabel', tagId, label: value })
    setEditingTag(null)
    const toast = describeNoteSaved(value)
    if (toast) onToast?.(toast)
  }

  function wordlessSceneNotes(scene: (typeof project.scenes)[number]) {
    const spoken = words.some((word) => !word.deleted && word.start >= scene.start && word.end <= scene.end)
    if (spoken) return []
    return notesSorted(project).filter((note) => note.start >= scene.start - 0.05 && note.start < scene.end)
  }

  function renderGuardChip(tag: (typeof project.tags)[number], opts?: { hear?: () => void }) {
    if (isTapeNote(tag.kind) && editingTag === tag.id) {
      return (
        <input
          className="guard-chip-edit"
          data-kind="note"
          data-tag-id={tag.id}
          autoFocus
          defaultValue={noteDraft(tag.label)}
          placeholder="hook, ask, or why you parked"
          aria-label="Note"
          onMouseDown={(e) => e.stopPropagation()}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => saveNoteLabel(tag.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setEditingTag(null)
          }}
        />
      )
    }
    return (
      <button
        type="button"
        className="guard-chip"
        data-kind={tag.kind}
        data-tag-id={tag.id}
        title={
          isTapeNote(tag.kind)
            ? 'Click to hear · double-click to type · right-click to remove'
            : 'Click to hear this protected range · double-click removes it'
        }
        onClick={() => {
          if (opts?.hear) {
            opts.hear()
            return
          }
          const ids = words.filter((w) => w.start >= tag.start && w.end <= tag.end).map((w) => w.id)
          if (ids.length) applySelection(ids)
          else {
            seekSource(tag.start)
            loopSpan(tag.start, tag.end)
          }
        }}
        onDoubleClick={(e) => {
          e.preventDefault()
          if (isTapeNote(tag.kind)) setEditingTag(tag.id)
          else dispatch({ type: 'removeTag', tagId: tag.id })
        }}
      >
        {isTapeNote(tag.kind)
          ? tag.label || 'Note'
          : tag.kind === 'demo'
            ? 'Silent demo — Auto Edit skips pauses'
            : 'Protected — Auto Edit skips this'}
      </button>
    )
  }

  function clickSpeakerChip(speaker: (typeof project.transcript.speakers)[number]) {
    const pending = pendingSpeakerClick.current
    if (pending && pending.id === speaker.id) {
      window.clearTimeout(pending.timer)
      pendingSpeakerClick.current = null
      setEditingSpeaker(speaker.id)
      return
    }
    if (pending) window.clearTimeout(pending.timer)
    pendingSpeakerClick.current = {
      id: speaker.id,
      timer: setTimeout(() => {
        pendingSpeakerClick.current = null
      }, 280)
    }
    const ids = useEditor.getState().selectedWordIds
    if (ids.length) {
      const result = assignSpeakerFromContext(speaker.id)
      if (result.toast) onToast?.(result.toast)
      setFocusedSpeaker(speaker.id)
      return
    }
    setFocusedSpeaker(speaker.id)
    applySelection(
      words.filter((word) => word.speaker === speaker.id).map((word) => word.id),
      { loop: false }
    )
  }

  function commitSpeakerName(speaker: (typeof project.transcript.speakers)[number], next: string) {
    const name = next.trim()
    const follow = nextSpeaker(useEditor.getState().project, speaker.id)
    if (name && name !== speaker.name) dispatch({ type: 'renameSpeaker', speakerId: speaker.id, name })
    const toast = toastForSpeakerRename(speaker.name, name, follow?.name)
    if (toast) onToast?.(toast)
    if (follow) {
      setEditingSpeaker(follow.id)
      return
    }
    setEditingSpeaker(null)
  }

  function commitSceneTitle(scene: (typeof project.scenes)[number], next: string) {
    const title = next.trim()
    const follow = nextTalkChapter(useEditor.getState().project, scene.id)
    if (title && title !== scene.title) dispatch({ type: 'renameScene', sceneId: scene.id, title })
    const toast = toastForSceneRename(scene.title, title, follow?.title)
    if (toast) onToast?.(toast)
    if (follow) {
      selectScene(follow.id)
      setEditingScene(follow.id)
      return
    }
    setEditingScene(null)
  }

  function renderScene(scene: (typeof project.scenes)[number]) {
    const family = takeFamily(project.scenes ?? [], scene.id)
    const detail = sceneInspectorDetail(project, scene.id)
    const on = selectedSceneId === scene.id
    const actions = (detail?.actions ?? []).filter((a) => {
      if (!a.command || !SCENE_CHIP_ACTION_IDS.has(a.id)) return false
      if (a.id === 'cut-scene' || a.id === 'restore-scene') return on
      return on || Boolean(a.primary)
    })
    const editing = editingScene === scene.id
    return (
      <div
        key={scene.id}
        className="scene-chip-row"
        data-kind={scene.kind}
        data-on={on || undefined}
      >
        {editing ? (
          <div className="scene-chip" data-kind={scene.kind} data-on="true">
            <span className="scene-chip-kicker">
              <span>{sceneKindLabel(scene, family)}</span>
              <span>{sceneClockLabel(scene)}</span>
            </span>
            <input
              className="scene-chip-edit"
              autoFocus
              defaultValue={scene.title}
              aria-label="Scene name"
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => commitSceneTitle(scene, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setEditingScene(null)
              }}
            />
            {scene.summary ? <span className="scene-chip-summary">{scene.summary}</span> : null}
          </div>
        ) : (
          <button
            type="button"
            className="scene-chip"
            data-scene-id={scene.id}
            data-kind={scene.kind}
            data-on={on || undefined}
            aria-pressed={on}
            title="Click to hear this chapter · click again to clear · right-click to rename, split, or mark"
            onClick={(e) => {
              if (on && e.detail < 2) {
                clearSelection()
                return
              }
              const source = programToSourceOf(project, usePlayback.getState().programTime)
              const alreadyInside = source >= scene.start - 0.05 && source <= scene.end + 0.05
              parkScene(scene)
              if (pendingHear.current) clearTimeout(pendingHear.current)
              pendingHear.current = null
              if (e.detail >= 2) return
              if (alreadyInside) return
              pendingHear.current = setTimeout(() => {
                pendingHear.current = null
                loopSpan(scene.start, scene.end)
              }, 280)
            }}
            onDoubleClick={(e) => {
              e.preventDefault()
              if (pendingHear.current) clearTimeout(pendingHear.current)
              pendingHear.current = null
              setEditingScene(scene.id)
            }}
          >
            <span className="scene-chip-kicker">
              <span>{sceneKindLabel(scene, family)}</span>
              <span>{sceneClockLabel(scene)}</span>
            </span>
            <span className="scene-chip-title">{scene.title}</span>
            {scene.summary ? <span className="scene-chip-summary">{scene.summary}</span> : null}
          </button>
        )}
        {wordlessSceneNotes(scene).map((tag) => (
          <Fragment key={tag.id}>{renderGuardChip(tag)}</Fragment>
        ))}
        {actions.length > 0 && (
          <div className="scene-chip-actions">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                className="chip"
                title={action.consequence}
                onClick={() => {
                  if (action.id === 'cut-scene' || action.id === 'restore-scene') {
                    onToast?.(removeSceneFromContext(scene.id).toast)
                    return
                  }
                  dispatch(action.command!)
                  const toast = toastForEdit(useEditor.getState().project, action.command!)
                  if (toast) onToast?.(toast)
                  else if (action.consequence) onToast?.(action.consequence)
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  function loopSelection(ids: string[]) {
    const span = wordRange(words, ids)
    if (!span) return
    loopSpan(span.start, span.end)
  }

  function loopSentenceAt(wordId: string) {
    const range = sentenceRange(words, wordId)
    if (!range) {
      seekSource(words.find((w) => w.id === wordId)?.start ?? 0)
      return
    }
    loopSpan(range.start, range.end)
  }

  function applySelection(ids: string[], opts?: { additive?: boolean; loop?: boolean; anchor?: string }) {
    const sorted = sortWordIds(words, ids)
    if (!sorted.length) return
    selectWords(sorted, opts?.additive)
    anchorRef.current = opts?.anchor ?? sorted[0]
    if (opts?.loop !== false) loopSelection(sorted)
  }

  function idsInMarquee(box: Marquee): string[] {
    const hits: string[] = []
    for (const [id, el] of wordRefs.current) {
      if (rectsOverlap(box, el.getBoundingClientRect())) hits.push(id)
    }
    return sortWordIds(words, hits)
  }

  function showFindGroup(groups: string[][], index: number, hear = false) {
    if (!groups.length) return
    const next = ((index % groups.length) + groups.length) % groups.length
    const ids = groups[next]
    setFindIndex(next)
    applySelection(ids, { loop: false, anchor: ids[0] })
    if (hear && ids[0]) loopSentenceAt(ids[0])
    setFindNote(`${next + 1} / ${groups.length}`)
    wordRefs.current.get(ids[0])?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  function hearCurrentFind() {
    if (findGroups.length) {
      showFindGroup(findGroups, findIndex, true)
      return
    }
    if (selected[0]) loopSentenceAt(selected[0])
  }

  function findAndSelect(phrase: string, step: 0 | 1 | -1 = 0) {
    const trimmed = phrase.trim()
    if (!trimmed) {
      setFindNote(null)
      setFindIndex(0)
      return
    }
    const groups = findWordGroups(words, trimmed)
    if (groups.length) {
      showFindGroup(groups, step === 0 ? 0 : findIndex + step, findStepShouldHear(step))
      return
    }
    const hit = findInTranscript(project, words, trimmed)
    if (!hit) {
      setFindNote(`No “${trimmed}” in transcript, scenes, or edits`)
      return
    }
    if (hit.kind === 'scene') {
      hearScene(hit.scene)
      setFindNote(`Scene · ${hit.scene.title}`)
      return
    }
    if (hit.kind === 'suggestion') {
      selectSuggestion(hit.suggestion.id)
      clearSelection()
      seekProgram(sourceToProgramOf(project, hit.suggestion.start))
      setFindNote(`Edit · ${hit.suggestion.label}`)
    }
  }

  useEffect(() => {
    const onEdit = (e: Event) => {
      const wordId = (e as CustomEvent<{ wordId: string }>).detail?.wordId
      if (wordId) setEditing(wordId)
    }
    window.addEventListener('speechedit:edit-word', onEdit)
    return () => window.removeEventListener('speechedit:edit-word', onEdit)
  }, [])

  useEffect(() => {
    if (guardKind === 'hook' || guardKind === 'cta') setGuardKind('note')
  }, [guardKind, setGuardKind])

  useEffect(() => {
    const script = scriptRef.current
    if (!script) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'a') return
      if (!script.contains(document.activeElement) && document.activeElement !== script) return
      e.preventDefault()
      applySelection(
        words.map((w) => w.id),
        { loop: false }
      )
    }
    script.addEventListener('keydown', onKey)
    return () => script.removeEventListener('keydown', onKey)
  }, [words])

  const findQueryRef = useRef(findQuery)
  findQueryRef.current = findQuery
  const findIndexRef = useRef(findIndex)
  findIndexRef.current = findIndex
  const findGroupsRef = useRef(findGroups)
  findGroupsRef.current = findGroups
  const findAndSelectRef = useRef(findAndSelect)
  findAndSelectRef.current = findAndSelect

  useEffect(() => {
    const focusFind = () => {
      if (!words.length) return
      findRef.current?.focus()
      findRef.current?.select()
    }
    const onHunt = (event: Event) => {
      const detail = (event as CustomEvent<{ advance?: boolean; hunt?: { toast: string } }>).detail
      const query = findQueryRef.current.trim()
      const groups = findGroupsRef.current
      if (detail?.advance && query && groups.length > 1 && findIndexRef.current < groups.length - 1) {
        findAndSelectRef.current(query, 1)
        if (detail.hunt) detail.hunt.toast = describeClearMarks(query, { nextHit: true })
        return
      }
      if (detail?.advance && query && detail.hunt) {
        detail.hunt.toast = describeClearMarks(query)
      }
      focusFind()
    }
    const onFind = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'f') return
      e.preventDefault()
      focusFind()
    }
    window.addEventListener('keydown', onFind)
    window.addEventListener('speechedit:find', onHunt)
    return () => {
      window.removeEventListener('keydown', onFind)
      window.removeEventListener('speechedit:find', onHunt)
    }
  }, [words.length])

  useEffect(() => {
    const onRename = (event: Event) => {
      const sceneId = (event as CustomEvent<{ sceneId?: string }>).detail?.sceneId
      if (sceneId) setEditingScene(sceneId)
    }
    window.addEventListener(RENAME_SCENE_EVENT, onRename)
    return () => window.removeEventListener(RENAME_SCENE_EVENT, onRename)
  }, [])

  useEffect(() => {
    const onRename = (event: Event) => {
      const speakerId = (event as CustomEvent<{ speakerId?: string }>).detail?.speakerId
      if (speakerId) setEditingSpeaker(speakerId)
    }
    window.addEventListener(RENAME_SPEAKER_EVENT, onRename)
    return () => window.removeEventListener(RENAME_SPEAKER_EVENT, onRename)
  }, [])

  useEffect(() => {
    const onEdit = (event: Event) => {
      const tagId = (event as CustomEvent<{ tagId?: string }>).detail?.tagId
      if (tagId) setEditingTag(tagId)
    }
    window.addEventListener(EDIT_NOTE_EVENT, onEdit)
    return () => window.removeEventListener(EDIT_NOTE_EVENT, onEdit)
  }, [])

  useEffect(() => {
    if (!followPlayhead || !playing || !active) return
    const el = wordRefs.current.get(active.id)
    if (!el) return
    followLock.current = true
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const timer = window.setTimeout(() => {
      followLock.current = false
    }, 420)
    return () => window.clearTimeout(timer)
  }, [followPlayhead, playing, active?.id])

  useEffect(() => {
    const script = scriptRef.current
    if (!script) return
    const onScroll = () => {
      if (followLock.current) return
      if (useEditor.getState().followPlayhead) useEditor.getState().setFollowPlayhead(false)
    }
    script.addEventListener('scroll', onScroll, { passive: true })
    return () => script.removeEventListener('scroll', onScroll)
  }, [])

  function runReplace(all: boolean) {
    const groups = all ? findGroups : findGroups.length ? [findGroups[findIndex] ?? findGroups[0]] : []
    const pairs = replacePlan(words, findQuery, replaceQuery, groups)
    if (!pairs.length) {
      setFindNote('Nothing to replace')
      return
    }
    const before = useEditor.getState().project
    dispatch({ type: 'replaceWords', pairs })
    const follow = toastForCaptionFollow(before, useEditor.getState().project)
    onToast?.(
      (all
        ? `Replaced ${groups.length} “${findQuery.trim()}” with “${replaceQuery}”.`
        : `Replaced “${findQuery.trim()}” with “${replaceQuery}”.`) + (follow ? ` ${follow}` : '')
    )
  }

  const transcriptSections: Array<{
    key: string
    scenes: (typeof project.scenes)
    wordIndexes: number[]
  }> = []
  let currentSection: (typeof transcriptSections)[number] = {
    key: 'transcript-intro',
    scenes: [],
    wordIndexes: []
  }
  words.forEach((_, index) => {
    const anchoredScenes = sceneAnchors.atWord.get(index) ?? []
    if (anchoredScenes.length) {
      if (currentSection.scenes.length || currentSection.wordIndexes.length) transcriptSections.push(currentSection)
      anchoredScenes.forEach((scene, sceneIndex) => {
        const nextSection = {
          key: `transcript-${scene.id}`,
          scenes: [scene],
          wordIndexes: [] as number[]
        }
        if (sceneIndex < anchoredScenes.length - 1) transcriptSections.push(nextSection)
        else currentSection = nextSection
      })
    }
    currentSection.wordIndexes.push(index)
  })
  if (currentSection.scenes.length || currentSection.wordIndexes.length) transcriptSections.push(currentSection)

  return (
    <section
      className="panel transcript"
      data-drop={dropHover || undefined}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) setDropHover(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropHover(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDropHover(false)
        const file = e.dataTransfer.files[0]
        if (!file) return
        void ingestDroppedFile(file, onToast ?? (() => undefined)).catch((err) => {
          onToast?.(err instanceof Error ? err.message : 'Could not open that file.')
        })
      }}
    >
      <div className="panel-head transcript-head">
        <span className="transcript-heading">
          <strong>Transcript</strong>
          <small>
            {islands
              ? `${words.filter((word) => !word.deleted).length} speech regions · no words`
              : `${words.filter((word) => !word.deleted).length} words · ${(project.scenes ?? []).length} chapters`}
          </small>
        </span>
        <span className="transcript-head-actions">
          {((words.some((word) => !word.deleted) && !islands) ||
            hasYouTubeChapters(project) ||
            hasExportableCaptions(project)) && (
            <OverflowMenu tone="chip" place="below" label="Copy" title="Copy transcript output">
              {words.some((word) => !word.deleted) && (
                <button
                  type="button"
                  className="overflow-item"
                  title="Copy the speaker notes with chapter headings. Paste into Slack or Notion."
                  onClick={() => void exportSidecar('md', onToast ?? (() => undefined))}
                >
                  Copy notes
                </button>
              )}
              {hasYouTubeChapters(project) && (
                <button
                  type="button"
                  className="overflow-item"
                  title="Copy 0:00 timestamps. Paste into the YouTube description."
                  onClick={() => void exportSidecar('chapters', onToast ?? (() => undefined))}
                >
                  Copy chapters
                </button>
              )}
              {hasExportableCaptions(project) && (
                <button
                  type="button"
                  className="overflow-item"
                  title="Copy the captions and download the SRT. Upload it next to the MP4."
                  onClick={() => void exportSidecar('srt', onToast ?? (() => undefined))}
                >
                  Export SRT
                </button>
              )}
            </OverflowMenu>
          )}
          <OverflowMenu tone="chip" place="below" label="•••" title="Transcript options">
            <span className="overflow-section-label">Reading</span>
            <button
              type="button"
              className="overflow-item"
              data-active={followPlayhead || undefined}
              onClick={() => setFollowPlayhead(!followPlayhead)}
            >
              {followPlayhead ? '✓ Follow playback' : 'Follow playback'}
            </button>
            <span className="overflow-section-label">Speakers</span>
            {project.transcript.speakers.map((speaker) => {
              const active =
                focusedSpeaker === speaker.id ||
                speakerIdFromSelection(selected, words, project.transcript.speakers) === speaker.id
              return editingSpeaker === speaker.id ? (
                <input
                  key={speaker.id}
                  className="speaker-edit transcript-speaker-edit"
                  autoFocus
                  defaultValue={speaker.name}
                  aria-label="Speaker name"
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={(event) => commitSpeakerName(speaker, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                    if (event.key === 'Escape') setEditingSpeaker(null)
                  }}
                />
              ) : (
                <button
                  key={speaker.id}
                  type="button"
                  className="overflow-item transcript-speaker-option"
                  data-active={active || undefined}
                  title={selected.length ? `Assign ${speaker.name}` : `Select ${speaker.name} · double-click to rename`}
                  onClick={() => clickSpeakerChip(speaker)}
                  onDoubleClick={(event) => {
                    event.preventDefault()
                    setEditingSpeaker(speaker.id)
                  }}
                >
                  <i className="swatch" style={{ background: speaker.color }} />
                  {speaker.name}
                </button>
              )
            })}
            <button
              type="button"
              className="overflow-item"
              onClick={() => {
                clearSelection()
                dispatch({ type: 'addSpeaker' })
                const next = useEditor.getState().project.transcript.speakers
                setFocusedSpeaker(next[next.length - 1]?.id ?? null)
              }}
            >
              Add speaker
            </button>
          </OverflowMenu>
        </span>
      </div>
      {words.length > 0 && tool === 'guard' && (
        <div className="guard-banner" role="status">
          <span>
            {guardKind === 'demo'
              ? 'Drag words to mark a silent demo — Auto Edit will skip pauses.'
              : guardKind === 'note'
                ? 'Drag words, then type the note — hook, ask, or why you parked.'
                : 'Drag words to protect them — Auto Edit will skip this.'}
          </span>
          <button
            type="button"
            className="chip"
            data-on={guardKind === 'keep' || undefined}
            title="Keep this speech. Auto Edit will not cut it."
            onClick={() => setGuardKind('keep')}
          >
            Keep
          </button>
          <button
            type="button"
            className="chip"
            data-on={guardKind === 'demo' || undefined}
            title="Product walkthrough. Auto Edit will skip pauses here."
            onClick={() => setGuardKind('demo')}
          >
            Silent demo
          </button>
          <button
            type="button"
            className="chip"
            data-on={guardKind === 'note' || undefined}
            title="Leave a comment on these words. Auto Edit ignores notes."
            onClick={() => setGuardKind('note')}
          >
            Note
          </button>
          <button type="button" className="chip" title="Leave protect mode (Esc)" onClick={() => setTool('select')}>
            Done
          </button>
        </div>
      )}
      {words.length > 0 && (
        <div className="transcript-toolbar">
          <input
            ref={findRef}
            type="search"
            className="transcript-find"
            aria-label="Find in transcript"
            value={findQuery}
            placeholder="Find phrase, scene, or edit… ⌘F"
            onChange={(e) => {
              const next = e.target.value
              setFindQuery(next)
              if (!next.trim()) {
                setFindNote(null)
                setFindIndex(0)
                return
              }
              findAndSelect(next, 0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (e.shiftKey) findAndSelect(findQuery, -1)
                else hearCurrentFind()
              }
              if (e.key === 'Escape') {
                setFindQuery('')
                setFindNote(null)
                setFindIndex(0)
                scriptRef.current?.focus()
              }
            }}
          />
          {findGroups.length > 0 && (
            <>
              <button
                type="button"
                className="chip"
                title="Previous match (Shift+Enter)"
                onClick={() => findAndSelect(findQuery, -1)}
              >
                ‹
              </button>
              <span className="transcript-find-note">
                {findIndex + 1} / {findGroups.length}
              </span>
              <button
                type="button"
                className="chip"
                title="Next match (Enter)"
                onClick={() => findAndSelect(findQuery, 1)}
              >
                ›
              </button>
              <button
                type="button"
                className="chip"
                title="Loop the sentence around this match. Enter does the same. › goes to the next hit."
                onClick={hearCurrentFind}
              >
                Hear
              </button>
              <OverflowMenu tone="chip" place="below" label="Hit" title="Copy, mark, or replace this match">
                <button
                  type="button"
                  className="overflow-item"
                  title="Copy this line with the speaker and time. Paste it, or Mark clip."
                  onClick={() => onToast?.(copyQuoteFromContext().toast)}
                >
                  Copy quote
                </button>
                <button
                  type="button"
                  className="overflow-item"
                  title="Copy the picture and this line. Paste it into the write-up."
                  onClick={() => void copyStillFromContext().then((result) => onToast?.(result.toast))}
                >
                  Copy frame
                </button>
                <button
                  type="button"
                  className="overflow-item"
                  title="In–Out around this match. Then export it or hunt the next one. M does the same when Find is not focused."
                  onClick={() => onToast?.(markClipFromContext().toast)}
                >
                  Mark clip
                </button>
                {findGroups.length > 1 && (
                  <button
                    type="button"
                    className="overflow-item"
                    title="Select every match — then Remove to cut them all"
                    onClick={() => applySelection(findGroups.flat(), { loop: false, anchor: findGroups[0][0] })}
                  >
                    All {findGroups.length}
                  </button>
                )}
                <input
                  type="text"
                  className="transcript-find transcript-replace"
                  value={replaceQuery}
                  placeholder="Replace with…"
                  aria-label="Replace with"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setReplaceQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      runReplace(e.shiftKey)
                    }
                  }}
                />
                <button
                  type="button"
                  className="overflow-item"
                  title="Replace this match. Timing stays; only the words change."
                  onClick={() => runReplace(false)}
                >
                  Replace
                </button>
                {findGroups.length > 1 && (
                  <button
                    type="button"
                    className="overflow-item"
                    title="Replace every match in one undo."
                    onClick={() => runReplace(true)}
                  >
                    Replace all
                  </button>
                )}
              </OverflowMenu>
            </>
          )}
          {findNote && !findGroups.length && <span className="transcript-find-note">{findNote}</span>}
        </div>
      )}
      {words.length === 0 ? (
        hasSource || analyzing ? (
          <div className="start-guide compact">
            <p className="start-guide-lead">
              {analyzing
                ? /transcript|whisper/i.test(analyzing)
                  ? 'Whisper is transcribing the recording'
                  : 'Media is still being prepared'
                : 'No transcript yet.'}
            </p>
            <p>
              {analyzing && !/transcript|whisper/i.test(analyzing)
                ? 'Waveform, picture analysis, and preview work are separate from Whisper. Their live status is shown above.'
                : 'Play and cut on the timeline. Words land when Whisper finishes, or drop a transcript here now.'}
            </p>
          </div>
        ) : (
          <StartGuide onToast={onToast} />
        )
      ) : (
      <div
        ref={scriptRef}
        className="script"
        tabIndex={0}
        data-tool={tool}
        data-guard={guardKind}
        onMouseDown={(e) => {
          if (tool === 'guard') return
          if ((e.target as HTMLElement).closest('.word, .gap-chip, .scene-chip, .scene-chip-row, .scene-chip-actions, .guard-chip, .guard-chip-edit, .word-popover, .word-edit')) return
          if (e.button !== 0) return
          e.preventDefault()
          paintAdditiveRef.current = e.ctrlKey || e.metaKey || e.shiftKey
          const x0 = e.clientX
          const y0 = e.clientY
          setMarquee({ x0, y0, x1: x0, y1: y0 })
          const move = (ev: MouseEvent) => setMarquee({ x0, y0, x1: ev.clientX, y1: ev.clientY })
          const up = (ev: MouseEvent) => {
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
            const box = { x0, y0, x1: ev.clientX, y1: ev.clientY }
            const dragged = Math.abs(box.x1 - box.x0) > 4 || Math.abs(box.y1 - box.y0) > 4
            if (dragged) {
              const ids = idsInMarquee(box)
              if (ids.length) applySelection(ids, { additive: paintAdditiveRef.current })
            }
            setMarquee(null)
          }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }}
        onMouseUp={() => {
          const painted = paintIdsRef.current
          if (!painted?.length) {
            setPaint(null)
            return
          }
          if (tool === 'guard') {
            const span = wordRange(words, painted)
            if (span) {
              if (guardKind === 'keep' || guardKind === 'demo') {
                onToast?.(protectRange(span.start, span.end, guardKind).toast)
              } else {
                dispatch({
                  type: 'addTag',
                  start: span.start,
                  end: span.end,
                  kind: 'note',
                  label: 'Note'
                })
                const note = coveringNote(useEditor.getState().project, span.start, span.end)
                if (note) setEditingTag(note.id)
                onToast?.('Type the note — hook, ask, or why you parked.')
              }
              applySelection(painted, { loop: false })
            }
          } else {
            applySelection(painted, { additive: paintAdditiveRef.current })
          }
          setPaint(null)
        }}
        onMouseLeave={() => {
          if (paintIdsRef.current) setPaint(null)
          dragMoved.current = false
        }}
      >
        <div className="transcript-document">
        {islands && (
          <p className="help transcript-island-note">
            No transcript. These blocks are silence-detected speech regions, not spoken words. Drop
            Whisper JSON here or Transcribe again.
          </p>
        )}
        {transcriptSections.map((section) => {
          const scene = section.scenes[0]
          const takeScenes = scene ? takeFamily(project.scenes ?? [], scene.id) : []
          const isTake = takeScenes.length > 1 || scene?.kind === 'retake'
          const takePosition = scene ? takeScenes.findIndex((take) => take.id === scene.id) : -1
          const isFirstTake = isTake && takePosition <= 0
          const isActiveTake = isTake && scene?.kind !== 'retake'
          return (
            <section
              key={section.key}
              className="transcript-chapter"
              data-kind={section.scenes[0]?.kind ?? 'chapter'}
              data-on={section.scenes.some((scene) => scene.id === selectedSceneId) || undefined}
              data-take={isTake || undefined}
              data-take-first={isFirstTake || undefined}
              data-take-active={isActiveTake || undefined}
            >
              {isFirstTake && (
                <div className="take-group-label">
                  <span>Takes</span>
                  <span>{takeScenes.length} versions</span>
                </div>
              )}
              {isTake && <span className="take-branch-dot" aria-hidden="true" />}
              {section.scenes.map((scene) => renderScene(scene))}
              <div className="transcript-chapter-copy">
        {section.wordIndexes.map((i) => {
          const word = words[i]
          const prev = words[i - 1]
          const gap = prev ? word.start - prev.end : 0
          const tag = tagAt(project.tags, word.start)
          const gapSpan = prev ? { start: prev.end, end: word.start } : null
          const gapReview = gapSpan ? reviewGap(project, gapSpan.start, gapSpan.end) : null
          const leftoverAtGap = gapSpan ? leftoverForSpan(project, gapSpan.start, gapSpan.end) : undefined
          const gapCut = gapReview?.kind === 'cut'
          const tagStart = Boolean(tag && (!prev || prev.start < tag.start))
          const applied = word.deleted ? appliedForWord(project, word) : undefined
          const gapTag = prev ? tagAt(project.tags, (prev.end + word.start) / 2) : undefined
          const showGapGuard = Boolean(gapTag && !gapReview && prev && gapTag.start >= prev.end - 0.08)
          const showGapMarker = Boolean(
            gapReview && gapTag?.kind !== 'demo' && (gap > 0.45 || leftoverAtGap)
          )
          return (
            <Fragment key={word.id}>
              {tagStart && tag && renderGuardChip(tag)}
              <span className="word-wrap">
              {(showGapGuard || showGapMarker) && prev && (
                <span className="gap-cluster">
                  {showGapGuard && gapTag &&
                    renderGuardChip(gapTag, {
                      hear: () => {
                        seekSource(gapTag.start)
                        loopSpan(gapTag.start, gapTag.end)
                        selectGap({ start: gapTag.start, end: gapTag.end })
                      }
                    })}
                  {showGapMarker && gapReview && (
                  <button
                    type="button"
                    className="gap-chip"
                    data-gap-start={prev.end}
                    data-gap-end={word.start}
                    data-cut={gapCut}
                    data-leftover={leftoverAtGap ? gapReview.kind : ''}
                    data-tag={gapTag?.kind ?? ''}
                    data-sug={gapReview.suggestion?.type ?? ''}
                    title={gapReview.title}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const start = prev.end
                      const end = word.start
                      seekSource(gapReview.start)
                      loopSpan(gapReview.start, gapReview.end)
                      if (gapReview.suggestion) selectSuggestion(gapReview.suggestion.id)
                      else selectGap({ start, end })
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      const command = commandForGapDoubleClick(project, prev.end, word.start)
                      if (!command) {
                        onToast?.('Silent demo is in this pause. Paint stays; this will not cut it.')
                        return
                      }
                      dispatch(command)
                      const toast = toastForCommand(command)
                      if (toast) onToast?.(toast)
                    }}
                  >
                    {gapReview.chip}
                  </button>
                  )}
                </span>
              )}
              {gap > PARAGRAPH_GAP && <span className="para-gap" />}
              {!word.text.trim() && editing !== word.id ? null : editing === word.id ? (
                <input
                  className="word-edit"
                  autoFocus
                  defaultValue={word.text}
                    onBlur={(e) => {
                    const before = useEditor.getState().project
                    dispatch({ type: 'setWordText', wordId: word.id, text: e.target.value })
                    const follow = toastForCaptionFollow(before, useEditor.getState().project)
                    if (follow) onToast?.(follow)
                    setEditing(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                <button
                  ref={(el) => {
                    if (el) wordRefs.current.set(word.id, el)
                    else wordRefs.current.delete(word.id)
                  }}
                  className="word"
                  data-origin={isPlaceholderWord(word) ? 'island' : undefined}
                  data-word-id={word.id}
                  data-on={active?.id === word.id}
                      data-sel={selected.includes(word.id) && !selectedSceneId}
                      data-scene-sel={
                        Boolean(
                          selectedScene && word.start >= selectedScene.start && word.end <= selectedScene.end
                        ) || undefined
                      }
                  data-deleted={word.deleted}
                  data-filler={isFillerToken(word.text)}
                  data-tag={tag?.kind}
                  data-sug={applied?.type}
                  data-paint={paintIds?.includes(word.id) ?? false}
                  data-find={findHitIds.has(word.id) || undefined}
                  title={
                    isPlaceholderWord(word)
                      ? 'Not spoken text — a silence-detected speech region. Drop Whisper JSON or Transcribe again for words.'
                      : applied
                        ? `${applied.label} · double-click puts this cut back`
                        : tag
                          ? `${tag.label}`
                          : 'Click to hear · double-click a sentence · triple-click a paragraph · Remove paragraph hears the join'
                  }
                  style={{ ['--spk' as string]: speakerColor(project.transcript.speakers, word.speaker) }}
                  onMouseDown={(e) => {
                    if (editing) return
                    if (e.button !== 0) return
                    e.preventDefault()
                    dragMoved.current = false
                    paintAdditiveRef.current = e.ctrlKey || e.metaKey || e.shiftKey
                    setPaint([word.id])
                  }}
                  onMouseEnter={() => {
                    if (!paintIdsRef.current) return
                    const start = words.findIndex((w) => w.id === paintIdsRef.current![0])
                    if (start < 0) return
                    const [lo, hi] = start <= i ? [start, i] : [i, start]
                    const next = wordIdsInRange(words, lo, hi)
                    if (next.length > 1) dragMoved.current = true
                    setPaint(next)
                  }}
                  onClick={(e) => {
                    if (tool === 'guard') return
                    if (dragMoved.current) {
                      dragMoved.current = false
                      return
                    }
                    if (e.detail >= 3) {
                      if (pendingDouble.current) clearTimeout(pendingDouble.current)
                      pendingDouble.current = null
                      const ids = paragraphIds(words, i)
                      applySelection(ids)
                      const span = wordRange(words, ids)
                      if (span && ids.length >= 2) {
                        onToast?.(
                          `Paragraph selected · ${formatSpan(span.end - span.start)}. Remove paragraph on the bar (or Delete) hears the join.`
                        )
                      }
                      return
                    }
                    if (e.detail === 2) return

                    if (e.shiftKey) {
                      const anchorId = anchorRef.current ?? selected[0] ?? word.id
                      const anchorIdx = words.findIndex((w) => w.id === anchorId)
                      const from = anchorIdx >= 0 ? anchorIdx : i
                      applySelection(wordIdsInRange(words, from, i))
                      return
                    }

                    if (e.ctrlKey || e.metaKey) {
                      if (selectedSet.has(word.id)) {
                        const next = selected.filter((id) => id !== word.id)
                        selectWords(next)
                        if (anchorRef.current === word.id) anchorRef.current = next[0] ?? null
                      } else {
                        selectWords([word.id], true)
                      }
                      return
                    }

                    if (e.altKey) {
                      const ids = sentenceIds(words, i)
                      applySelection(ids)
                      return
                    }

                    const heard = nearestSpokenWord(words, i) ?? word
                    anchorRef.current = heard.id
                    selectWords([heard.id])
                    if (heard.id === word.id) loopSentenceAt(word.id)
                    else loopSelection([heard.id])
                    return
                  }}
                  onDoubleClick={() => {
                    if (pendingDouble.current) clearTimeout(pendingDouble.current)
                    pendingDouble.current = setTimeout(() => {
                      pendingDouble.current = null
                      if (applied) {
                        dispatch({ type: 'revertSuggestion', suggestionId: applied.id })
                        return
                      }
                      applySelection(sentenceIds(words, i))
                    }, 220)
                  }}
                >
                  {word.text}
                </button>
              )}
              {popoverAnchor?.id === word.id && choices.length > 0 && (
                <span
                  ref={popoverRef}
                  className="word-popover"
                  style={
                    popoverPlacement?.anchorId === word.id
                      ? {
                          left: popoverPlacement.left,
                          top: popoverPlacement.top,
                          maxWidth: popoverPlacement.maxWidth,
                          maxHeight: popoverPlacement.maxHeight,
                          visibility: popoverPlacement.visible ? 'visible' : 'hidden'
                        }
                      : { visibility: 'hidden' }
                  }
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <span className="word-popover-actions">
                    {choices.slice(0, 2).map((choice, index) => (
                      <button
                        key={choice.id}
                        className={index === 0 ? 'chip word-popover-primary' : 'chip'}
                        title={choice.consequence}
                        onClick={() => {
                          if (choice.id === 'cut-prev') {
                            onToast?.(cutPreviousFromContext().toast)
                            return
                          }
                          if (choice.id === 'cut-sentence') {
                            onToast?.(cutThisFromContext().toast)
                            return
                          }
                          if (choice.id === 'cut-paragraph') {
                            onToast?.(cutParagraphFromContext().toast)
                            return
                          }
                          dispatch(choice.command)
                          const toast = toastForEdit(project, choice.command)
                          if (toast) onToast?.(toast)
                        }}
                      >
                        {choice.label}
                      </button>
                    ))}
                    <OverflowMenu tone="chip" place="below" label="More" title="More actions for these words">
                      {choices.slice(2).map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          className="overflow-item"
                          title={choice.consequence}
                          onClick={() => {
                            if (choice.id === 'cut-prev') {
                              onToast?.(cutPreviousFromContext().toast)
                              return
                            }
                            if (choice.id === 'cut-sentence') {
                              onToast?.(cutThisFromContext().toast)
                              return
                            }
                            if (choice.id === 'cut-paragraph') {
                              onToast?.(cutParagraphFromContext().toast)
                              return
                            }
                            dispatch(choice.command)
                            const toast = toastForEdit(project, choice.command)
                            if (toast) onToast?.(toast)
                          }}
                        >
                          {choice.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="overflow-item"
                        onClick={() => onToast?.(copyQuoteFromContext().toast)}
                      >
                        Copy quote
                      </button>
                      <button
                        type="button"
                        className="overflow-item"
                        onClick={() => void copyStillFromContext().then((result) => onToast?.(result.toast))}
                      >
                        Copy frame
                      </button>
                      <button
                        type="button"
                        className="overflow-item"
                        onClick={() => onToast?.(markClipFromContext().toast)}
                      >
                        Mark clip
                      </button>
                      <button
                        type="button"
                        className="overflow-item"
                        onClick={() => onToast?.(splitChapterFromContext().toast)}
                      >
                        Split chapter here
                      </button>
                    </OverflowMenu>
                  </span>
                </span>
              )}
            </span>
            </Fragment>
          )
        })}
              </div>
            </section>
          )
        })}
        {sceneAnchors.after.map((scene) => (
          <section
            key={scene.id}
            className="transcript-chapter transcript-chapter-empty"
            data-kind={scene.kind}
            data-on={scene.id === selectedSceneId || undefined}
          >
            {renderScene(scene)}
          </section>
        ))}
        {words.length > 0 && (
          <p className="script-hint">
            {tool === 'guard'
              ? 'Drag across words to protect them. Done or Esc leaves this mode.'
              : 'Click words to hear them. Select text to reveal editing actions.'}
          </p>
        )}
        </div>
      </div>
      )}
      {marquee && (
        <div
          className="transcript-marquee"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0)
          }}
        />
      )}
    </section>
  )
}

export { extendSelection, wordRange }
