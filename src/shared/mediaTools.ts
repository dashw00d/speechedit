/** Resolve and explain FFmpeg / FFprobe so preview, import, and export share one recovery sentence. */

export type MediaTool = 'ffmpeg' | 'ffprobe'

export type MediaToolStatus = {
  name: MediaTool
  path: string
  version: string | null
  ok: boolean
}

export type MediaToolsHealth = {
  ffmpeg: MediaToolStatus
  ffprobe: MediaToolStatus
  ok: boolean
  message: string | null
}

export function parseMediaToolVersion(text: string): string | null {
  const numeric = text.match(/\bversion\s+n?(\d+\.\d+(?:\.\d+)?)/i)
  if (numeric?.[1]) return numeric[1]
  const token = text.match(/\bversion\s+(\S+)/i)?.[1]
  if (!token || /^copyright$/i.test(token)) return null
  return token
}

export function mediaToolUnavailableMessage(name: MediaTool, resolved: string): string {
  if (resolved !== name) {
    return `Bundled ${name} did not start. Re-download SpeechEdit or set SPEECHEDIT_${name.toUpperCase()}.`
  }
  return 'FFmpeg did not start. Install ffmpeg 4.4+ (and ffprobe) and keep them on PATH.'
}

export function mediaToolsHealthMessage(ffmpeg: MediaToolStatus, ffprobe: MediaToolStatus): string | null {
  if (ffmpeg.ok && ffprobe.ok) return null
  const failed = [ffmpeg, ffprobe].filter((tool) => !tool.ok)
  const packaged = failed.some((tool) => tool.path !== tool.name)
  if (packaged) {
    if (failed.length === 1) return mediaToolUnavailableMessage(failed[0]!.name, failed[0]!.path)
    return 'Bundled FFmpeg did not start. Re-download SpeechEdit or set SPEECHEDIT_FFMPEG / SPEECHEDIT_FFPROBE.'
  }
  return mediaToolUnavailableMessage('ffmpeg', 'ffmpeg')
}

export function mediaToolsHealthSummary(health: MediaToolsHealth): string {
  if (!health.ok) return health.message ?? mediaToolUnavailableMessage('ffmpeg', 'ffmpeg')
  const ffmpeg = health.ffmpeg.version ?? 'unknown'
  const ffprobe = health.ffprobe.version ?? 'unknown'
  if (ffmpeg === ffprobe) return `FFmpeg ${ffmpeg}`
  return `FFmpeg ${ffmpeg} · FFprobe ${ffprobe}`
}

/** Keep a packaged-binary failure from being rewritten as “install ffmpeg on PATH”. */
export function explainMediaToolFailure(message: string): string | null {
  if (!/ffmpeg|ffprobe/i.test(message) || !/ENOENT|not found|did not start|spawn /i.test(message)) return null
  if (/Re-download SpeechEdit|Bundled /i.test(message)) {
    return (
      message.match(/Bundled \S+ did not start\. Re-download SpeechEdit[^.]*\./)?.[0] ??
      'Bundled FFmpeg did not start. Re-download SpeechEdit or set SPEECHEDIT_FFMPEG / SPEECHEDIT_FFPROBE.'
    )
  }
  return mediaToolUnavailableMessage('ffmpeg', 'ffmpeg')
}
