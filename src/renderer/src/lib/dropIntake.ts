export type DropKind = 'media' | 'transcript' | 'project' | 'interchange' | 'unknown'

const MEDIA_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|wav|mp3|m4a|aac|aiff|flac|ogg)$/i
const TRANSCRIPT_EXT = /\.(srt|vtt|txt)$/i
const INTERCHANGE_EXT = /\.(otio|fcpxml|mlt|kdenlive|xml)$/i

export function droppedFilePath(file: File): string | null {
  const path = (file as File & { path?: string }).path
  return typeof path === 'string' && path.length > 1 ? path : null
}

export function classifyDrop(name: string, mime = ''): DropKind {
  const lower = name.toLowerCase()
  if (/\.speechedit\.json$/.test(lower)) return 'project'
  if (MEDIA_EXT.test(lower) || mime.startsWith('video/') || mime.startsWith('audio/')) return 'media'
  if (INTERCHANGE_EXT.test(lower)) return 'interchange'
  if (TRANSCRIPT_EXT.test(lower)) return 'transcript'
  if (lower.endsWith('.json')) return 'transcript'
  return 'unknown'
}

export function refineJsonKind(raw: unknown): DropKind {
  if (!raw || typeof raw !== 'object') return 'transcript'
  const rec = raw as {
    kind?: unknown
    OTIO_SCHEMA?: unknown
    chunks?: unknown
    timeline?: unknown
    project?: unknown
  }
  if (rec.kind === 'speechedit.project' || (rec.project && typeof rec.project === 'object')) return 'project'
  if (rec.OTIO_SCHEMA || rec.chunks || rec.timeline) return 'interchange'
  return 'transcript'
}
