import type { Project } from '../types'
import type { ReviewRoom } from '../../../shared/review'
import { reviewRequest, uploadReviewPreview, type ReviewBinding } from './reviewApi'
import { encodeReviewProxy } from './reviewProxy'
import { recordingPreview } from './recordingClient'

/** Upload missing media before publishing edits, for both owner and guest. */
export async function uploadSharedMedia(room: ReviewRoom, current: Project, local: Project, binding: ReviewBinding, signal: AbortSignal, report: (message: string, error?: string) => void): Promise<void> {
  for (const asset of Object.values(current.assets)) {
    if (room.media[asset.id]) continue
    room = await reviewRequest<ReviewRoom>(`/${binding.id}/assets`, binding.ownerKey, 'POST', { asset: local.assets[asset.id] }, signal)
    if (room.media[asset.id]) continue
    report(`Compressing ${asset.name}…`)
    let encodingMode = 'fast encoder'
    const blob = await recordingPreview(asset, signal) || await encodeReviewProxy(asset, signal, ratio => report(`Compressing ${asset.name} · ${Math.round(ratio * 100)}% · ${encodingMode}`), status => { encodingMode = status.mode === 'cached' ? 'saved preview' : status.mode === 'playback' ? 'playback speed' : `${status.mode} encoder`; report(`${asset.name} · ${encodingMode}`, status.mode === 'playback' ? status.detail : undefined) })
    report(`Uploading ${asset.name}…`)
    await uploadReviewPreview({ id: binding.id, ownerKey: binding.ownerKey, reviewerKey: binding.ownerKey, projectId: current.id }, asset.id, blob, signal)
  }
}
