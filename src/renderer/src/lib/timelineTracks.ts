import type { Track, TrackType } from '../types'

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

export function findRevealableStackTrack(tracks: Track[], trackType: Extract<TrackType, 'overlay' | 'caption'>): Track | undefined {
  return tracks.find((t) => t.type === trackType && t.clips.length === 0 && t.hidden)
}
