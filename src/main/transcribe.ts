import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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
import { WhisperUnavailable, isJobCancelled, throwIfAborted } from '../shared/mediaJob'
import {
  defaultWhisperCppModel,
  findCliBin,
  resolveBin,
  whisperCppReady,
  whisperSpawnEnv
} from './asrLocal'
import { runChild, withTempDir } from './childJob'

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
  model?: string
}

type ProgressFn = (info: TranscribeProgress) => void

function run(cmd: string, args: string[], signal?: AbortSignal): Promise<string> {
  return runChild(cmd, args, {
    signal,
    kind: 'import',
    env: whisperSpawnEnv(cmd),
    missing:
      cmd === 'ffmpeg' || cmd === 'ffprobe'
        ? 'FFmpeg did not start. Install ffmpeg 4.4+ (and ffprobe) and keep them on PATH.'
        : `${cmd} did not start. Install whisper-cli or whisper.cpp, or pick an OpenAI-compatible endpoint in Models.`
  })
}

export async function listAsrPath(): Promise<AsrPathStatus[]> {
  const kinds: TranscriptKind[] = ['whisper-cli', 'faster-whisper', 'whisper-cpp', 'mlx-whisper']
  const out: AsrPathStatus[] = []
  for (const kind of kinds) {
    const binaries = cliBinariesFor(kind)
    const found: string[] = []
    for (const bin of binaries) {
      const resolved = await resolveBin(bin)
      if (resolved) found.push(resolved)
    }
    const model = kind === 'whisper-cpp' ? defaultWhisperCppModel() : undefined
    out.push({
      kind,
      binaries,
      found,
      available: found.length > 0 && (kind !== 'whisper-cpp' || Boolean(model)),
      model
    })
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
  provider: string,
  signal?: AbortSignal
): Promise<AsrResult | null> {
  return withTempDir('speechedit-asr-', async (dir) => {
    try {
      const out = await run(
        bin,
        [file, '--output_format', 'json', '--output_dir', dir, '--word_timestamps', 'True', ...extra],
        signal
      )
      const fromOut = parseAsrPayload(out, provider)
      if (fromOut?.cues.length) return fromOut
      const raw = await firstJsonIn(dir)
      return raw ? parseAsrPayload(raw, provider) : null
    } catch (err) {
      if (isJobCancelled(err)) throw err
      try {
        const out = await run(bin, [file, '--output_format', 'json', '--output_dir', dir, ...extra], signal)
        const fromOut = parseAsrPayload(out, provider)
        if (fromOut?.cues.length) return fromOut
        const raw = await firstJsonIn(dir)
        return raw ? parseAsrPayload(raw, provider) : null
      } catch (inner) {
        if (isJobCancelled(inner)) throw inner
        return null
      }
    }
  })
}

async function transcribeMlx(
  bin: string,
  file: string,
  model?: string,
  signal?: AbortSignal
): Promise<AsrResult | null> {
  return withTempDir('speechedit-mlx-', async (dir) => {
    const extra = pythonModelArgs(model)
    const attempts = [
      [file, '--output-format', 'json', '--output-dir', dir, '--word-timestamps', ...extra],
      [file, '--output_format', 'json', '--output_dir', dir, '--word_timestamps', 'True', ...extra]
    ]
    for (const args of attempts) {
      try {
        const out = await run(bin, args, signal)
        const fromOut = parseAsrPayload(out, 'mlx-whisper')
        if (fromOut?.cues.length) return fromOut
        const raw = await firstJsonIn(dir)
        const parsed = raw ? parseAsrPayload(raw, 'mlx-whisper') : null
        if (parsed?.cues.length) return parsed
      } catch (err) {
        if (isJobCancelled(err)) throw err
        continue
      }
    }
    return null
  })
}

function ggmlModelPath(model?: string): string | undefined {
  if (model && (model.endsWith('.bin') || model.includes('/') || model.includes('\\')) && existsSync(model)) {
    return model
  }
  return defaultWhisperCppModel()
}

async function extractWav(file: string, dir: string, signal?: AbortSignal): Promise<string> {
  const wav = join(dir, 'audio.wav')
  await run('ffmpeg', ['-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', wav], signal)
  return wav
}

async function transcribeWhisperCpp(
  bin: string,
  file: string,
  model?: string,
  signal?: AbortSignal
): Promise<AsrResult | null> {
  const modelPath = ggmlModelPath(model)
  if (!modelPath) {
    throw new WhisperUnavailable(
      'Need a ggml Whisper model. Put ggml-tiny.en.bin in ~/.speechedit/models or set the path in Models.'
    )
  }
  return withTempDir('speechedit-wcpp-', async (dir) => {
    const wav = await extractWav(file, dir, signal)
    const prefix = join(dir, 'out')
    const modelArgs = ['-m', modelPath]
    const attempts = [
      ['-f', wav, '-oj', '-ojf', '-of', prefix, '-ml', '1', ...modelArgs],
      ['-f', wav, '-oj', '-of', prefix, ...modelArgs],
      ['-f', wav, '--output-json', '--output-file', prefix, ...modelArgs]
    ]
    for (const args of attempts) {
      try {
        await run(bin, args, signal)
        const raw = await readFile(`${prefix}.json`, 'utf8').catch(async () => (await firstJsonIn(dir)) ?? '')
        const parsed = raw ? parseAsrPayload(raw, 'whisper-cpp') : null
        if (parsed?.cues.length) return parsed
      } catch (err) {
        if (isJobCancelled(err)) throw err
        continue
      }
    }
    return null
  })
}

async function tryBins(
  bins: string[],
  runOne: (bin: string) => Promise<AsrResult | null>
): Promise<AsrResult | null> {
  for (const bin of bins) {
    const resolved = await resolveBin(bin)
    if (!resolved) continue
    const result = await runOne(resolved)
    if (result?.cues.length) return result
  }
  return null
}

async function transcribeCli(
  kind: TranscriptKind,
  file: string,
  model?: string,
  signal?: AbortSignal
): Promise<AsrResult | null> {
  const bins = cliBinariesFor(kind)
  const runOne =
    kind === 'whisper-cpp'
      ? (bin: string) => transcribeWhisperCpp(bin, file, model, signal)
      : kind === 'mlx-whisper'
        ? (bin: string) => transcribeMlx(bin, file, model, signal)
        : kind === 'faster-whisper'
          ? (bin: string) => transcribePythonStyle(bin, file, pythonModelArgs(model), 'faster-whisper', signal)
          : (bin: string) => transcribePythonStyle(bin, file, pythonModelArgs(model), 'whisper-cli', signal)
  const result = await tryBins(bins, runOne)
  if (result?.cues.length) return result
  if (!(await findCliBin(kind))) throw new WhisperUnavailable()
  return null
}

async function transcribeHttp(
  file: string,
  opts: ModelEndpointOpts,
  signal?: AbortSignal
): Promise<AsrResult | null> {
  if (!opts.baseUrl || !opts.model) {
    throw new WhisperUnavailable('Set a transcription URL and model in Models.')
  }
  return withTempDir('speechedit-asr-', async (dir) => {
    throwIfAborted(signal, 'import')
    const wav = join(dir, `${basename(file, '').replace(/\.[^.]+$/, '') || 'a'}.wav`)
    await run('ffmpeg', ['-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', wav], signal)
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
      const res = await fetch(transcriptionsUrl(opts.baseUrl || ''), { method: 'POST', headers, body, signal })
      if (!res.ok) throw new Error(`Transcribe ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return parseAsrPayload(await res.json(), 'openai-compatible')
    }

    try {
      const withWords = await post(true)
      if (withWords?.cues.length) return withWords
    } catch (err) {
      if (isJobCancelled(err)) throw err
      /* some local servers reject timestamp_granularities */
    }
    return post(false)
  })
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
  onProgress?: ProgressFn,
  signal?: AbortSignal
): Promise<AsrCue[] | null> {
  const kind = coerceTranscriptKind(opts?.kind)
  const note = (stage: TranscribeProgress['stage'], ratio: number) => onProgress?.({ stage, ratio })

  if (kind === 'off') {
    note('done', 1)
    return null
  }

  note('prepare', 0.05)
  throwIfAborted(signal, 'import')
  try {
    if (kind === 'openai-compatible') {
      note('audio', 0.2)
      note('run', 0.45)
      const result = await transcribeHttp(file, opts ?? {}, signal)
      note('parse', 0.9)
      note('done', 1)
      return flatten(result)
    }

    note('audio', 0.2)
    const order: TranscriptKind[] =
      kind === 'whisper-cli'
        ? ['whisper-cli', 'whisper-cpp', 'faster-whisper', 'mlx-whisper']
        : [kind]
    let lastUnavailable: Error | null = null
    for (const next of order) {
      if (next === 'whisper-cpp' && !(await whisperCppReady()) && !(await findCliBin('whisper-cpp'))) {
        lastUnavailable = new WhisperUnavailable()
        continue
      }
      try {
        note('run', 0.35)
        const result = await transcribeCli(next, file, opts?.model, signal)
        if (result?.cues.length) {
          note('parse', 0.9)
          note('done', 1)
          return flatten(result)
        }
      } catch (err) {
        if (isJobCancelled(err)) throw err
        if (err instanceof WhisperUnavailable) {
          lastUnavailable = err
          continue
        }
        throw err
      }
    }
    if (lastUnavailable) throw lastUnavailable
    note('done', 1)
    return null
  } catch (err) {
    note('done', 1)
    throw err
  }
}
