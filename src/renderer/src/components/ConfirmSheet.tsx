import { useDialog } from '../useDialog'
import { useEffect, useState } from 'react'
import { onLoseWorkRequest, resolveLoseWork, type LoseWorkRequest } from '../lib/loseWork'

export function ConfirmSheet() {
  const [request, setRequest] = useState<LoseWorkRequest | null>(null)

  useEffect(() => onLoseWorkRequest(setRequest), [])

  const dialogRef = useDialog(Boolean(request), () => resolveLoseWork('cancel'))

  if (!request) return null

  return (
    <div className="confirm-back" onMouseDown={() => resolveLoseWork('cancel')}>
      <div
        className="confirm-sheet"
        ref={dialogRef}
        tabIndex={-1}
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
