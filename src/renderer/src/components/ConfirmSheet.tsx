import { useEffect, useRef, useState } from 'react'
import { onLoseWorkRequest, resolveLoseWork, type LoseWorkRequest } from '../lib/loseWork'

export function ConfirmSheet() {
  const [request, setRequest] = useState<LoseWorkRequest | null>(null)
  const saveRef = useRef<HTMLButtonElement>(null)

  useEffect(() => onLoseWorkRequest(setRequest), [])

  useEffect(() => {
    if (!request) return
    saveRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        resolveLoseWork('cancel')
      }
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        resolveLoseWork('save')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [request])

  if (!request) return null

  return (
    <div className="confirm-back" onMouseDown={() => resolveLoseWork('cancel')}>
      <div
        className="confirm-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lose-work-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p id="lose-work-title" className="confirm-title">
          Unsaved edits
        </p>
        <p className="confirm-copy">{request.message}</p>
        <div className="confirm-actions">
          <button type="button" className="chip" onClick={() => resolveLoseWork('cancel')}>
            Cancel
          </button>
          <button type="button" className="chip" onClick={() => resolveLoseWork('discard')}>
            Discard
          </button>
          <button
            ref={saveRef}
            type="button"
            className="chip confirm-primary"
            onClick={() => resolveLoseWork('save')}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
