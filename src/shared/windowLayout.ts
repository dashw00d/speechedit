/** Electron chrome that still fits a 1280×720 laptop after the OS taskbar and title bar. */

export const WINDOW_MIN_WIDTH = 960
export const WINDOW_MIN_HEIGHT = 600

export const WORKSPACE_PANES = ['preview', 'review', 'script', 'timeline'] as const
export type WorkspacePane = (typeof WORKSPACE_PANES)[number]

export const WORKSPACE_PANE_KEYS: Record<'1' | '2' | '3' | '4', WorkspacePane> = {
  '1': 'preview',
  '2': 'review',
  '3': 'script',
  '4': 'timeline'
}

export function windowFitsWorkArea(workWidth: number, workHeight: number): boolean {
  return workWidth >= WINDOW_MIN_WIDTH && workHeight >= WINDOW_MIN_HEIGHT
}

export function isWorkspacePane(value: unknown): value is WorkspacePane {
  return WORKSPACE_PANES.includes(value as WorkspacePane)
}

/** Alt+1…4 switch Preview / Review / Script / Timeline when a pane is collapsed. */
export function workspacePaneFromHotkey(event: { key: string; code: string; altKey: boolean }): WorkspacePane | null {
  if (!event.altKey) return null
  const digit = event.code.startsWith('Digit') ? event.code.slice(5) : event.key
  return WORKSPACE_PANE_KEYS[digit as '1' | '2' | '3' | '4'] ?? null
}
