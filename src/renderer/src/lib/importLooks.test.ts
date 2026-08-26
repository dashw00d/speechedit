import { describe, expect, test } from 'bun:test'
import { JobCancelled } from '../../../shared/mediaJob'
import {
  ANALYSIS_CACHE_VERSION,
  LOOK_LANE_LIMIT,
  WorkLane,
  audioLookArgs,
  audioLookFilters,
  loudnessDetectArgs,
  parseLoudnessLog,
  parseSilenceLog,
  sceneDetectArgs,
  silenceDetectArgs,
  wantsCheapAudioLooks,
  thumbPassArgs,
  thumbSeekArgs,
  thumbSeekTimes,
  wantsCheapScenes,
  wantsSeekPeaks,
  wantsSeekThumbs,
  waveformLookArgs,
  waveformStrategy,
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

  test('waveforms use one bounded audio decode instead of thousands of seeks', () => {
    expect(wantsSeekPeaks(12)).toBe(false)
    expect(wantsSeekPeaks(89)).toBe(false)
    expect(wantsSeekPeaks(90)).toBe(false)
    expect(wantsSeekPeaks(3600)).toBe(false)
    expect(waveformStrategy(12)).toBe('decode')
    expect(waveformStrategy(3600)).toBe('decode')
    const args = waveformLookArgs('/tmp/a.mp4')
    expect(args.filter((arg) => arg === '-i')).toHaveLength(1)
    expect(args).not.toContain('-ss')
    expect(args).toContain('1000')
  })

  test('long recordings share one cheap audio look for silence and loudness', () => {
    expect(wantsCheapAudioLooks(12)).toBe(false)
    expect(wantsCheapAudioLooks(89)).toBe(false)
    expect(wantsCheapAudioLooks(90)).toBe(true)
    expect(wantsCheapAudioLooks(3600)).toBe(true)
    expect(audioLookFilters({ duration: 12 })).toBe('silencedetect=n=-30dB:d=0.35,ebur128=peak=true')
    expect(audioLookFilters({ duration: 12 })).not.toContain('aresample')
    expect(audioLookFilters({ duration: 3600 })).toContain('aresample=8000')
    expect(audioLookFilters({ duration: 3600 })).toContain('silencedetect=')
    expect(audioLookFilters({ duration: 3600 })).toContain('ebur128=peak=true')
    const combined = audioLookArgs('/tmp/long.mp4', { duration: 3600 }).join(' ')
    expect(combined).toMatch(/-i \/tmp\/long\.mp4 -vn/)
    expect(combined).toContain('aresample=8000')
    expect(combined).toContain('silencedetect=')
    expect(combined).toContain('ebur128=peak=true')
    expect(silenceDetectArgs('/tmp/long.mp4', '-30dB', 0.35, 3600).join(' ')).toContain('aresample=8000')
    expect(silenceDetectArgs('/tmp/long.mp4', '-30dB', 0.35, 3600).join(' ')).not.toContain('ebur128')
    expect(loudnessDetectArgs('/tmp/long.mp4', 3600).join(' ')).toContain('aresample=8000')
    expect(loudnessDetectArgs('/tmp/long.mp4', 3600).join(' ')).not.toContain('silencedetect')
    expect(silenceDetectArgs('/tmp/a.mp4').join(' ')).not.toContain('aresample')
    expect(loudnessDetectArgs('/tmp/a.mp4').join(' ')).not.toContain('aresample')
    expect(
      parseSilenceLog('[silencedetect @ x] silence_start: 2.00\n[silencedetect @ x] silence_end: 5.50')
    ).toEqual([{ start: 2, end: 5.5 }])
    const [loud] = parseLoudnessLog('t: 1.200  TARGET:-23 LUFS    I: -12.0 LUFS')
    expect(loud?.end).toBe(1.2)
    expect(loud?.lufs).toBe(-12)
    expect(loud?.start).toBeCloseTo(0.8, 5)
    expect(parseLoudnessLog('t: 1.200  TARGET:-23 LUFS    I: -20.0 LUFS')).toEqual([])
  })
})
