// Single source of truth for the browser Whisper models and the Hugging Face
// revisions they are pinned to. The worker, `vite dev/preview`, and the
// production web server must agree, or the model proxy requests a revision
// that does not exist for the model and the download 404s.
export const BROWSER_WHISPER_MODEL = 'onnx-community/whisper-tiny.en_timestamped'

export const WHISPER_MODEL_REVISIONS: Readonly<Record<string, string>> = {
  'onnx-community/whisper-tiny.en': '2575352d61be1bf7225cf8f8b268a4678025fc58',
  [BROWSER_WHISPER_MODEL]: 'aeaa13760958b03fac5062f457d317d3319c3168'
}

export const BROWSER_WHISPER_MODEL_REVISION = WHISPER_MODEL_REVISIONS[BROWSER_WHISPER_MODEL]

export function whisperModelRevision(owner: string, model: string): string | undefined {
  return WHISPER_MODEL_REVISIONS[`${owner}/${model}`]
}

// URL namespace the worker requests models under (`/whisper-models/<version>/...`).
// Servers also accept older versions so previously deployed clients keep working.
export const WHISPER_MODEL_CACHE_VERSION = 'v3'
export const WHISPER_MODEL_CACHE_VERSIONS: readonly string[] = ['v2', WHISPER_MODEL_CACHE_VERSION]
