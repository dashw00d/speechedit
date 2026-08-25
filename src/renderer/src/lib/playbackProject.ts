import { applyCommand } from './commands'
import { safeEditCandidates } from './firstEdit'
import type { Project } from '../types'
import { withSoloApplied } from './timelineTracks'

export function hasPendingSafeCuts(project: Project): boolean {
  return safeEditCandidates(project).length > 0
}

/** Virtual apply of safe cuts for monitor playback — does not mutate the reel. */
export function projectForPlayback(project: Project, previewSafeCuts: boolean): Project {
  const next =
    previewSafeCuts && hasPendingSafeCuts(project)
      ? applyCommand(project, { type: 'applySafeSuggestions' })
      : project
  return withSoloApplied(next)
}
