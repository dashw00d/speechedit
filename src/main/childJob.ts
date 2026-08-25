import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JobCancelled, throwIfAborted, type MediaJobKind } from '../shared/mediaJob'

export function killChild(child: ChildProcess): void {
  if (child.exitCode != null || child.signalCode != null) return
  try {
    child.kill('SIGTERM')
  } catch {
    /* already gone */
  }
  const timer = setTimeout(() => {
    if (child.exitCode == null && child.signalCode == null) {
      try {
        child.kill('SIGKILL')
      } catch {
        /* gone */
      }
    }
  }, 400)
  child.once('close', () => clearTimeout(timer))
}

export interface RunChildOptions {
  signal?: AbortSignal
  kind?: MediaJobKind
  onStdout?: (text: string) => void
  onStderr?: (text: string) => void
  onSpawn?: (child: ChildProcess) => void
  /** Resolve even when the process exits non-zero (legacy silencedetect). Cancel still rejects. */
  allowFailure?: boolean
  missing?: string
  fail?: (code: number | null, stderr: string, stdout: string) => Error
  env?: NodeJS.ProcessEnv
}

export function runChild(cmd: string, args: string[], opts: RunChildOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      throwIfAborted(opts.signal, opts.kind)
    } catch (err) {
      reject(err)
      return
    }
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts.env ? { ...process.env, ...opts.env } : undefined
    })
    opts.onSpawn?.(child)
    let stdout = ''
    let stderr = ''
    let settled = false

    const onAbort = () => killChild(child)
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      opts.signal?.removeEventListener('abort', onAbort)
      fn()
    }

    if (opts.signal?.aborted) {
      killChild(child)
      finish(() => reject(new JobCancelled(opts.kind)))
      return
    }

    child.stdout?.on('data', (d: Buffer) => {
      const text = d.toString()
      stdout += text
      opts.onStdout?.(text)
    })
    child.stderr?.on('data', (d: Buffer) => {
      const text = d.toString()
      stderr += text
      opts.onStderr?.(text)
    })
    child.on('error', (err) => {
      finish(() => {
        if (opts.signal?.aborted) reject(new JobCancelled(opts.kind))
        else reject(new Error(opts.missing ?? `${cmd} did not start (${err.message}).`))
      })
    })
    child.on('close', (code, signal) => {
      finish(() => {
        if (opts.signal?.aborted || signal === 'SIGTERM' || signal === 'SIGKILL') {
          reject(new JobCancelled(opts.kind))
          return
        }
        if (code === 0 || opts.allowFailure) {
          resolve(cmd === 'ffprobe' ? stdout : stderr + stdout)
          return
        }
        reject(opts.fail?.(code, stderr, stdout) ?? new Error(`${cmd} exited ${code}: ${stderr.slice(-400)}`))
      })
    })
  })
}

export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
