import { describe, expect, test } from 'bun:test'
import {
  asrChunkWindows,
  asrChunksComplete,
  mergeAsrChunks,
  pendingAsrChunks,
  shiftAsrCues,
  wantsChunkedAsr
} from '../../../shared/asrChunks'

describe('chunked ASR policy', () => {
  test('short recordings stay one pass; hour-scale splits overlapping windows', () => {
    expect(wantsChunkedAsr(12)).toBe(false)
    expect(wantsChunkedAsr(179)).toBe(false)
    expect(wantsChunkedAsr(180)).toBe(true)
    expect(wantsChunkedAsr(3600)).toBe(true)
    expect(asrChunkWindows(12)).toEqual([{ start: 0, end: 12 }])
    const hour = asrChunkWindows(3600)
    expect(hour[0]).toEqual({ start: 0, end: 90 })
    expect(hour[1]?.start).toBe(88)
    expect(hour[1]?.end).toBe(178)
    expect(hour.at(-1)?.end).toBe(3600)
    expect(hour.length).toBeGreaterThan(40)
  })

  test('merge keeps the overlap half from each neighbor and shifts local times', () => {
    expect(shiftAsrCues([{ text: 'hi', start: 0.2, end: 0.5 }], 90)).toEqual([
      { text: 'hi', start: 90.2, end: 90.5 }
    ])
    const merged = mergeAsrChunks([
      {
        start: 0,
        end: 90,
        cues: [
          { text: 'early', start: 1, end: 1.2 },
          { text: 'edge', start: 88.2, end: 88.8 }
        ]
      },
      {
        start: 88,
        end: 178,
        cues: [
          { text: 'edge', start: 88.2, end: 88.8 },
          { text: 'late', start: 100, end: 100.4 }
        ]
      }
    ])
    expect(merged.map((c) => c.text)).toEqual(['early', 'edge', 'late'])
    expect(pendingAsrChunks(
      [
        { start: 0, end: 90 },
        { start: 88, end: 178 }
      ],
      [{ start: 0, end: 90 }]
    )).toEqual([{ start: 88, end: 178 }])
    expect(
      asrChunksComplete(
        [
          { start: 0, end: 90 },
          { start: 88, end: 178 }
        ],
        [
          { start: 0, end: 90 },
          { start: 88, end: 178 }
        ]
      )
    ).toBe(true)
  })
})
