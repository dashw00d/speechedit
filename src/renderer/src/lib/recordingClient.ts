import type { Asset } from '../types'
import type { CapturedAudio } from './recording'
import { registerBrowserMedia, browserMediaKeyForPath, browserMediaForPath } from './browserMediaStore'
import { host, isElectron } from '../host'
import { uid } from './time'

async function localAsset(blob: Blob, duration: number, id = uid('recording')): Promise<Asset> {
  const name = `Re-recorded voice.${blob.type === 'audio/mpeg' ? 'mp3' : 'wav'}`
  if (isElectron && host.storeRecording) return { id, name, kind: 'audio', path: await host.storeRecording(await blob.arrayBuffer()), duration, waveform: [], isRecording: true }
  const path = await registerBrowserMedia(new File([blob], name, { type: blob.type }))
  return { id, name, kind: 'audio', path, browserMediaKey: browserMediaKeyForPath(path), duration, waveform: [], isRecording: true }
}
export async function uploadRecording(audio: CapturedAudio, signal: AbortSignal, room?: { id: string; key: string }): Promise<Asset> {
  if (isElectron && !room) return localAsset(audio.blob, audio.duration)
  const response = await fetch(room ? `/api/reviews/${room.id}/recordings` : '/api/recordings', { method: 'POST', signal, headers: { 'Content-Type': 'audio/wav', 'X-Recording-Duration': String(audio.duration), ...(room ? { Authorization: `Bearer ${room.key}` } : {}) }, body: audio.blob })
  if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Could not save the recording. Retry this take.') }
  if (room) {
    const { asset } = await response.json() as { asset: Asset }
    return { ...asset, path: `${location.origin}/api/reviews/${room.id}/media/${asset.id}`, proxyOnly: false }
  }
  return localAsset(await response.blob(), audio.duration)
}
export async function keepRecordingOriginal(asset: Asset, roomId: string, key: string): Promise<Asset> {
  const response = await fetch(`/api/reviews/${roomId}/media/${asset.id}`, { headers: { Authorization: `Bearer ${key}` } })
  if (!response.ok) throw new Error('The replacement recording could not download. Please retry.')
  return localAsset(await response.blob(), asset.duration, asset.id)
}
/** Authored MP3 takes are already compact and should survive sharing without another encode. */
export async function recordingPreview(asset: Asset, signal: AbortSignal): Promise<Blob | undefined> {
  if (!asset.isRecording) return
  const local = browserMediaForPath(asset.path)
  if (local?.type === 'audio/mpeg') return local
  if (!local && /^https?:/.test(asset.path)) {
    const response = await fetch(asset.path, { signal })
    if (!response.ok) throw new Error(`Could not read ${asset.name}. Relink the recording and retry.`)
    const blob = await response.blob()
    if (blob.type === 'audio/mpeg') return blob
  }
}
