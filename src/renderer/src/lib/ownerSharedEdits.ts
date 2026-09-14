import { mergeSharedProjects, prepareSharedProject } from '../../../shared/collaboration'
import type { ReviewRoom } from '../../../shared/review'
import type { Project } from '../types'
import { useEditor } from '../store'
import { reviewRequest, type ReviewBinding } from './reviewApi'
import { readSharedState, writeSharedState, mountSharedProject } from './sharedSession'
import { keepRecordingOriginal } from './recordingClient'

export const OWNER_EDITS_APPLIED = 'speechedit:owner-edits-applied'
const applying = new Set<string>()

/** One explicit, undoable import command for both the editor and Share sheet. */
export async function bringSharedEdits(binding: ReviewBinding): Promise<ReviewRoom> {
  if (applying.has(binding.id)) throw new Error('Shared edits are already being brought in.')
  applying.add(binding.id)
  try {
    const original = useEditor.getState().project
    const latest = await reviewRequest<ReviewRoom>(`/${binding.id}`, binding.ownerKey)
    if (!latest.project) throw new Error('Editing access is no longer available.')
    const base = await readSharedState<Project>(`owner-base:${binding.id}`)
    if (!base) throw new Error('The original sharing baseline is missing in this browser. Open the shared editor and download its edit copy to recover it safely.')
    const current = useEditor.getState().project
    if (current !== original) throw new Error('Your project changed. Bring shared edits in again.')
    if (current.id !== binding.projectId) throw new Error('Open the original project before bringing in these edits.')
    const merged = mergeSharedProjects(base, prepareSharedProject(current), latest.project)
    if (merged.conflicts.length) throw new Error(`Local and remote edits overlap: ${merged.conflicts.slice(0, 4).join(', ')}. Open the shared editor to review and download those edits before replacing local work.`)
    const originals = { ...current, assets: { ...current.assets } }
    for (const asset of Object.values(merged.project.assets)) {
      if (asset.isRecording && !current.assets[asset.id]) originals.assets[asset.id] = await keepRecordingOriginal(asset, binding.id, binding.ownerKey)
    }
    if (useEditor.getState().project !== current) throw new Error('Your project changed while downloading recordings. Bring shared edits in again to use the latest version.')
    useEditor.getState().dispatch({ type: 'replaceProject', project: { ...mountSharedProject(merged.project, binding.id, originals), reviewDecisions: current.reviewDecisions } })
    await writeSharedState(`owner-base:${binding.id}`, latest.project)
    window.dispatchEvent(new Event(OWNER_EDITS_APPLIED))
    return latest
  } finally { applying.delete(binding.id) }
}
