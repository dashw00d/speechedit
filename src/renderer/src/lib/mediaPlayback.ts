import { frameDuration, shouldSetMediaTime } from './seek'

type Media = Pick<HTMLMediaElement, 'src' | 'currentTime' | 'duration' | 'ended' | 'seeking' | 'readyState' | 'paused' | 'muted' | 'volume' | 'playbackRate' | 'play' | 'pause'>
const positions = new WeakMap<Media, { src: string; requested: number; exhausted: boolean }>()

export function mediaPlaybackExhausted(media: Media | null | undefined): boolean {
  if (!media) return false
  const position = positions.get(media)
  return position?.src === media.src && position.exhausted
}

/** An exhausted file contributes silence until a deliberate rewind or source change. */
export function syncMediaPlayback(media: Media, desired: number, playing: boolean, rate: number, gain: number, fps = 30, hard = false) {
  if (!media.src) return
  const previous = positions.get(media)
  const sameSource = previous?.src === media.src
  const rewound = sameSource ? desired < previous.requested - 0.000001 : desired < media.currentTime - frameDuration(fps)
  let exhausted = sameSource && previous.exhausted && !rewound
  if (media.ended && !rewound) exhausted = true
  if (Number.isFinite(media.duration) && desired >= media.duration) exhausted = true
  positions.set(media, { src: media.src, requested: desired, exhausted })
  media.muted = false
  media.volume = exhausted ? 0 : Math.min(1, Math.max(0, gain))
  media.playbackRate = rate
  if (exhausted) { if (!media.paused) media.pause(); return }
  if (!playing && !media.paused) media.pause()
  if (media.seeking || media.readyState === 0) return
  if ((rewound && media.ended) || shouldSetMediaTime({ current: media.currentTime, desired, seeking: media.seeking, readyState: media.readyState, playing, hard, fps })) {
    media.currentTime = desired
    // Wait for the asynchronous seek before playing an ended element. play()
    // at EOF can implicitly rewind to zero and repeat the last audible fragment.
    return
  }
  if (playing && media.paused && !media.ended) void media.play().catch(() => undefined)
}
