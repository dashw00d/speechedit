import { expect, test } from 'bun:test'
import { mediaPlaybackExhausted, syncMediaPlayback } from './mediaPlayback'

function player(duration: number) {
  let time = 0
  return {
    src: 'take.mp3', duration, ended: false, seeking: false, readyState: 4,
    paused: true, muted: false, volume: 1, playbackRate: 1, plays: 0, seeks: 0,
    get currentTime() { return time },
    set currentTime(value: number) { time = Math.min(value, duration); this.seeks++; this.seeking = true; this.ended = false },
    async play() { this.plays++; if (this.ended) time = 0; this.paused = false; this.ended = false },
    pause() { this.paused = true },
    advance(dt: number) { if (!this.paused) { time = Math.min(duration, time + dt); if (time === duration) { this.ended = true; this.paused = true } } }
  }
}

test('a short take plays once and contributes silence through the entire remaining replacement slot', () => {
  const audio = player(0.21)
  for (let frame = 0; frame < 120; frame++) {
    syncMediaPlayback(audio, frame / 60, true, 1, 1)
    audio.advance(1 / 60)
  }
  expect(audio.plays).toBe(1)
  expect(audio.seeks).toBe(0)
  expect(audio.paused).toBe(true)
  expect(audio.volume).toBe(0)
  expect(mediaPlaybackExhausted(audio)).toBe(true)
})

test('EOF never restarts when the program clock is slightly behind the decoder', () => {
  const audio = player(0.5)
  syncMediaPlayback(audio, 0, true, 1, 1)
  audio.advance(0.5)
  for (let frame = 0; frame < 60; frame++) syncMediaPlayback(audio, 0.49 + frame / 6000, true, 1, 1, 30, true)
  expect(audio.plays).toBe(1)
  expect(audio.seeks).toBe(0)
  expect(audio.volume).toBe(0)
  // An intentional replay seeks first, waits for the seek, then plays once.
  syncMediaPlayback(audio, 0, true, 1, 1)
  expect(audio.seeking).toBe(true)
  syncMediaPlayback(audio, 0, true, 1, 1)
  expect(audio.plays).toBe(1)
  audio.seeking = false
  syncMediaPlayback(audio, 0, true, 1, 1)
  expect(audio.plays).toBe(2)
  expect(audio.volume).toBe(1)
})

test('pending audio seeks are not retargeted and source changes clear EOF state', () => {
  const audio = player(1)
  syncMediaPlayback(audio, 0.4, true, 1, 1)
  for (let frame = 0; frame < 10; frame++) syncMediaPlayback(audio, 0.4 + frame / 100, true, 1, 1, 30, true)
  expect(audio.seeks).toBe(1)
  expect(audio.plays).toBe(0)
  audio.seeking = false
  syncMediaPlayback(audio, 0.5, true, 1, 1)
  audio.advance(1)
  syncMediaPlayback(audio, 1, true, 1, 1)
  audio.src = 'new-take.mp3'; audio.currentTime = 0; audio.seeking = false
  syncMediaPlayback(audio, 0, true, 1, 1)
  expect(audio.plays).toBe(2)
})
