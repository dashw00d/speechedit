export interface ToastAction {
  label: string
  ariaLabel?: string
  run: () => void
}

/** A toast can carry one contextual action, like "Relink original media". */
export interface ToastEntry {
  message: string
  action?: ToastAction
}

export type ToastDispatch = (msg: string | ToastEntry) => void

const UNDO_HINT = /\bundo\b/i

export function toastOffersUndo(message: string | null | undefined, canUndo: boolean): boolean {
  if (!canUndo || !message) return false
  return UNDO_HINT.test(message)
}

export const TOAST_UNDONE = 'Undid the last edit. Redo puts it back.'
