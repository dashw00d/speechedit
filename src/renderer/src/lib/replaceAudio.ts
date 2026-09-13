import { DEFAULT_TRANSFORM, type Asset, type Clip, type Project } from '../types'
import { programLengthOf, sourceToProgramOf } from './resolver'
import { uid } from './time'

export function recordingSlot(project: Project, start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > project.sourceDuration || end <= start) throw new Error('Select words with an audio range to re-record.')
  const programStart = sourceToProgramOf(project, start), programEnd = sourceToProgramOf(project, end)
  const duration = programEnd - programStart
  if (duration < 0.1 || duration > 120) throw new Error('Select a passage with 0.1–120 seconds of remaining audio.')
  return { start: programStart, end: programEnd, duration }
}

/** Compose an ordinary audio clip with voice replacement mixing; video, captions and music stay intact. */
export function replaceAudioRange(project: Project, start: number, end: number, asset: Asset): Project {
  const slot = recordingSlot(project, start, end)
  if (asset.kind !== 'audio' || Math.abs(asset.duration - slot.duration) > 0.02) throw new Error('This passage’s timing changed. Re-record it against the current edit.')
  const trackId = 'voice_replacements'
  const overlaps = (c: Clip) => c.replaceVoice && c.start < slot.end && c.start + c.duration > slot.start
  if (project.tracks.some(t => t.locked && (t.id === 'a1' || t.id === trackId || t.clips.some(overlaps)))) throw new Error('Unlock the voice track before replacing audio.')
  const clip: Clip = { id: uid('clip'), trackId, assetId: asset.id, start: slot.start, duration: slot.duration, inPoint: 0, outPoint: slot.duration, transform: { ...DEFAULT_TRANSFORM }, volume: 1, muted: false, speed: 1, replaceVoice: true, fadeIn: 0, fadeOut: 0, keyframes: [], text: asset.name }
  const track = project.tracks.find(t => t.id === trackId) || { id: trackId, name: 'Voice replacements', type: 'audio' as const, locked: false, muted: false, hidden: false, clips: [] }
  // Re-recording an existing replacement retains only its material outside this slot.
  const trim = (clips: Clip[]) => clips.flatMap(c => {
    const cEnd = c.start + c.duration
    if (!overlaps(c)) return [c]
    const kept: Clip[] = []
    if (c.start < slot.start) kept.push({ ...c, id: uid('clip'), duration: slot.start - c.start, outPoint: c.inPoint + (slot.start - c.start) * c.speed, fadeOut: 0 })
    if (cEnd > slot.end) kept.push({ ...c, id: uid('clip'), start: slot.end, duration: cEnd - slot.end, inPoint: c.inPoint + (slot.end - c.start) * c.speed, fadeIn: 0 })
    return kept
  })
  const next = { ...project, assets: { ...project.assets, [asset.id]: asset }, tracks: [...project.tracks.filter(t => t.id !== trackId).map(t => t.clips.some(overlaps) ? { ...t, clips: trim(t.clips) } : t), { ...track, clips: [...trim(track.clips), clip].sort((a, b) => a.start - b.start) }], updatedAt: Date.now() }
  if (Math.abs(programLengthOf(next) - programLengthOf(project)) > 0.001) throw new Error('A transition crosses this slot. Remove that transition before re-recording this passage.')
  return next
}
