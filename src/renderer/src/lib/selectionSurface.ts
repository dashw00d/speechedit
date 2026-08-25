/** Elements that should not dismiss the current selection when clicked. */
const KEEPS_SELECTION =
  '.word, .word-edit, .gap-chip, .scene-chip, .scene-chip-row, .scene-chip-actions, .scene-chip-edit, .guard-chip, .guard-banner, .word-popover, .clip, .edit-block, .edits-lane, .inspector, .drawer, .palette, .agent-dock, .menu-fly, .context-menu, .transcript-find, .transcript-toolbar, .transcript-marquee, .timeline-toolbar, .track-label-actions, .start-guide, .start-card, .confirm-sheet, .confirm-back, .export-sheet, .export-back'

export function keepsSelection(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest(KEEPS_SELECTION))
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}
