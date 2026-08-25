import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  cliBinariesFor,
  coerceTranscriptKind,
  parseAsrPayload,
  transcriptionsUrl,
  type AsrCue,
  type AsrResult,
  type TranscriptKind
} from '../shared/asr'

export interface ModelEndpointOpts {
  kind?: string
  baseUrl?: string
  model?: string
  apiKey?: string
}

export interface TranscribeProgress {
  stage: 'prepare' | 'audio' | 'run' | 'parse' | 'done'
  ratio: number
}

export interface AsrPathStatus {
  kind: TranscriptKind
  binaries: string[]
  found: string[]
  available: boolean
}

type ProgressFn = (info: TranscribeProgress) => void

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stderr + stdout)
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-400)}`))
    })
  })
}

function hasBin(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where' : 'which'
    const child = spawn(finder, [name], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

export async function listAsrPath(): Promise<AsrPathStatus[]> {
  const kinds: TranscriptKind[] = ['whisper-cli', 'faster-whisper', 'whisper-cpp', 'mlx-whisper']
  const out: AsrPathStatus[] = []
  for (const kind of kinds) {
    const binaries = cliBinariesFor(kind)
    const found: string[] = []
    for (const bin of binaries) {
      if (await hasBin(bin)) found.push(bin)
    }
    out.push({ kind, binaries, found, available: found.length > 0 })
  }
  return out
}

function pythonModelArgs(model?: string): string[] {
  if (!model || model === 'whisper-1') return []
  return ['--model', model]
}

function firstJsonIn(dir: string): Promise<string | null> {
  return readdir(dir).then(async (names) => {
    const hit = names.find((n) => n.endsWith('.json'))
    return hit ? readFile(join(dir, hit), 'utf8') : null
  })
}

async function transcribePythonStyle(
  bin: string,
  file: string,
  extra: string[],
  provider: string
): Promise<AsrResult | null> {
  const dir = await mkdtemp(join(tmpdir(), 'speechedit-asr-'))
  try {
    const out = await run(bin, [
      file,
      '--output_format',
      'json',
      '--output_dir',
      dir,
      '--word_timestamps',
      'True',
      ...extra
    ])
    const fromOut = parseAsrPayload(out, provider)
    if (fromOut?.cues.length) return fromOut
    const raw = await firstJsonIn(dir)
    return raw ? parseAsrPayload(raw, provider) : null
  } catch {
    try {
      const out = await run(bin, [file, '--output_format', 'json', '--output_dir', dir, ...extra])
      const fromOut = parseAsrPayload(out, provider)
      if (fromOut?.cues.length) return fromOut
      const raw = await firstJsonIn(dir)
      return raw ? parseAsrPayload(raw, provider) : null
    } catch {
      return null
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function transcribeMlx(bin: string, file: string, model?: string): Promise<AsrResult | null> {
  const dir = await mkdtemp(join(tmpdir(), 'speechedit-mlx-'))
  const extra = pythonModelArgs(model)
  const attempts = [
    [file, '--output-format', 'json', '--output-dir', dir, '--word-timestamps', ...extra],
    [file, '--output_format', 'json', '--output_dir', dir, '--word_timestamps', 'True', ...extra]
  ]
  try {
    for (const args of attempts) {
      try {
        const out = await run(bin, args)
        const fromOut = parseAsrPayload(out, 'mlx-whisper')
        if (fromOut?.cues.length) return fromOut
        const raw = await firstJsonIn(dir)
        const parsed = raw ? parseAsrPayload(raw, 'mlx-whisper') : null
        if (parsed?.cues.length) return parsed
      } catch {
        continue
      }
    }
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function transcribeWhisperCpp(bin: string, file: string, model?: string): Promise<AsrResult | null> {
  const dir = await mkdtemp(join(tmpdir(), 'speechedit-wcpp-'))
  const prefix = join(dir, 'out')
  const modelArgs =
    model && (model.endsWith('.bin') || model.includes('/') || model.includes('\\')) ? ['-m', model] : []
  const attempts = [
    ['-f', file, '-oj', '-ojf', '-of', prefix, '-ml', '1', ...modelArgs],
    ['-f', file, '-oj', '-of', prefix, ...modelArgs]
  ]
  try {
    for (const args of attempts) {
      try {
        await run(bin, args)
        const raw = await readFile(`${prefix}.json`, 'utf8').catch(async () => (await firstJsonIn(dir)) ?? '')
        const parsed = raw ? parseAsrPayload(raw, 'whisper-cpp') : null
        if (parsed?.cues.length) return parsed
      } catch {
        continue
      }
    }
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function tryBins(
  bins: string[],
  runOne: (bin: string) => Promise<AsrResult | null>
): Promise<AsrResult | null> {
  for (const bin of bins) {
    if (!(await hasBin(bin))) continue
    const result = await runOne(bin)
    if (result?.cues.length) return result
  }
  return null
}

async function transcribeCli(kind: TranscriptKind, file: string, model?: string): Promise<AsrResult | null> {
  if (kind === 'whisper-cpp') {
    return tryBins(cliBinariesFor('whisper-cpp'), (bin) => transcribeWhisperCpp(bin, file, model))
  }
  if (kind === 'mlx-whisper') {
    return tryBins(cliBinariesFor('mlx-whisper'), (bin) => transcribeMlx(bin, file, model))
  }
  if (kind === 'faster-whisper') {
    return tryBins(cliBinariesFor('faster-whisper'), (bin) =>
      transcribePythonStyle(bin, file, pythonModelArgs(model), 'faster-whisper')
    )
  }
  return tryBins(cliBinariesFor('whisper-cli'), (bin) =>
    transcribePythonStyle(bin, file, pythonModelArgs(model), 'whisper-cli')
  )
}

async function extractWav(file: string): Promise<{ dir: string; wav: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'speechedit-asr-'))
  const wav = join(dir, `${basename(file, '').replace(/\.[^.]+$/, '') || 'a'}.wav`)
  await run('ffmpeg', ['-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', wav])
  return { dir, wav }
}

async function transcribeHttp(file: string, opts: ModelEndpointOpts): Promise<AsrResult | null> {
  if (!opts.baseUrl || !opts.model) return null
  const { dir, wav } = await extractWav(file)
  try {
    const buf = await readFile(wav)
    const blob = new Blob([buf], { type: 'audio/wav' })
    const headers: Record<string, string> = {}
    if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`

    const post = async (withWords: boolean) => {
      const body = new FormData()
      body.append('file', blob, 'audio.wav')
      body.append('model', opts.model || 'whisper-1')
      body.append('response_format', 'verbose_json')
      if (withWords) body.append('timestamp_granularities[]', 'word')
      const res = await fetch(transcriptionsUrl(opts.baseUrl || ''), { method: 'POST', headers, body })
      if (!res.ok) throw new Error(`Transcribe ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return parseAsrPayload(await res.json(), 'openai-compatible')
    }

    try {
      const withWords = await post(true)
      if (withWords?.cues.length) return withWords
    } catch {
      /* some local servers reject timestamp_granularities */
    }
    return post(false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function flatten(result: AsrResult | null): AsrCue[] | null {
  if (!result?.cues.length) return null
  return result.cues
}

export async function transcribe(
  file: string,
  prefer?: string[]
): Promise<AsrCue[] | null> {
  if (prefer?.some((b) => cliBinariesFor('whisper-cpp').includes(b))) {
    return flatten(await transcribeCli('whisper-cpp', file))
  }
  if (prefer?.some((b) => cliBinariesFor('mlx-whisper').includes(b))) {
    return flatten(await transcribeCli('mlx-whisper', file))
  }
  if (prefer?.includes('faster-whisper')) {
    return flatten(await transcribeCli('faster-whisper', file))
  }
  return flatten(await transcribeCli('whisper-cli', file))
}

export async function transcribeMedia(
  file: string,
  opts?: ModelEndpointOpts,
  onProgress?: ProgressFn
): Promise<AsrCue[] | null> {
  const kind = coerceTranscriptKind(opts?.kind)
  const note = (stage: TranscribeProgress['stage'], ratio: number) => onProgress?.({ stage, ratio })

  if (kind === 'off') {
    note('done', 1)
    return null
  }

  note('prepare', 0.05)
  try {
    if (kind === 'openai-compatible') {
      note('audio', 0.2)
      note('run', 0.45)
      const result = await transcribeHttp(file, opts ?? {})
      note('parse', 0.9)
      note('done', 1)
      return flatten(result)
    }

    note('run', 0.35)
    const result = await transcribeCli(kind, file, opts?.model)
    if (result?.cues.length) {
      note('parse', 0.9)
      note('done', 1)
      return flatten(result)
    }

    note('done', 1)
    return null
  } catch {
    note('done', 1)
    return null
  }
}
