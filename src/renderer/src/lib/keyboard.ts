import { isTypingTarget } from './selectionSurface'

type EditorKey = Pick<KeyboardEvent, 'key' | 'keyCode' | 'defaultPrevented' | 'isComposing' | 'metaKey' | 'ctrlKey'>
type KeyScope = { overlayOpen: boolean; editingText: boolean; nativeControl: boolean }

export function shouldIgnoreEditorShortcut(event: EditorKey, scope: KeyScope): boolean {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || scope.overlayOpen) return true
  if (scope.editingText) {
    const appCommand = (event.metaKey || event.ctrlKey) && ['s', 'k', 'j'].includes(event.key.toLowerCase())
    return !appCommand
  }
  return scope.nativeControl && [' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
}

/** Let dialogs, text editors, menus, and native controls own their keys. */
export function blocksEditorShortcut(event: KeyboardEvent): boolean {
  const target = event.target
  return shouldIgnoreEditorShortcut(event, {
    // Menus are mounted only while open.
    overlayOpen: Boolean(document.querySelector('[role="dialog"][aria-modal="true"], .overflow-menu-fly, .context-menu')),
    editingText: isTypingTarget(target),
    nativeControl: target instanceof Element && Boolean(target.closest('button, summary, a[href], [role="button"]'))
  })
}

export function shortcutLabel(keys: string): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return keys.replaceAll('⌘⇧', mac ? '⌘⇧' : 'Ctrl+Shift+').replaceAll('⌘', mac ? '⌘' : 'Ctrl+').replaceAll('⇧', mac ? '⇧' : 'Shift+')
}
