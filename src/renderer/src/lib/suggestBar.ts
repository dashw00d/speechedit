export const BAR_ACTIONS = [
  'hear-leftover',
  'silent-demo',
  'speed-4x',
  'cut-leftover',
  'keep-leftover',
  'quiet-leftover',
  'protect-pause',
  'cut-prev',
  'cut-sentence',
  'cut-paragraph',
  'breaths',
  'cut-fillers',
  'find-retakes',
  'collapse-retakes',
  'review',
  'add-title',
  'chapter-names',
  'apply-style',
  'add-lower-third',
  'add-zoom',
  'add-redaction',
  'add-broll',
  'add-music',
  'copy-quote',
  'copy-frame',
  'mark-clip',
  'add-note',
  'remove-scene',
  'merge-prev',
  'merge-next',
  'split-chapter',
  'copy-notes',
  'copy-chapters',
  'caption-remaining',
  'watch',
  'normalize',
  'export',
  'export-srt',
  'cut-marked',
  'tighten-marked',
  'frame-9-16',
  'export-marked',
  'clear-marks'
] as const

export type BarActionId = (typeof BAR_ACTIONS)[number]

export type BarJob = 'clean' | 'leftover' | 'leftover-decide' | 'retake' | 'marked' | 'selection' | 'finish'

/** One job on the row. Everything else waits in More. */
export const BAR_NOW: Record<BarJob, readonly BarActionId[]> = {
  clean: ['collapse-retakes', 'find-retakes', 'review', 'cut-fillers'],
  leftover: ['hear-leftover'],
  'leftover-decide': ['silent-demo', 'speed-4x', 'cut-leftover', 'keep-leftover', 'quiet-leftover'],
  retake: ['collapse-retakes', 'find-retakes', 'review', 'cut-fillers'],
  marked: ['cut-marked', 'tighten-marked', 'frame-9-16', 'export-marked', 'clear-marks'],
  selection: ['protect-pause', 'cut-prev', 'cut-sentence', 'cut-paragraph', 'copy-quote', 'copy-frame', 'mark-clip', 'add-note', 'add-zoom', 'add-redaction', 'apply-style', 'remove-scene', 'merge-prev', 'merge-next', 'split-chapter'],
  finish: ['watch', 'export', 'normalize', 'export-srt', 'copy-notes', 'copy-chapters', 'add-title', 'add-lower-third', 'chapter-names', 'caption-remaining', 'review']
}

export const BAR_MORE_ORDER: readonly BarActionId[] = [
  'hear-leftover',
  'silent-demo',
  'speed-4x',
  'cut-leftover',
  'keep-leftover',
  'quiet-leftover',
  'protect-pause',
  'cut-prev',
  'cut-sentence',
  'cut-paragraph',
  'breaths',
  'cut-fillers',
  'find-retakes',
  'collapse-retakes',
  'review',
  'copy-quote',
  'apply-style',
  'remove-scene',
  'merge-prev',
  'merge-next',
  'split-chapter',
  'add-title',
  'chapter-names',
  'add-lower-third',
  'add-zoom',
  'add-redaction',
  'add-broll',
  'add-music',
  'copy-frame',
  'mark-clip',
  'add-note',
  'copy-notes',
  'copy-chapters',
  'caption-remaining',
  'watch',
  'normalize',
  'export',
  'export-srt',
  'cut-marked',
  'tighten-marked',
  'frame-9-16',
  'export-marked',
  'clear-marks'
]

export function suggestBarJob(input: {
  marked: boolean
  selecting: boolean
  leftover: boolean
  leftoverDecide?: boolean
  retake: boolean
  preClean: boolean
}): BarJob {
  if (input.marked) return 'marked'
  if (input.selecting) return 'selection'
  if (input.leftoverDecide) return 'leftover-decide'
  if (input.leftover) return 'leftover'
  if (input.preClean) return input.retake ? 'retake' : 'clean'
  if (input.retake) return 'retake'
  return 'finish'
}

export function planSuggestBar(
  job: BarJob,
  available: Iterable<BarActionId>
): { now: BarActionId[]; more: BarActionId[] } {
  const have = new Set(available)
  const now = BAR_NOW[job].filter((id) => have.has(id))
  const more = BAR_MORE_ORDER.filter((id) => have.has(id) && !now.includes(id))
  return { now, more }
}
