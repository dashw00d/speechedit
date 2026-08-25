import { describe, expect, test } from 'bun:test'
import { JobCancelled } from '../../../shared/mediaJob'
import {
  ANALYSIS_CACHE_VERSION,
  LOOK_LANE_LIMIT,
  WorkLane,
  loudnessDetectArgs,
  sceneDetectArgs,
  silenceDetectArgs,
  thumbPassArgs,
  thumbSeekArgs,
  thumbSeekTimes,
  wantsCheapScenes,
  wantsSeekThumbs,
  waveformLookArgs
} from '../../../shared/importLooks'

describe('import look policy', () => {
  test('WorkLane never runs more work than the limit', async () => {
    const lane = new WorkLane(LOOK_LANE_LIMIT)
    let peak = 0
    const started: number[] = []
    const jobs = [1, 2, 3, 4].map((id) =>
      lane.run(async () => {
        started.push(id)
        peak = Math.max(peak, lane.active)
        await Bun.sleep(20)
        return id
      })
    )
    expect(lane.waiting).toBeGreaterThan(0)
    expect(await Promise.all(jobs)).toEqual([1, 2, 3, 4])
    expect(peak).toBe(LOOK_LANE_LIMIT)
    expect(started.slice(0, 2)).toEqual([1, 2])
    expect(lane.active).toBe(0)
    expect(lane.waiting).toBe(0)
  })

  test('WorkLane throws cancelled work waiting in the queue', async () => {
    const lane = new WorkLane(1)
    const abort = new AbortController()
    const first = lane.run(() => Bun.sleep(30))
    const queued = lane.run(() => Promise.resolve('ran'), abort.signal, 'import')
    abort.abort()
    await expect(queued).rejects.toBeInstanceOf(JobCancelled)
    await first
    expect(lane.active).toBe(0)
  })

  test('short SD keeps full scene detect; long or HD files cheapen it', () => {
    expect(wantsCheapScenes({ duration: 12, width: 320, height: 240 })).toBe(false)
    expect(wantsCheapScenes({ duration: 8, width: 640, height: 360 })).toBe(false)
    expect(wantsCheapScenes({ duration: 12, width: 1920, height: 1080 })).toBe(true)
    expect(wantsCheapScenes({ duration: 120, width: 320, height: 240 })).toBe(true)
    const cheap = sceneDetectArgs('/tmp/long.mp4', { duration: 3600, width: 1920, height: 1080 }).join(' ')
    expect(cheap).toContain('-an')
    expect(cheap).toContain('fps=5')
    expect(cheap).toContain("scale='min(320,iw)':-2")
    const full = sceneDetectArgs('/tmp/short.mp4', { duration: 12, width: 320, height: 240 }).join(' ')
    expect(full).toContain('-an')
    expect(full).not.toContain('fps=5')
  })

  test('audio looks disable video, thumbs disable audio', () => {
    expect(waveformLookArgs('/tmp/a.mp4')).toContain('-vn')
    expect(silenceDetectArgs('/tmp/a.mp4').join(' ')).toMatch(/-i \/tmp\/a\.mp4 -vn/)
    expect(loudnessDetectArgs('/tmp/a.mp4')).toContain('-vn')
    expect(thumbPassArgs('/tmp/a.mp4', 't%03d.jpg', 0.5, 20)).toContain('-an')
    expect(thumbSeekArgs('/tmp/a.mp4', 't.jpg', 90)).toContain('-ss')
    expect(thumbSeekArgs('/tmp/a.mp4', 't.jpg', 90)).toContain('-an')
  })

  test('long recordings seek a handful of thumbs instead of decoding every frame', () => {
    expect(wantsSeekThumbs(12, 20)).toBe(false)
    expect(wantsSeekThumbs(90, 20)).toBe(true)
    expect(wantsSeekThumbs(3600, 20)).toBe(true)
    expect(thumbSeekTimes(3600, 20)[0]).toBe(90)
    expect(thumbSeekTimes(3600, 20).at(-1)).toBe(3510)
    expect(ANALYSIS_CACHE_VERSION).toBe(2)
  })
})
