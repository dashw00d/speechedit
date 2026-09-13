import { useEffect, useRef } from 'react'

const dialogStack: HTMLDivElement[] = []

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])'

/** Focus stays in the front dialog and returns to its opener when it closes. */
export function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const dialog = ref.current
    if (!open || !dialog) return
    dialogStack.push(dialog)
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const controls = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
    if (!dialog.contains(document.activeElement)) (controls()[0] ?? dialog).focus()
    const onKey = (event: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== dialog) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        close.current()
      } else if (event.key === 'Tab') {
        const items = controls()
        const first = items[0] ?? dialog
        const last = items[items.length - 1] ?? dialog
        if (!dialog.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault()
          const next = event.shiftKey ? last : first
          next.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      const index = dialogStack.lastIndexOf(dialog)
      if (index >= 0) dialogStack.splice(index, 1)
      if (previous?.isConnected) previous.focus()
    }
  }, [open])
  return ref
}
