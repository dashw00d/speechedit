import type { ReactNode, SVGProps } from 'react'

function Glyph({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden {...props}>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </g>
    </svg>
  )
}

export function IconSelectAll() {
  return (
    <Glyph>
      <rect x="1.5" y="3" width="9" height="9" rx="1.2" />
      <path d="M6.5 6.5H14v8.2H6.5z" />
    </Glyph>
  )
}

export function IconSolo() {
  return (
    <Glyph>
      <path d="M3.2 8.2v1.6a1.6 1.6 0 0 0 1.6 1.6h.4V8.2H4.8A1.6 1.6 0 0 0 3.2 6.6v1.6z" />
      <path d="M12.8 8.2V6.6a1.6 1.6 0 0 0-1.6-1.6h-.4v3.2h.4a1.6 1.6 0 0 0 1.6-1.6z" />
      <path d="M4.8 6.6a3.2 3.2 0 0 1 6.4 0" />
    </Glyph>
  )
}

export function IconMute() {
  return (
    <Glyph>
      <path d="M2.2 6.4h2.1L7.6 4.2v7.6L4.3 9.6H2.2z" />
      <path d="M10.2 6.2l3.4 3.4M13.6 6.2l-3.4 3.4" />
    </Glyph>
  )
}

export function IconHide() {
  return (
    <Glyph>
      <path d="M2 8c1.5-2.8 3.6-4.2 6-4.2S12.5 5.2 14 8c-1.5 2.8-3.6 4.2-6 4.2S3.5 10.8 2 8z" />
      <circle cx="8" cy="8" r="1.6" />
      <path d="M3 13.2L13 2.8" />
    </Glyph>
  )
}

export function IconLock() {
  return (
    <Glyph>
      <rect x="3.4" y="7.2" width="9.2" height="6.2" rx="1.2" />
      <path d="M5.4 7.2V5.4a2.6 2.6 0 0 1 5.2 0v1.8" />
    </Glyph>
  )
}

export function IconMore() {
  return (
    <Glyph>
      <circle cx="3.2" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12.8" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </Glyph>
  )
}
