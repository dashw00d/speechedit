import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'

export type MediaTool = 'ffmpeg' | 'ffprobe'

interface MediaToolOptions {
  platform?: NodeJS.Platform
  resourcesPath?: string
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
}

function currentResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
}

/** Prefer an explicit override, then the packaged binary, then developer PATH. */
export function mediaToolPath(name: MediaTool, options: MediaToolOptions = {}): string {
  const env = options.env ?? process.env
  const override = env[name === 'ffmpeg' ? 'SPEECHEDIT_FFMPEG' : 'SPEECHEDIT_FFPROBE']?.trim()
  if (override) return override

  const platform = options.platform ?? process.platform
  const resourcesPath = options.resourcesPath ?? currentResourcesPath()
  const exists = options.exists ?? existsSync
  if (resourcesPath) {
    const executable = platform === 'win32' ? `${name}.exe` : name
    const bundled = (platform === 'win32' ? win32 : posix).join(resourcesPath, 'bin', executable)
    if (exists(bundled)) return bundled
  }

  return name
}

export function mediaToolMissingMessage(name: MediaTool, resolved = mediaToolPath(name)): string {
  const packaged = resolved !== name
  if (packaged) return `Bundled ${name} did not start. Re-download SpeechEdit or set SPEECHEDIT_${name.toUpperCase()}.`
  return 'FFmpeg did not start. Install ffmpeg 4.4+ (and ffprobe) and keep them on PATH.'
}
