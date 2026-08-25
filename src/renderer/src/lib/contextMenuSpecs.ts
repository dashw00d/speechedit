import type { Command } from '../types'
import {
  gapInspectorDetail,
  pendingSuggestionForGap,
  sceneInspectorDetail,
  suggestionInspectorDetail,
  transcriptChoices,
  type InspectorAction
} from './contextActions'
import { programLength, primarySegments } from './commands'
import { takeFamily } from './sceneAnalysis'
import { programToSourceOf, sourceToProgramOf } from './resolver'
import { paragraphIds, sentenceIds } from './transcriptEdit'
import { ffmpegImportBusy } from './mediaJobs'
import { copySelectedClip, pasteClipboard } from './clipClipboard'
import { useEditor, usePlayback } from '../store'
import type { EditBlock } from './timelineEdits'

export interface ContextMenuItem {
  id: string
  label: string
  hint?: string
  shortcut?: string
  disabled?: boolean
  separator?: boolean
  run?: () => void
}

export interface ContextMenuSpec {
  title?: string
  items: ContextMenuItem[]
}

function fromCommands(
  choices: Array<{ id: string; label: string; consequence: string; command: Command }>
): ContextMenuItem[] {
  return choices.map((c) => ({
    id: c.id,
    label: c.label,
    hint: c.consequence,
    run: () => useEditor.getState().dispatch(c.command)
  }))
}

function fromInspectorActions(actions: InspectorAction[]): ContextMenuItem[] {
  return actions
    .filter((a) => a.command || a.navigate)
    .map((a) => ({
      id: a.id,
      label: a.label,
      hint: a.consequence,
      run: () => {
        if (a.command) useEditor.getState().dispatch(a.command)
      }
    }))
}

function copyText(text: string) {
  void navigator.clipboard.writeText(text).catch(() => undefined)
}

function wordMenu(wordId: string): ContextMenuSpec {
  const editor = useEditor.getState()
  const project = editor.project
  const word = project.transcript.words.find((w) => w.id === wordId)
  if (!word) return { items: [] }

  const selected = editor.selectedWordIds.includes(wordId)
    ? editor.selectedWordIds
    : [wordId]
  editor.selectWords(selected)

  const { choices } = transcriptChoices(project, selected)
  const items: ContextMenuItem[] = fromCommands(choices)

  items.push({ id: 'sep-edit', label: '', separator: true })
  items.push({
    id: 'edit-text',
    label: 'Edit text…',
    run: () => {
      window.dispatchEvent(new CustomEvent('speechedit:edit-word', { detail: { wordId } }))
    }
  })
  items.push({
    id: 'copy',
    label: 'Copy',
    shortcut: '⌘C',
    run: () => {
      const text = project.transcript.words
        .filter((w) => selected.includes(w.id))
        .map((w) => w.text)
        .join(' ')
      copyText(text)
    }
  })
  items.push({
    id: 'select-sentence',
    label: 'Select sentence',
    run: () => {
      const idx = project.transcript.words.findIndex((w) => w.id === wordId)
      if (idx >= 0) editor.selectWords(sentenceIds(project.transcript.words, idx))
    }
  })
  items.push({
    id: 'select-paragraph',
    label: 'Select paragraph',
    run: () => {
      const idx = project.transcript.words.findIndex((w) => w.id === wordId)
      if (idx >= 0) editor.selectWords(paragraphIds(project.transcript.words, idx))
    }
  })
  items.push({ id: 'sep-play', label: '', separator: true })
  items.push({
    id: 'park',
    label: 'Go here',
    run: () => usePlayback.getState().seekSource(word.start)
  })

  return { title: word.deleted ? `[${word.text}]` : word.text, items }
}

function gapMenu(start: number, end: number): ContextMenuSpec {
  const editor = useEditor.getState()
  const sug = pendingSuggestionForGap(editor.project, start, end)
  if (sug) {
    editor.selectSuggestion(sug.id)
    const detail = suggestionInspectorDetail(editor.project, sug.id)
    if (detail) {
      return { title: detail.headline, items: fromInspectorActions(detail.actions) }
    }
  }
  editor.selectGap({ start, end })
  const detail = gapInspectorDetail(editor.project, start, end)
  if (!detail) return { items: [] }
  return { title: detail.headline, items: fromInspectorActions(detail.actions) }
}

function sceneMenu(sceneId: string): ContextMenuSpec {
  const editor = useEditor.getState()
  const playback = usePlayback.getState()
  editor.selectScene(sceneId)
  const detail = sceneInspectorDetail(editor.project, sceneId)
  if (!detail) return { items: [] }
  const items = fromInspectorActions(detail.actions.filter((a) => a.command))
  if (detail.actions.some((a) => a.navigate === 'compare-takes')) {
    items.push({
      id: 'compare',
      label: 'Loop takes A ↔ B',
      hint: 'Loop playback across this take and the next attempt.',
      run: () => {
        const family = takeFamily(editor.project.scenes ?? [], sceneId)
        if (family.length < 2) return
        const idx = family.findIndex((s) => s.id === sceneId)
        const a = family[idx]
        const b = family[(idx + 1) % family.length]
        editor.selectScene(a.id)
        const lo = Math.min(sourceToProgramOf(editor.project, a.start), sourceToProgramOf(editor.project, b.start))
        const hi = Math.max(sourceToProgramOf(editor.project, a.end), sourceToProgramOf(editor.project, b.end))
        playback.playLoop(lo, hi)
      }
    })
  }
  return { title: detail.headline, items }
}

function clipMenu(clipId: string): ContextMenuSpec {
  const editor = useEditor.getState()
  const playback = usePlayback.getState()
  editor.selectClip(clipId)
  const project = editor.project
  const segments = primarySegments(project)
  const clip =
    project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId) ??
    segments.find((c) => c.id === clipId)
  if (!clip) return { items: [] }

  const isPrimary = segments.some((s) => s.id === clip.id)
  const sourceTime = programToSourceOf(project, playback.programTime)

  const items: ContextMenuItem[] = [
    {
      id: 'trim-in',
      label: 'Trim start to here',
      run: () => {
        if (isPrimary) {
          editor.dispatch({ type: 'trimPrimary', segmentId: clip.id, edge: 'in', sourceTime })
        } else {
          editor.dispatch({ type: 'trimClip', clipId: clip.id, edge: 'in', time: playback.programTime })
        }
      }
    },
    {
      id: 'trim-out',
      label: 'Trim end to here',
      run: () => {
        if (isPrimary) {
          editor.dispatch({ type: 'trimPrimary', segmentId: clip.id, edge: 'out', sourceTime })
        } else {
          editor.dispatch({ type: 'trimClip', clipId: clip.id, edge: 'out', time: playback.programTime })
        }
      }
    },
    {
      id: 'split',
      label: 'Split at playhead',
      shortcut: '⌘\\',
      run: () => editor.dispatch({ type: 'splitAt', time: sourceTime })
    },
    { id: 'sep', label: '', separator: true },
    {
      id: 'park',
      label: 'Go to clip start',
      run: () => playback.seekProgram(clip.start)
    }
  ]

  if (!isPrimary) {
    items.push({
      id: 'copy',
      label: 'Copy clip',
      run: () => {
        editor.selectClip(clip.id)
        copySelectedClip('clip')
      }
    })
    items.push({
      id: 'paste',
      label: 'Paste at playhead',
      run: () => pasteClipboard('clip')
    })
    items.push({
      id: 'duplicate',
      label: 'Duplicate clip',
      run: () => editor.dispatch({ type: 'duplicateClip', clipId: clip.id })
    })
    items.push({
      id: 'mute',
      label: clip.muted ? 'Unmute clip' : 'Mute clip',
      run: () => editor.dispatch({ type: 'setMuted', clipId: clip.id, muted: !clip.muted })
    })
  }

  if (clip.text) {
    items.unshift({
      id: 'copy-text',
      label: 'Copy caption text',
      run: () => copyText(clip.text ?? '')
    })
  }

  return { title: clip.text || 'Clip', items }
}

function editBlockMenu(block: EditBlock): ContextMenuSpec {
  const editor = useEditor.getState()
  const playback = usePlayback.getState()
  playback.seekProgram(block.start)

  const items: ContextMenuItem[] = [
    {
      id: 'park',
      label: 'Go here',
      run: () => playback.seekProgram(block.start)
    },
    {
      id: 'hear',
      label: 'Hear',
      run: () => playback.playLoop(block.start, block.end)
    }
  ]

  if (block.suggestionId) {
    editor.selectSuggestion(block.suggestionId)
    const detail = suggestionInspectorDetail(editor.project, block.suggestionId)
    if (detail) {
      items.push(...fromInspectorActions(detail.actions))
    }
  } else if (block.tagId) {
    items.push({
      id: 'remove-tag',
      label: 'Remove protection',
      run: () => editor.dispatch({ type: 'removeTag', tagId: block.tagId! })
    })
  } else if (block.sceneId) {
    return sceneMenu(block.sceneId)
  }

  return { title: block.label, items }
}

function trackMenu(trackId: string): ContextMenuSpec {
  const editor = useEditor.getState()
  const track = editor.project.tracks.find((t) => t.id === trackId)
  if (!track) return { items: [] }

  const items: ContextMenuItem[] = [
    {
      id: 'mute',
      label: track.muted ? 'Unmute track' : 'Mute track',
      run: () => editor.dispatch({ type: 'setTrackFlag', trackId, patch: { muted: !track.muted } })
    },
    {
      id: 'hide',
      label: track.hidden ? 'Show track' : 'Hide track',
      run: () => editor.dispatch({ type: 'setTrackFlag', trackId, patch: { hidden: !track.hidden } })
    },
    {
      id: 'lock',
      label: track.locked ? 'Unlock track' : 'Lock track',
      run: () => editor.dispatch({ type: 'setTrackFlag', trackId, patch: { locked: !track.locked } })
    }
  ]

  if (!track.clips.length && track.id !== 'v1' && track.id !== 'a1') {
    items.push({ id: 'sep', label: '', separator: true })
    items.push({
      id: 'remove',
      label: 'Remove empty track',
      run: () => editor.dispatch({ type: 'removeTrack', trackId })
    })
  }

  return { title: track.name, items }
}

function transcriptPaneMenu(): ContextMenuSpec {
  const editor = useEditor.getState()
  const items: ContextMenuItem[] = [
    {
      id: 'select-all',
      label: 'Select all words',
      shortcut: '⌘A',
      run: () => editor.selectWords(editor.project.transcript.words.map((w) => w.id))
    },
    {
      id: 'palette',
      label: 'Command palette',
      shortcut: '⌘K',
      run: () => editor.setPalette(true)
    }
  ]
  if (editor.selectedWordIds.length) {
    items.unshift({
      id: 'clear',
      label: 'Clear selection',
      shortcut: 'Esc',
      run: () => editor.clearSelection()
    })
  }
  return { title: 'Transcript', items }
}

function timelinePaneMenu(): ContextMenuSpec {
  const editor = useEditor.getState()
  const playback = usePlayback.getState()
  const sourceTime = programToSourceOf(editor.project, playback.programTime)
  const items: ContextMenuItem[] = [
    {
      id: 'fit',
      label: 'Fit timeline',
      shortcut: '\\',
      run: () => playback.fitTimeline()
    },
    {
      id: 'split',
      label: 'Split at playhead',
      shortcut: '⌘\\',
      run: () => editor.dispatch({ type: 'splitAt', time: sourceTime })
    },
    {
      id: 'snap',
      label: editor.snap ? 'Snap off' : 'Snap on',
      run: () => editor.setSnap(!editor.snap)
    },
    {
      id: 'guard',
      label: editor.tool === 'guard' ? 'Done protecting' : 'Protect words',
      run: () => editor.setTool(editor.tool === 'guard' ? 'select' : 'guard')
    },
    { id: 'sep', label: '', separator: true },
    {
      id: 'palette',
      label: 'Command palette',
      shortcut: '⌘K',
      run: () => editor.setPalette(true)
    }
  ]
  return { title: 'Timeline', items }
}

function appMenu(): ContextMenuSpec {
  const editor = useEditor.getState()
  const items: ContextMenuItem[] = [
    {
      id: 'undo',
      label: 'Undo',
      shortcut: '⌘Z',
      disabled: !editor.past.length,
      run: () => editor.undo()
    },
    {
      id: 'redo',
      label: 'Redo',
      shortcut: '⌘⇧Z',
      disabled: !editor.future.length,
      run: () => editor.redo()
    },
    { id: 'sep', label: '', separator: true },
    {
      id: 'palette',
      label: 'Command palette',
      shortcut: '⌘K',
      run: () => editor.setPalette(true)
    }
  ]
  const len = programLength(editor.project)
  if (len > 0) {
    items.push({
      id: 'export',
      label: editor.exporting ? 'Cancel export' : 'Export…',
      disabled: ffmpegImportBusy(editor.analyzing),
      run: () => window.dispatchEvent(new CustomEvent('speechedit:export'))
    })
  }
  return { items }
}

function parseEditBlock(el: HTMLElement): EditBlock | null {
  const btn = el.closest('.edit-block') as HTMLElement | null
  if (!btn) return null
  const id = btn.getAttribute('data-block-id')
  if (!id) return null
  const kind = btn.getAttribute('data-block-kind') ?? ''
  const start = Number(btn.getAttribute('data-block-start'))
  const end = Number(btn.getAttribute('data-block-end'))
  if (!Number.isFinite(start)) return null
  return {
    id,
    kind: kind as EditBlock['kind'],
    start,
    end: Number.isFinite(end) ? end : start + 0.02,
    label: btn.getAttribute('data-block-label') ?? kind,
    detail: btn.title ?? '',
    suggestionId: btn.getAttribute('data-suggestion-id') ?? undefined,
    tagId: btn.getAttribute('data-tag-id') ?? undefined,
    sceneId: btn.getAttribute('data-scene-id') ?? undefined
  }
}

export function resolveContextMenu(target: EventTarget | null): ContextMenuSpec | null {
  if (!(target instanceof HTMLElement)) return appMenu()

  if (target.closest('input, textarea, select, [contenteditable="true"]')) return null

  if (target.closest('.context-menu, .menu-fly, .palette')) return null

  const wordId = target.closest('[data-word-id]')?.getAttribute('data-word-id')
  if (wordId) return wordMenu(wordId)

  const sceneId = target.closest('[data-scene-id]')?.getAttribute('data-scene-id')
  if (sceneId) return sceneMenu(sceneId)

  const gapEl = target.closest('[data-gap-start]') as HTMLElement | null
  if (gapEl) {
    const start = Number(gapEl.getAttribute('data-gap-start'))
    const end = Number(gapEl.getAttribute('data-gap-end'))
    if (Number.isFinite(start) && Number.isFinite(end)) return gapMenu(start, end)
  }

  const clipId = target.closest('[data-clip-id]')?.getAttribute('data-clip-id')
  if (clipId) return clipMenu(clipId)

  const block = parseEditBlock(target)
  if (block) return editBlockMenu(block)

  const trackId = target.closest('[data-track-id]')?.getAttribute('data-track-id')
  if (trackId) return trackMenu(trackId)

  if (target.closest('.transcript, .script, .transcript-toolbar, .transcript-marquee')) return transcriptPaneMenu()
  if (target.closest('.timeline-body, .timeline-toolbar')) return timelinePaneMenu()
  if (target.closest('.inspector, .monitor, .suggest-bar, .menubar')) return appMenu()

  return appMenu()
}
