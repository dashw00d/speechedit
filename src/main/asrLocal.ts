import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { cliBinariesFor, type TranscriptKind } from '../shared/asr'
import { JobCancelled, isJobCancelled, throwIfAborted } from '../shared/mediaJob'

const execFileAsync = promisify(execFile)

export const WHISPER_CPP_RELEASE = 'b4938'
const MODEL_NAME = 'ggml-tiny.en.bin'
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`
const JFK_URL = 'https://github.com/ggml-org/whisper.cpp/raw/master/samples/jfk.wav'

export function asrHome(): string {
  return process.env.SPEECHEDIT_HOME?.trim() || join(homedir(), '.speechedit')
}

export function asrBinDir(): string {
  return join(asrHome(), 'bin')
}

export function proxyCacheDir(): string {
  return join(asrHome(), 'proxies')
}

export function proxyCachePath(file: string): string {
  const st = statSync(file)
  const id = createHash('sha1').update(`${file}\0${st.size}\0${Math.round(st.mtimeMs)}`).digest('hex').slice(0, 20)
  return join(proxyCacheDir(), `${id}.mp4`)
}

export function whisperCppOptDir(): string {
  return join(asrHome(), 'opt', 'whisper-cpp')
}

export function whisperLibraryDir(bin: string): string | undefined {
  if (process.platform === 'win32') return undefined
  const dir = dirname(bin)
  if (existsSync(join(dir, 'libwhisper.so.1')) || existsSync(join(dir, 'libwhisper.so'))) return dir
  const opt = whisperCppOptDir()
  if (existsSync(join(opt, 'libwhisper.so.1'))) return opt
  return undefined
}

export function whisperSpawnEnv(bin: string): NodeJS.ProcessEnv | undefined {
  const lib = whisperLibraryDir(bin)
  if (!lib) return undefined
  const prev = process.env.LD_LIBRARY_PATH
  return { LD_LIBRARY_PATH: prev ? `${lib}:${prev}` : lib }
}

export function defaultWhisperCppModel(): string | undefined {
  const env = process.env.SPEECHEDIT_WHISPER_MODEL?.trim()
  if (env && existsSync(env)) return env
  const home = join(asrHome(), 'models', MODEL_NAME)
  return existsSync(home) ? home : undefined
}

export function defaultWhisperCppBin(): string | undefined {
  const env = process.env.SPEECHEDIT_WHISPER_BIN?.trim()
  if (env && existsSync(env)) return env
  const opt = join(whisperCppOptDir(), whisperExecutableName(process.platform))
  if (whisperRuntimeReady(whisperCppOptDir(), process.platform)) return opt
  const local = join(asrBinDir(), process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli')
  if (existsSync(local) && (process.platform === 'win32' || whisperLibraryDir(local))) return local
  return undefined
}

export function whisperExecutableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
}

export function whisperArchiveExtension(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'zip' : 'tar.gz'
}

export function whisperExtractFlag(platform: NodeJS.Platform): '-xf' | '-xzf' {
  return platform === 'win32' ? '-xf' : '-xzf'
}

export function whisperReleaseDirectory(platform: NodeJS.Platform, arch: string): string {
  if (platform === 'win32') return 'Release'
  return `whisper-bin-ubuntu-${arch}`
}

export function whisperRuntimeReady(
  dir: string,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean = existsSync
): boolean {
  if (!exists(join(dir, whisperExecutableName(platform)))) return false
  if (platform === 'win32') {
    return exists(join(dir, 'whisper.dll')) && exists(join(dir, 'ggml.dll')) && exists(join(dir, 'ggml-base.dll'))
  }
  return exists(join(dir, 'libwhisper.so.1')) || exists(join(dir, 'libwhisper.so'))
}

export function hasBin(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (name.includes('/') || name.includes('\\')) {
      resolve(existsSync(name))
      return
    }
    const finder = process.platform === 'win32' ? 'where' : 'which'
    const child = spawn(finder, [name], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

export async function resolveBin(name: string): Promise<string | null> {
  if (name.includes('/') || name.includes('\\')) return existsSync(name) ? name : null
  if (name === 'whisper-cli' || name === 'whisper-cli.exe') {
    const preferred = defaultWhisperCppBin()
    if (preferred) return preferred
    return (await hasBin(name)) ? name : null
  }
  if (await hasBin(name)) return name
  const local = join(asrBinDir(), name)
  if (existsSync(local)) return local
  return null
}

export async function resolveFirstBin(names: string[]): Promise<string | null> {
  for (const name of names) {
    const hit = await resolveBin(name)
    if (hit) return hit
  }
  return null
}

export function whisperCppReleaseUrl(): string | null {
  if (process.platform === 'linux' && process.arch === 'x64') {
    return `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_CPP_RELEASE}/whisper-bin-ubuntu-x64.tar.gz`
  }
  if (process.platform === 'linux' && process.arch === 'arm64') {
    return `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_CPP_RELEASE}/whisper-bin-ubuntu-arm64.tar.gz`
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_CPP_RELEASE}/whisper-bin-x64.zip`
  }
  return null
}

export async function findCliBin(kind: TranscriptKind): Promise<string | null> {
  return resolveFirstBin(cliBinariesFor(kind))
}

export async function whisperCppReady(): Promise<{ bin: string; model: string } | null> {
  const bin = (await findCliBin('whisper-cpp')) ?? defaultWhisperCppBin()
  const model = defaultWhisperCppModel()
  if (!bin || !model) return null
  return { bin, model }
}

export function whisperInstallSkipped(): boolean {
  return process.env.SPEECHEDIT_SKIP_WHISPER_INSTALL === '1'
}

async function downloadTo(url: string, dest: string, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal, 'import')
  const res = await fetch(url, { redirect: 'follow', signal })
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`)
  throwIfAborted(signal, 'import')
  await mkdir(join(dest, '..'), { recursive: true })
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
}

export async function maybeEnsureLocalWhisper(opts?: {
  skip?: boolean
  signal?: AbortSignal
}): Promise<{ status: 'ready' | 'installed' | 'skipped' | 'failed'; bin?: string; model?: string }> {
  const existing = await whisperCppReady()
  if (existing) return { status: 'ready', ...existing }
  if (opts?.skip || whisperInstallSkipped()) return { status: 'skipped' }
  try {
    const ready = await ensureLocalWhisper({ signal: opts?.signal })
    return { status: 'installed', bin: ready.bin, model: ready.model }
  } catch (err) {
    if (isJobCancelled(err) || (err instanceof Error && err.name === 'AbortError')) {
      throw err instanceof JobCancelled ? err : new JobCancelled('import')
    }
    return { status: 'failed' }
  }
}

export async function ensureLocalWhisper(opts?: { sample?: boolean; signal?: AbortSignal }): Promise<{
  bin: string
  model: string
  sample?: string
}> {
  const existing = await whisperCppReady()
  const samplePath = join(asrHome(), 'samples', 'jfk.wav')
  if (existing) {
    if (opts?.sample && !existsSync(samplePath)) await downloadTo(JFK_URL, samplePath, opts.signal)
    return { ...existing, sample: opts?.sample ? samplePath : undefined }
  }

  throwIfAborted(opts?.signal, 'import')
  const url = whisperCppReleaseUrl()
  if (!url) {
    throw new Error(
      'No whisper.cpp build for this OS. Put whisper-cli on PATH or in ~/.speechedit/bin, and ggml-tiny.en.bin in ~/.speechedit/models.'
    )
  }

  await mkdir(asrBinDir(), { recursive: true })
  await mkdir(join(asrHome(), 'models'), { recursive: true })
  await mkdir(join(asrHome(), 'opt'), { recursive: true })
  const archive = join(
    asrHome(),
    `whisper-${WHISPER_CPP_RELEASE}.${whisperArchiveExtension(process.platform)}`
  )
  if (!existsSync(archive)) await downloadTo(url, archive, opts?.signal)
  const modelDest = join(asrHome(), 'models', MODEL_NAME)
  if (!existsSync(modelDest)) await downloadTo(MODEL_URL, modelDest, opts?.signal)

  const optBin = join(whisperCppOptDir(), whisperExecutableName(process.platform))
  if (!whisperRuntimeReady(whisperCppOptDir(), process.platform)) {
    const staging = join(asrHome(), 'opt', `.whisper-${WHISPER_CPP_RELEASE}-${process.pid}`)
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    try {
      await execFileAsync('tar', [whisperExtractFlag(process.platform), archive, '-C', staging])
      const unpacked = join(staging, whisperReleaseDirectory(process.platform, process.arch))
      if (!whisperRuntimeReady(unpacked, process.platform)) {
        throw new Error('Downloaded whisper.cpp did not contain the expected runtime files.')
      }
      await rm(whisperCppOptDir(), { recursive: true, force: true })
      await rename(unpacked, whisperCppOptDir())
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
    if (!existsSync(optBin)) throw new Error('Could not unpack whisper-cli into ~/.speechedit/opt/whisper-cpp')
    if (process.platform !== 'win32') await chmod(optBin, 0o755)
  }
  if (process.platform !== 'win32') {
    const wrapper = join(asrBinDir(), 'whisper-cli')
    await writeFile(
      wrapper,
      `#!/bin/sh\nDIR="${whisperCppOptDir()}"\nexport LD_LIBRARY_PATH="$DIR\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"\nexec "$DIR/whisper-cli" "$@"\n`
    )
    await chmod(wrapper, 0o755)
  }

  throwIfAborted(opts?.signal, 'import')
  if (opts?.sample && !existsSync(samplePath)) await downloadTo(JFK_URL, samplePath, opts.signal)
  const ready = await whisperCppReady()
  if (!ready) throw new Error('whisper.cpp installed but not visible to SpeechEdit.')
  return { ...ready, sample: opts?.sample ? samplePath : undefined }
}
