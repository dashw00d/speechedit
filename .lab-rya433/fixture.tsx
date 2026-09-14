import React from 'react'
import {createRoot} from 'react-dom/client'
import {RecordReplacementSheet} from '../src/renderer/src/components/RecordReplacementSheet'
import '../src/renderer/src/styles.css'
import {applyTheme} from '../src/renderer/src/lib/theme'
applyTheme()
window.uses = 0
createRoot(document.getElementById('root')!).render(<RecordReplacementSheet words="Keep these words" duration={1.5} onClose={() => {window.closedSheet = true}} onUse={async () => {window.uses++}} />)
