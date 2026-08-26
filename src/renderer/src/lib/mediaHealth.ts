import { host } from '../host'
import { mediaToolUnavailableMessage, type MediaToolsHealth } from '../../../shared/mediaTools'

let cached: MediaToolsHealth | null = null
let inflight: Promise<MediaToolsHealth> | null = null

export function resetMediaHealthCache(): void {
  cached = null
  inflight = null
}

export function peekMediaHealth(): MediaToolsHealth | null {
  return cached
}

export async function loadMediaHealth(force = false): Promise<MediaToolsHealth> {
  if (!force && cached) return cached
  if (!force && inflight) return inflight
  const pending = host.mediaHealth().then((health) => {
    cached = health
    return health
  })
  inflight = pending
  try {
    return await pending
  } finally {
    if (inflight === pending) inflight = null
  }
}

/** One recovery sentence when FFmpeg or FFprobe cannot run. Null when both are healthy. */
export async function mediaToolsBlocker(force = false): Promise<string | null> {
  try {
    const health = await loadMediaHealth(force)
    return health.ok ? null : health.message ?? mediaToolUnavailableMessage('ffmpeg', 'ffmpeg')
  } catch {
    return mediaToolUnavailableMessage('ffmpeg', 'ffmpeg')
  }
}
