import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  cliBinariesFor,
  coerceTranscriptKind,
  localTranscriptOrder,
  parseAsrPayload,
  sanitizeAsrCues,
  shouldInstallLocalWhisper,
  transcriptionsUrl,
  type AsrCue,
  type AsrResult,
  type TranscriptKind,
  type TranscribeProgress
} from '../shared/asr'
import { WhisperUnavailable, isJobCancelled, throwIfAborted } from '../shared/mediaJob'
import {
  defaultWhisperCppModel,
  findCliBin,
  maybeEnsureLocalWhisper,
  resolveBin,
  whisperCppReady,
  whisperSpawnEnv
} from './asrLocal'
import { runChild, withTempDir } from './childJob'
import { mediaToolMissingMessage, mediaToolPath } from './mediaTools'
import type { ChildProcess } from 'node:child_process'
import {
  asrChunkWindows,
  asrChunksComplete,
  mergeAsrChunks,
  pendingAsrChunks,
  shiftAsrCues,
  wantsChunkedAsr,
  type AsrChunkResult
} from '../shared/asrChunks'
import { asrCachePath, asrChunkCachePath, readJsonCache, writeJsonCache } from './mediaCache'

export interface ModelEndpointOpts {
  kind?: string
  baseUrl?: string
  model?: string
  apiKey?: string
  force?: boolean
  skipInstall?: boolean
}

export type { TranscribeProgress }

export interface AsrPathStatus {
  kind: TranscriptKind
  binaries: string[]
  found: string[]
  available: boolean
  model?: string
}

type ProgressFn = (info: TranscribeProgress) => void

type NoteFn = (
  stage: TranscribeProgress['stage'],
  ratio: number,
  extra?: Pick<TranscribeProgress, 'cues' | 'chunk'>
) => void

let transcribeChildHook: ((child: ChildProcess) => void) | undefined

function run(cmd: string, args: string[], signal?: AbortSignal): Promise<string> {
  const command = cmd === 'ffmpeg' || cmd === 'ffprobe' ? mediaToolPath(cmd) : cmd
  return runChild(command, args, {
    signal,
    kind: 'import',
    onSpawn: transcribeChildHook,
    env: whisperSpawnEnv(cmd),
    missing:
      cmd === 'ffmpeg' || cmd === 'ffprobe'
        ? mediaToolMissingMessage(cmd, command)
        : `${cmd} did not start. Install whisper.cpp into ~/.speechedit, put a Whisper CLI on PATH, or pick an OpenAI-compatible endpoint in Models.`
  })
}

export async function listAsrPath(): Promise<AsrPathStatus[]> {
  const kinds: TranscriptKind[] = [...localTranscriptOrder('whisper-cpp')]
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

async function probeDuration(file: string, signal?: AbortSignal): Promise<number> {
  const raw = await run(
    'ffprobe',
    ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
    signal
  )
  const n = Number(String(raw).trim().split(/\s+/)[0])
  return Number.isFinite(n) && n > 0 ? n : 0
}

type AsrChunkCacheDoc = { v: number; duration: number; chunks: AsrChunkResult[] }

async function loadAsrChunks(
  file: string,
  kind: string,
  model: string,
  extra: string
): Promise<AsrChunkResult[]> {
  const hit = await readJsonCache<AsrChunkCacheDoc>(asrChunkCachePath(file, kind, model, extra))
  if (hit?.v === 1 && Array.isArray(hit.chunks)) return hit.chunks
  return []
}

async function saveAsrChunks(
  file: string,
  kind: string,
  model: string,
  extra: string,
  duration: number,
  chunks: AsrChunkResult[]
): Promise<void> {
  await writeJsonCache(asrChunkCachePath(file, kind, model, extra), { v: 1, duration, chunks }).catch(
    () => undefined
  )
}

async function sliceWav(
  full: string,
  dest: string,
  start: number,
  duration: number,
  signal?: AbortSignal
): Promise<void> {
  await run(
    'ffmpeg',
    ['-y', '-ss', start.toFixed(3), '-t', Math.max(0.05, duration).toFixed(3), '-i', full, dest],
    signal
  )
}

async function transcribeOneWindow(
  kind: TranscriptKind,
  file: string,
  model: string | undefined,
  opts: ModelEndpointOpts,
  signal?: AbortSignal
): Promise<AsrCue[]> {
  if (kind === 'openai-compatible') return flatten(await transcribeHttp(file, opts, signal)) ?? []
  return flatten(await transcribeCli(kind, file, model, signal)) ?? []
}

async function transcribeChunked(
  file: string,
  kind: TranscriptKind,
  model: string,
  extra: string,
  opts: ModelEndpointOpts,
  duration: number,
  note: NoteFn,
  signal?: AbortSignal
): Promise<AsrCue[] | null> {
  const windows = asrChunkWindows(duration)
  if (!windows.length) return null
  const saved = opts.force ? [] : await loadAsrChunks(file, kind, model, extra)
  const pending = pendingAsrChunks(windows, saved)
  note('audio', 0.18)
  return withTempDir('speechedit-asr-chunks-', async (dir) => {
    const full = pending.length ? join(dir, 'full.wav') : ''
    if (pending.length) {
      await run('ffmpeg', ['-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', full], signal)
    }
    const done: AsrChunkResult[] = [...saved]
    let finished = windows.length - pending.length
    const emitPartial = () => {
      const cues = mergeAsrChunks(done)
      note('run', 0.2 + 0.7 * (finished / windows.length), {
        ...(cues.length ? { cues } : {}),
        chunk: { finished, total: windows.length }
      })
    }
    if (finished > 0) emitPartial()
    for (const window of pending) {
      throwIfAborted(signal, 'import')
      const slice = join(dir, `c${window.start.toFixed(0)}.wav`)
      await sliceWav(full, slice, window.start, window.end - window.start, signal)
      const local = await transcribeOneWindow(kind, slice, model || undefined, opts, signal)
      done.push({ ...window, cues: shiftAsrCues(local, window.start) })
      await saveAsrChunks(file, kind, model, extra, duration, done)
      finished += 1
      emitPartial()
    }
    const cues = mergeAsrChunks(done)
    return cues.length ? cues : null
  })
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

type AsrCacheDoc = { v: number; kind: string; model: string; cues: AsrCue[] }

function asrExtra(kind: TranscriptKind, opts?: ModelEndpointOpts): string {
  return kind === 'openai-compatible' ? opts?.baseUrl?.trim() || '' : ''
}

async function loadAsrCache(
  file: string,
  kind: string,
  model: string,
  extra = ''
): Promise<AsrCue[] | null> {
  const hit = await readJsonCache<AsrCacheDoc>(asrCachePath(file, kind, model, extra))
  if (hit?.v === 1 && Array.isArray(hit.cues) && hit.cues.length) {
    const clean = sanitizeAsrCues(hit.cues)
    return clean.length ? clean : null
  }
  return null
}

async function saveAsrCache(
  file: string,
  kind: string,
  model: string,
  extra: string,
  cues: AsrCue[]
): Promise<void> {
  const clean = sanitizeAsrCues(cues)
  if (!clean.length) return
  await writeJsonCache(asrCachePath(file, kind, model, extra), { v: 1, kind, model, cues: clean }).catch(
    () => undefined
  )
}

async function readAsrCacheHit(
  file: string,
  kind: TranscriptKind,
  model: string,
  extra: string
): Promise<AsrCue[] | null> {
  const models = [model]
  if (!model || model === 'whisper-1') models.push('whisper-1', 'tiny', '')
  const ggml = ggmlModelPath(model)
  if (ggml && !models.includes(ggml)) models.push(ggml)
  const unique = [...new Set(models)]
  for (const next of localTranscriptOrder(kind)) {
    for (const key of unique) {
      const cached = await loadAsrCache(file, next, key, extra)
      if (cached) {
        if (next !== kind || key !== model) await saveAsrCache(file, kind, model, extra, cached)
        return cached
      }
    }
  }
  return null
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
  return transcribeMedia(file)
}

export async function transcribeMedia(
  file: string,
  opts?: ModelEndpointOpts,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
  onSpawn?: (child: ChildProcess) => void
): Promise<AsrCue[] | null> {
  const kind = coerceTranscriptKind(opts?.kind)
  const model = opts?.model ?? ''
  const extra = asrExtra(kind, opts)
  const force = Boolean(opts?.force)
  const note: NoteFn = (stage, ratio, extra) => onProgress?.({ stage, ratio, ...extra })
  const prevHook = transcribeChildHook
  transcribeChildHook = onSpawn
  try {
  if (kind === 'off') {
    note('done', 1)
    return null
  }

  note('prepare', 0.05)
  throwIfAborted(signal, 'import')
  if (!force) {
    const hit = await readAsrCacheHit(file, kind, model, extra)
    if (hit) {
      note('done', 1, { cues: hit })
      return hit
    }
  }
  const duration = await probeDuration(file, signal).catch((err) => {
    if (isJobCancelled(err)) throw err
    return 0
  })
  if (!force && wantsChunkedAsr(duration)) {
    const windows = asrChunkWindows(duration)
    const keys = [model, 'tiny', 'whisper-1', '', ggmlModelPath(model) ?? '']
    const kinds = kind === 'openai-compatible' ? [kind] : localTranscriptOrder(kind)
    for (const next of kinds) {
      for (const key of [...new Set(keys)]) {
        const saved = await loadAsrChunks(file, next, key, extra)
        if (!asrChunksComplete(windows, saved)) continue
        const cues = mergeAsrChunks(saved)
        if (!cues.length) continue
        note('parse', 0.9, { cues, chunk: { finished: windows.length, total: windows.length } })
        note('done', 1, { cues, chunk: { finished: windows.length, total: windows.length } })
        await saveAsrCache(file, next, key || model, extra, cues)
        if (kind !== next || key !== model) await saveAsrCache(file, kind, model, extra, cues)
        return cues
      }
    }
  }
  if (shouldInstallLocalWhisper(kind) && !(await whisperCppReady())) {
    if (!opts?.skipInstall) {
      note('install', 0.12)
      await maybeEnsureLocalWhisper({ signal })
    }
  }
  try {
    note('audio', 0.2)
    const chunked = wantsChunkedAsr(duration)

    if (kind === 'openai-compatible') {
      note('run', 0.45)
      const cues = chunked
        ? await transcribeChunked(file, kind, model, extra, opts ?? {}, duration, note, signal)
        : flatten(await transcribeHttp(file, opts ?? {}, signal))
      note('parse', 0.9, cues?.length ? { cues } : undefined)
      note('done', 1, cues?.length ? { cues } : undefined)
      if (cues) await saveAsrCache(file, kind, model, extra, cues)
      return cues
    }

    const order = localTranscriptOrder(kind)
    let lastUnavailable: Error | null = null
    for (const next of order) {
      if (next === 'whisper-cpp' && !(await whisperCppReady()) && !(await findCliBin('whisper-cpp'))) {
        lastUnavailable = new WhisperUnavailable()
        continue
      }
      try {
        note('run', 0.35)
        const actualModel = next === 'whisper-cpp' ? ggmlModelPath(model) || model : model
        const cues = chunked
          ? await transcribeChunked(file, next, actualModel, extra, opts ?? {}, duration, note, signal)
          : flatten(await transcribeCli(next, file, opts?.model, signal))
        if (cues?.length) {
          note('parse', 0.9, { cues })
          note('done', 1, { cues })
          await saveAsrCache(file, next, actualModel, extra, cues)
          if (kind !== next || actualModel !== model) await saveAsrCache(file, kind, model, extra, cues)
          return cues
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
  } finally {
    transcribeChildHook = prevHook
  }
}
