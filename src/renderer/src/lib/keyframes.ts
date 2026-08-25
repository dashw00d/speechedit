import { DEFAULT_CROP, DEFAULT_TRANSFORM, type Easing, type Keyframe, type Transform } from '../types'

function ease(kind: Easing, t: number): number {
  const x = Math.min(1, Math.max(0, t))
  if (kind === 'ease-in') return x * x
  if (kind === 'ease-out') return 1 - (1 - x) * (1 - x)
  if (kind === 'ease-in-out') return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2
  return x
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function mixTransform(a: Transform, b: Partial<Transform>, t: number): Transform {
  const ac = a.crop ?? DEFAULT_CROP
  const bc = b.crop ?? ac
  return {
    x: mix(a.x, b.x ?? a.x, t),
    y: mix(a.y, b.y ?? a.y, t),
    scale: mix(a.scale, b.scale ?? a.scale, t),
    rotation: mix(a.rotation, b.rotation ?? a.rotation, t),
    opacity: mix(a.opacity, b.opacity ?? a.opacity, t),
    crop: {
      x: mix(ac.x, bc.x, t),
      y: mix(ac.y, bc.y, t),
      w: mix(ac.w, bc.w, t),
      h: mix(ac.h, bc.h, t)
    }
  }
}

export function sampleTransform(
  base: Transform,
  keyframes: Keyframe[],
  local01: number
): Transform {
  if (!keyframes.length) return base
  const sorted = [...keyframes].sort((a, b) => a.time - b.time)
  let current = { ...DEFAULT_TRANSFORM, ...base }
  if (local01 <= sorted[0].time) return mixTransform(current, sorted[0].transform, 1)
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[i]
    if (local01 <= next.time) {
      const prevT = i === 0 ? 0 : sorted[i - 1].time
      const span = Math.max(1e-6, next.time - prevT)
      const t = ease(next.easing, (local01 - prevT) / span)
      return mixTransform(current, next.transform, t)
    }
    current = mixTransform(current, next.transform, 1)
  }
  return current
}

export function cssTransform(t: Transform): string {
  return `translate(${t.x}px, ${t.y}px) scale(${t.scale}) rotate(${t.rotation}deg)`
}

/** Matches FFmpeg afade/fade enable thresholds in exportGraph.ts. */
export const FADE_EPS = 0.02

export function fadeGain(local: number, duration: number, fadeIn: number, fadeOut: number): number {
  let g = 1
  if (fadeIn > FADE_EPS && local < fadeIn) g = Math.min(g, local / fadeIn)
  if (fadeOut > FADE_EPS && local > duration - fadeOut) g = Math.min(g, (duration - local) / fadeOut)
  return Math.max(0, Math.min(1, g))
}
