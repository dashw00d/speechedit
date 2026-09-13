const UNDO_HINT = /\bundo\b/i

export function toastOffersUndo(message: string | null | undefined, canUndo: boolean): boolean {
  if (!canUndo || !message) return false
  return UNDO_HINT.test(message)
}

export const TOAST_UNDONE = 'Undid the last edit. Redo puts it back.'
