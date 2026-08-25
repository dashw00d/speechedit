import { describe, expect, test } from 'bun:test'
import { hopNote, rolledPair, slippedClip } from './clipEdit'
import { DEFAULT_TRANSFORM, emptyClipFields, type Clip, type Project } from '../types'

function clip(partial: Partial<Clip> & Pick<Clip, 'id' | 'start' | 'duration' | 'inPoint' | 'outPoint'>): Clip {
  return {
    trackId: 'a2',
    transform: { ...DEFAULT_TRANSFORM },
    volume: 1,
    muted: false,
    speed: 1,
    ...emptyClipFields(),
    ...partial
  }
}

describe('clipEdit', () => {
  test('slip keeps program position and duration', () => {
    const next = slippedClip(clip({ id: 'a', start: 2, duration: 4, inPoint: 1, outPoint: 5 }), 0.5, 20)
    expect(next?.start).toBe(2)
    expect(next?.duration).toBe(4)
    expect(next?.inPoint).toBeCloseTo(1.5, 5)
    expect(next?.outPoint).toBeCloseTo(5.5, 5)
  })

  test('roll shared out-point shortens the neighbor', () => {
    const a = clip({ id: 'a', start: 0, duration: 4, inPoint: 0, outPoint: 4 })
    const b = clip({ id: 'b', start: 4, duration: 4, inPoint: 10, outPoint: 14 })
    const rolled = rolledPair(a, b, 'out', 5)
    expect(rolled?.clip.duration).toBeCloseTo(5, 5)
    expect(rolled?.neighbor?.start).toBeCloseTo(5, 5)
    expect(rolled?.neighbor?.duration).toBeCloseTo(3, 5)
    expect(rolled?.neighbor?.inPoint).toBeCloseTo(11, 5)
  })

  test('hopNote wraps around the reel', () => {
    const project = {
      tags: [
        { id: 'n1', start: 2, end: 3, kind: 'note', label: 'A' },
        { id: 'n2', start: 8, end: 9, kind: 'note', label: 'B' }
      ]
    } as Project
    expect(hopNote(project, 0, 1)?.label).toBe('A')
    expect(hopNote(project, 2.2, 1)?.label).toBe('B')
    expect(hopNote(project, 8.2, 1)?.label).toBe('A')
    expect(hopNote(project, 8.2, -1)?.label).toBe('A')
  })
})
