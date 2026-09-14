import { mergeSharedProjects, prepareSharedProject } from '../../../shared/collaboration'
import type { ReviewRoom } from '../../../shared/review'
import type { Project } from '../types'
import { useEditor } from '../store'
import { reviewRequest, type ReviewBinding } from './reviewApi'
import { readSharedState, writeSharedState, mountSharedProject } from './sharedSession'
import { uploadSharedMedia } from './sharedMediaUpload'
import { keepRecordingOriginal } from './recordingClient'

export const OWNER_EDITS_APPLIED = 'speechedit:owner-edits-applied'
const applying = new Set<string>()
// A second workspace tab must not adopt a newer baseline behind its stale draft.
// Only this tab's own successful pull/push advances its merge ancestor.
const baselines = new Map<string, Project>()
async function ownerBase(id: string): Promise<Project | undefined> {
  if (!baselines.has(id)) {
    const stored = await readSharedState<Project>(`owner-base:${id}`)
    if (stored) baselines.set(id, stored)
  }
  return baselines.get(id)
}
async function rememberOwnerBase(id: string, project: Project): Promise<void> {
  await writeSharedState(`owner-base:${id}`, project)
  baselines.set(id, project)
}

/** One explicit, undoable import command for both the editor and Share sheet. */
export async function bringSharedEdits(binding: ReviewBinding): Promise<ReviewRoom> {
  if (applying.has(binding.id)) throw new Error('Sharing is busy. Try bringing in edits again in a moment.')
  applying.add(binding.id)
  try {
    const original = useEditor.getState().project
    const latest = await reviewRequest<ReviewRoom>(`/${binding.id}`, binding.ownerKey)
    if (!latest.project) throw new Error('Editing access is no longer available.')
    const base = await ownerBase(binding.id)
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
    await rememberOwnerBase(binding.id, latest.project)
    window.dispatchEvent(new Event(OWNER_EDITS_APPLIED))
    return latest
  } finally { applying.delete(binding.id) }
}

export interface OwnerSyncStatus { pending: boolean; message: string }
const same = (a: Project, b: Project) => JSON.stringify(a) === JSON.stringify(b)

/** Push local edits without silently pulling over the owner's workspace or Undo history.
 * A changed server baseline requires the existing explicit, three-way pull first.
 * The room lock also prevents the Share sheet's pull racing a background push.
 */
export async function syncOwnerEdits(binding: ReviewBinding, signal: AbortSignal, report: (status: OwnerSyncStatus) => void): Promise<void> {
  if (applying.has(binding.id)) return
  applying.add(binding.id)
  try {
    const room = await reviewRequest<ReviewRoom>(`/${binding.id}`, binding.ownerKey, 'GET', undefined, signal)
    if (!room.published) { report({ pending: false, message: 'Preparing editing link…' }); return }
    if (!room.project || room.mode !== 'edit') throw new Error('Editing access is no longer available. Manage this link in Share.')
    const base = await ownerBase(binding.id)
    if (!base) throw new Error('This browser cannot safely combine these edits. Open Share, then Open full editor to download an edit copy.')
    signal.throwIfAborted()
    const editor = useEditor.getState(), current = editor.project
    if (current.id !== binding.projectId) return
    if (editor.analyzing) { report({ pending: false, message: 'Changes will be shared when media preparation finishes.' }); return }
    const local = prepareSharedProject(current)
    if (!same(base, room.project)) {
      report({ pending: true, message: same(base, local)
        ? 'Your collaborator saved changes. Bring them into this project.'
        : 'Your changes are not shared yet. Bring in your collaborator’s changes first.' })
      return
    }
    if (same(local, base)) { report({ pending: false, message: 'Your changes are shared.' }); return }
    report({ pending: false, message: 'Sharing your changes…' })
    await uploadSharedMedia(room, current, local, binding, signal, message => report({ pending: false, message }))
    signal.throwIfAborted()
    if (useEditor.getState().project.id !== binding.projectId) return
    // Compare-and-swap rejects a guest save during upload. Never retry over it.
    const saved = await reviewRequest<ReviewRoom>(`/${binding.id}/project`, binding.ownerKey, 'PUT', { revision: room.projectRevision, project: local, author: 'Owner' }, signal)
    await rememberOwnerBase(binding.id, saved.project!)
    // Preserve the normal workspace's local save status, originals and Undo stack.
    report({ pending: false, message: same(prepareSharedProject(useEditor.getState().project), local)
      ? 'Your changes are shared.' : 'Sharing your latest changes…' })
  } finally { applying.delete(binding.id) }
}
