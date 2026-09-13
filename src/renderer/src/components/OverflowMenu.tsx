import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function OverflowMenu({
  label = 'More',
  title = 'More actions for this moment',
  tone = 'bar',
  place = 'above',
  children
}: {
  label?: ReactNode
  title?: string
  tone?: 'bar' | 'chip' | 'track' | 'menu'
  place?: 'above' | 'below'
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false })
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const fly = useRef<HTMLDivElement>(null)
  const keyboardOpen = useRef(false)

  function close(restoreFocus = false) {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }

  // Render outside scroll panels so every menu stays visible on small screens.
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      if (!trigger.current || !fly.current) return
      const anchor = trigger.current.getBoundingClientRect()
      const menu = fly.current.getBoundingClientRect()
      const below = anchor.bottom + 6
      const above = anchor.top - menu.height - 6
      const top = place === 'below'
        ? (below + menu.height <= window.innerHeight - 8 ? below : above)
        : (above >= 8 ? above : below)
      setPosition({
        left: Math.max(8, Math.min(anchor.right - menu.width, window.innerWidth - menu.width - 8)),
        top: Math.max(8, Math.min(top, window.innerHeight - menu.height - 8)),
        ready: true
      })
    }
    update()
    const observer = new ResizeObserver(update)
    if (fly.current) observer.observe(fly.current)
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
    }
  }, [open, place])

  useEffect(() => {
    if (!open || !position.ready || !keyboardOpen.current) return
    fly.current?.querySelector<HTMLElement>('button:not(:disabled), input, select, textarea')?.focus()
    keyboardOpen.current = false
  }, [open, position.ready])

  useEffect(() => {
    if (!open) return
    const items = () => [...(fly.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea') ?? [])]
    const onPointer = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node) || fly.current?.contains(event.target as Node)) return
      close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        close(true)
        return
      }
      if (!root.current?.contains(event.target as Node) && !fly.current?.contains(event.target as Node)) return
      if (event.target instanceof Element && event.target.matches('input, textarea, select')) return
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const controls = items()
        const current = controls.indexOf(document.activeElement as HTMLElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length
        controls[next]?.focus()
      }
      if (event.key === 'Tab') close(true)
    }
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className="overflow-menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={tone === 'menu' ? 'menu-btn' : tone === 'chip' ? 'chip' : tone === 'track' ? 'track-flag' : 'review-btn'}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={typeof label === 'string' ? undefined : title}
        title={title}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            keyboardOpen.current = true
            setOpen(true)
          }
        }}
        onClick={() => { setPosition((current) => ({ ...current, ready: false })); setOpen((value) => !value) }}
      >
        {label}
      </button>
      {open && createPortal(
        <div
          ref={fly}
          className="overflow-menu-fly floating-menu"
          role="menu"
          aria-label={title}
          style={{ left: position.left, top: position.top, visibility: position.ready ? 'visible' : 'hidden' }}
          onClick={(event) => {
            if (!(event.target as HTMLElement).closest('button:not(:disabled)')) return
            close(true)
          }}
        >
          {children}
        </div>, document.body
      )}
    </div>
  )
}
