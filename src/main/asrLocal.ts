import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, chmod, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { cliBinariesFor, type TranscriptKind } from '../shared/asr'

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

export function whisperCppOptDir(): string {
  return join(asrHome(), 'opt', 'whisper-cpp')
}

export function whisperLibraryDir(bin: string): string | undefined {
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
  const opt = join(whisperCppOptDir(), process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli')
  if (existsSync(opt) && existsSync(join(whisperCppOptDir(), 'libwhisper.so.1'))) return opt
  const local = join(asrBinDir(), process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli')
  if (existsSync(local) && whisperLibraryDir(local)) return local
  return undefined
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

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`)
  await mkdir(join(dest, '..'), { recursive: true })
  await Bun.write(dest, res)
}

export async function ensureLocalWhisper(opts?: { sample?: boolean }): Promise<{
  bin: string
  model: string
  sample?: string
}> {
  const existing = await whisperCppReady()
  const samplePath = join(asrHome(), 'samples', 'jfk.wav')
  if (existing) {
    if (opts?.sample && !existsSync(samplePath)) await downloadTo(JFK_URL, samplePath)
    return { ...existing, sample: opts?.sample ? samplePath : undefined }
  }

  const url = whisperCppReleaseUrl()
  if (!url) {
    throw new Error(
      'No whisper.cpp build for this OS. Put whisper-cli on PATH or in ~/.speechedit/bin, and ggml-tiny.en.bin in ~/.speechedit/models.'
    )
  }

  await mkdir(asrBinDir(), { recursive: true })
  await mkdir(join(asrHome(), 'models'), { recursive: true })
  await mkdir(join(asrHome(), 'opt'), { recursive: true })
  const archive = join(asrHome(), `whisper-${WHISPER_CPP_RELEASE}.tgz`)
  if (!existsSync(archive)) await downloadTo(url, archive)
  const modelDest = join(asrHome(), 'models', MODEL_NAME)
  if (!existsSync(modelDest)) await downloadTo(MODEL_URL, modelDest)

  const optBin = join(whisperCppOptDir(), 'whisper-cli')
  if (!existsSync(optBin) || !existsSync(join(whisperCppOptDir(), 'libwhisper.so.1'))) {
    const staging = join(asrHome(), 'opt')
    await Bun.$`tar -xzf ${archive} -C ${staging}`.quiet()
    const unpacked = join(staging, 'whisper-bin-ubuntu-x64')
    if (existsSync(unpacked) && unpacked !== whisperCppOptDir()) {
      await Bun.$`rm -rf ${whisperCppOptDir()}`.quiet()
      await Bun.$`mv ${unpacked} ${whisperCppOptDir()}`.quiet()
    }
    if (!existsSync(optBin)) throw new Error('Could not unpack whisper-cli into ~/.speechedit/opt/whisper-cpp')
    await chmod(optBin, 0o755)
  }
  const wrapper = join(asrBinDir(), 'whisper-cli')
  await writeFile(
    wrapper,
    `#!/bin/sh\nDIR="${whisperCppOptDir()}"\nexport LD_LIBRARY_PATH="$DIR\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"\nexec "$DIR/whisper-cli" "$@"\n`
  )
  await chmod(wrapper, 0o755)

  if (opts?.sample && !existsSync(samplePath)) await downloadTo(JFK_URL, samplePath)
  const ready = await whisperCppReady()
  if (!ready) throw new Error('whisper.cpp installed but not visible to SpeechEdit.')
  return { ...ready, sample: opts?.sample ? samplePath : undefined }
}
