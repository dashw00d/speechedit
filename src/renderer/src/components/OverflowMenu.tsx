import { useEffect, useRef, useState, type ReactNode } from 'react'

export function OverflowMenu({
  label = 'More',
  title = 'More actions for this moment',
  tone = 'bar',
  place = 'above',
  children
}: {
  label?: ReactNode
  title?: string
  tone?: 'bar' | 'chip' | 'track'
  place?: 'above' | 'below'
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="overflow-menu" ref={root}>
      <button
        type="button"
        className={tone === 'chip' ? 'chip' : tone === 'track' ? 'track-flag' : 'review-btn'}
        aria-expanded={open}
        aria-haspopup="menu"
        title={title}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open && (
        <div
          className="overflow-menu-fly"
          data-place={place}
          role="menu"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('input, textarea, select')) return
            setOpen(false)
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
