import {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_TRANSFORM,
  emptyClipFields,
  type Clip,
  type Project,
  type Word
} from '../types'
import { sourceToProgramOf } from './resolver'
import { uid } from './time'

export function wordsToCaptions(project: Project): Clip[] {
  const live = project.transcript.words.filter((w) => !w.deleted)
  const groups: Word[][] = []
  let bucket: Word[] = []

  for (const word of live) {
    const prev = bucket[bucket.length - 1]
    const gap = prev ? word.start - prev.end : 0
    const punct = prev?.text.match(/[.!?]$/)
    if (bucket.length && (gap > 0.7 || punct || bucket.length >= 10)) {
      groups.push(bucket)
      bucket = [word]
    } else {
      bucket.push(word)
    }
  }
  if (bucket.length) groups.push(bucket)

  return groups.map((group) => {
    const start = sourceToProgramOf(project, group[0].start)
    const end = sourceToProgramOf(project, group[group.length - 1].end)
    return {
      id: uid('cap'),
      trackId: 'v3',
      start,
      duration: Math.max(0.8, end - start),
      inPoint: 0,
      outPoint: Math.max(0.8, end - start),
      transform: { ...DEFAULT_TRANSFORM },
      volume: 1,
      muted: false,
      speed: 1,
      text: group.map((w) => w.text).join(' '),
      style: { ...DEFAULT_CAPTION_STYLE },
      ...emptyClipFields()
    }
  })
}

export function withGeneratedCaptions(project: Project): Project {
  const clips = wordsToCaptions(project)
  return {
    ...project,
    updatedAt: Date.now(),
    tracks: project.tracks.map((track) =>
      track.type === 'caption' ? { ...track, clips } : track
    )
  }
}
