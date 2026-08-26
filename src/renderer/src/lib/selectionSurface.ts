/** Elements that should not dismiss the current selection when clicked. */
/** Suggest bar and menu must keep context — Add zoom / Use later take read the selection. */
export const KEEPS_SELECTION =
  '.word, .word-edit, .gap-chip, .scene-chip, .scene-chip-row, .scene-chip-actions, .scene-chip-edit, .guard-chip, .guard-chip-edit, .guard-banner, .word-popover, .clip, .edit-block, .edits-lane, .inspector, .drawer, .drawer-back, .palette, .menu-fly, .menubar, .suggest-bar, .overflow-menu, .transport, .context-menu, .transcript-find, .transcript-toolbar, .transcript-marquee, .speakers, .speaker, .speaker-slot, .speaker-edit, .timeline-toolbar, .track-label-actions, .start-guide, .start-card, .confirm-sheet, .confirm-back, .export-sheet, .export-back, .caption-burn, .overlay-card, .picture-text-edit'

export function keepsSelection(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest(KEEPS_SELECTION))
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}
