import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { resolveContextMenu, type ContextMenuSpec } from '../lib/contextMenuSpecs'
import { isTypingTarget } from '../lib/selectionSurface'

export interface ContextMenuState {
  x: number
  y: number
  spec: ContextMenuSpec
}

export function ContextMenuHost({
  menu,
  onClose
}: {
  menu: ContextMenuState | null
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!menu || !panelRef.current) {
      setOffset({ x: 0, y: 0 })
      return
    }
    const rect = panelRef.current.getBoundingClientRect()
    let dx = 0
    let dy = 0
    if (menu.x + rect.width > window.innerWidth - 8) dx = window.innerWidth - 8 - (menu.x + rect.width)
    if (menu.y + rect.height > window.innerHeight - 8) dy = window.innerHeight - 8 - (menu.y + rect.height)
    setOffset({ x: dx, y: dy })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menu, onClose])

  if (!menu) return null

  return (
    <>
      <div className="context-menu-backdrop" onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div
        ref={panelRef}
        className="context-menu"
        style={{ left: menu.x + offset.x, top: menu.y + offset.y }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {menu.spec.title && <div className="context-menu-title">{menu.spec.title}</div>}
        <ul className="context-menu-list">
          {menu.spec.items.map((item) =>
            item.separator ? (
              <li key={item.id} className="context-menu-sep" aria-hidden />
            ) : (
              <li key={item.id}>
                <button
                  type="button"
                  className="context-menu-item"
                  disabled={item.disabled}
                  title={item.hint}
                  onClick={() => {
                    item.run?.()
                    onClose()
                  }}
                >
                  <span className="context-menu-label">{item.label}</span>
                  {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
                </button>
              </li>
            )
          )}
        </ul>
      </div>
    </>
  )
}

export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (isTypingTarget(e.target)) return
      const spec = resolveContextMenu(e.target)
      if (!spec?.items.length) return
      e.preventDefault()
      e.stopPropagation()
      setMenu({ x: e.clientX, y: e.clientY, spec })
    }
    document.addEventListener('contextmenu', onContextMenu, true)
    return () => document.removeEventListener('contextmenu', onContextMenu, true)
  }, [])

  return { menu, closeMenu: () => setMenu(null) }
}
