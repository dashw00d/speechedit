import { useDialog } from '../useDialog'
import { useEffect, useState } from 'react'
import { formatAppIdentity, loadAppIdentity } from '../lib/appIdentity'
import { PREFERENCES_EVENT } from '../lib/theme'
import { ThemePreferences } from './ThemePreferences'

export function PreferencesSheet() {
  const [open, setOpen] = useState(false)
  const [buildId, setBuildId] = useState('')

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(PREFERENCES_EVENT, onOpen)
    return () => window.removeEventListener(PREFERENCES_EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    void loadAppIdentity().then((identity) => setBuildId(formatAppIdentity(identity)))
  }, [open])

  const dialogRef = useDialog(open, () => setOpen(false))

  if (!open) return null

  return (
    <div className="confirm-back" onMouseDown={() => setOpen(false)}>
      <div
        className="confirm-sheet prefs-sheet"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prefs-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p id="prefs-title" className="confirm-title">
          Preferences
        </p>
        <p className="confirm-copy">Appearance applies to the editor chrome. Colors already saved on a reel stay put.</p>
        <ThemePreferences />
        {buildId ? <p className="help">{buildId}</p> : null}
        <div className="confirm-actions">
          <button type="button" className="confirm-primary" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
