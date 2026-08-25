import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { asrHome } from './asrLocal'

export function mediaCacheDir(): string {
  return join(asrHome(), 'cache')
}

export function mediaCacheId(file: string): string {
  const st = statSync(file)
  return createHash('sha1').update(`${file}\0${st.size}\0${Math.round(st.mtimeMs)}`).digest('hex').slice(0, 20)
}

export function peaksCachePath(file: string): string {
  return join(mediaCacheDir(), `${mediaCacheId(file)}.peaks.json`)
}

export function thumbsCachePath(file: string): string {
  return join(mediaCacheDir(), `${mediaCacheId(file)}.thumbs.json`)
}

export function analysisCachePath(file: string): string {
  return join(mediaCacheDir(), `${mediaCacheId(file)}.analysis.json`)
}

export function asrCachePath(file: string, kind: string, model: string, extra = ''): string {
  const id = createHash('sha1').update(`${kind}\0${model}\0${extra}`).digest('hex').slice(0, 12)
  return join(mediaCacheDir(), `${mediaCacheId(file)}.asr.${id}.json`)
}

export async function readJsonCache<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

export async function writeJsonCache(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}
