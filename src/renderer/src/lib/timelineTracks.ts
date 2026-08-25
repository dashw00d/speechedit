import type { Project, Track, TrackType } from '../types'

export function isStackTrack(track: Pick<Track, 'type'>): boolean {
  return track.type === 'overlay' || track.type === 'caption'
}

/** Hide empty overlay/caption stacks so V2/V3 stay collapsed until they have clips. */
export function autoHideEmptyStackTrack(track: Track): Track {
  if (isStackTrack(track) && track.clips.length === 0) {
    return { ...track, hidden: true }
  }
  return track
}

export function revealStackTrack(track: Track): Track {
  return { ...track, hidden: false }
}

/** Strip V1/A2 prefixes so the lane reads Captions / Overlay / Picture / Voice. */
export function trackLaneName(track: Pick<Track, 'name'>): string {
  return track.name.replace(/^[VA]\d+\s+/, '') || track.name
}

export function findRevealableStackTrack(tracks: Track[], trackType: Extract<TrackType, 'overlay' | 'caption'>): Track | undefined {
  return tracks.find((t) => t.type === trackType && t.clips.length === 0 && t.hidden)
}

/** Solo one lane: mute the others. Voice stays if Picture or Voice is soloed. */
export function withSoloApplied(project: Project): Project {
  const anySolo = project.tracks.some((track) => track.solo)
  if (!anySolo) return project
  const keepVoice = project.tracks.some(
    (track) => track.solo && (track.id === 'v1' || track.id === 'a1' || track.type === 'video')
  )
  return {
    ...project,
    audioMaster: {
      ...project.audioMaster,
      muted: project.audioMaster.muted || !keepVoice
    },
    tracks: project.tracks.map((track) => ({
      ...track,
      muted: track.solo ? track.muted : true
    }))
  }
}
