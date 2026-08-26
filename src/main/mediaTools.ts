import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { promisify } from 'node:util'

import {
  mediaToolUnavailableMessage,
  mediaToolsHealthMessage,
  parseMediaToolVersion,
  type MediaTool,
  type MediaToolStatus,
  type MediaToolsHealth
} from '../shared/mediaTools'

export type { MediaTool, MediaToolStatus, MediaToolsHealth } from '../shared/mediaTools'
export {
  explainMediaToolFailure,
  mediaToolsHealthMessage,
  mediaToolsHealthSummary,
  parseMediaToolVersion
} from '../shared/mediaTools'

export interface MediaToolOptions {
  platform?: NodeJS.Platform
  resourcesPath?: string
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
  run?: (command: string, args: string[]) => Promise<string>
}

const execFileAsync = promisify(execFile)

function currentResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
}

async function defaultRun(command: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout: 8000,
    windowsHide: true,
    maxBuffer: 64 * 1024
  })
  return `${stdout}${stderr}`
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
  return mediaToolUnavailableMessage(name, resolved)
}

export async function probeMediaTool(name: MediaTool, options: MediaToolOptions = {}): Promise<MediaToolStatus> {
  const path = mediaToolPath(name, options)
  const exists = options.exists ?? existsSync
  if (path !== name && !exists(path)) {
    return { name, path, version: null, ok: false }
  }
  const run = options.run ?? defaultRun
  try {
    const version = parseMediaToolVersion(await run(path, ['-version']))
    return { name, path, version, ok: Boolean(version) }
  } catch {
    return { name, path, version: null, ok: false }
  }
}

export async function checkMediaTools(options: MediaToolOptions = {}): Promise<MediaToolsHealth> {
  const [ffmpeg, ffprobe] = await Promise.all([
    probeMediaTool('ffmpeg', options),
    probeMediaTool('ffprobe', options)
  ])
  return {
    ffmpeg,
    ffprobe,
    ok: ffmpeg.ok && ffprobe.ok,
    message: mediaToolsHealthMessage(ffmpeg, ffprobe)
  }
}
