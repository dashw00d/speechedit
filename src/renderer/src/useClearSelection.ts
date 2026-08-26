import { useEffect } from 'react'
import { isTypingTarget, keepsSelection } from './lib/selectionSurface'
import { useEditor } from './store'

export function hasActiveSelection(): boolean {
  const editor = useEditor.getState()
  return Boolean(
    editor.selectedWordIds.length ||
      editor.selectedSceneId ||
      editor.selectedSuggestionId ||
      editor.selectedGap ||
      editor.selectedClipId
  )
}

export function useClearSelection() {
  const clearSelection = useEditor((s) => s.clearSelection)

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (keepsSelection(e.target)) return
      if (!hasActiveSelection()) return
      clearSelection()
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const editor = useEditor.getState()
      if (editor.exporting || editor.analyzing) return
      if (editor.palette) {
        e.preventDefault()
        editor.setPalette(false)
        return
      }
      if (editor.reviewing) {
        e.preventDefault()
        editor.setReviewing(false)
        return
      }
      if (editor.tool === 'guard') {
        e.preventDefault()
        editor.setTool('select')
        return
      }
      if (!hasActiveSelection()) return
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      clearSelection()
    }

    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [clearSelection])
}
