import { applyCommand } from './commands'
import type { Project } from '../types'

export function hasPendingSafeCuts(project: Project): boolean {
  return project.suggestions.some(
    (s) => s.safe && !s.applied && !s.blockedBy && (s.action === 'cut' || s.action === 'normalize')
  )
}

/** Virtual apply of safe cuts for monitor playback — does not mutate the reel. */
export function projectForPlayback(project: Project, previewSafeCuts: boolean): Project {
  if (!previewSafeCuts || !hasPendingSafeCuts(project)) return project
  return applyCommand(project, { type: 'applySafeSuggestions' })
}
