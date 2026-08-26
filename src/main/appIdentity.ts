import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { type AppIdentity } from '../shared/appIdentity'

const execFileAsync = promisify(execFile)

export type GitIdentity = { commit: string | null; dirty: boolean }

export type AppIdentityInput = {
  version: string
  packaged: boolean
  electron: string
  platform: string
  arch: string
  bakedCommit?: string | null
  git?: () => Promise<GitIdentity>
}

async function defaultGit(): Promise<GitIdentity> {
  try {
    const { stdout: sha } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
      timeout: 3000,
      windowsHide: true
    })
    const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], {
      timeout: 3000,
      windowsHide: true
    })
    return { commit: sha.trim() || null, dirty: Boolean(status.trim()) }
  } catch {
    return { commit: null, dirty: false }
  }
}

export async function resolveAppIdentity(input: AppIdentityInput): Promise<AppIdentity> {
  let commit = input.bakedCommit?.trim() || null
  let dirty = false
  if (!input.packaged) {
    const git = await (input.git ?? defaultGit)()
    if (git.commit) {
      commit = git.commit
      dirty = git.dirty
    }
  }
  return {
    name: 'SpeechEdit',
    version: input.version,
    commit,
    dirty,
    channel: input.packaged ? 'packaged' : 'dev',
    electron: input.electron,
    platform: input.platform,
    arch: input.arch
  }
}
