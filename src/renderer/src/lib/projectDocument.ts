import { normalizeProject } from './normalize'
import type { Asset, Project } from '../types'

export const DOCUMENT_KIND = 'speechedit.project'
export const RECOVERY_KIND = 'speechedit.recovery'
export const DOCUMENT_VERSION = 1

export interface ProjectDocument {
  kind: typeof DOCUMENT_KIND
  version: number
  savedAt: number
  project: Project
}

export interface RecoveryRecord {
  kind: typeof RECOVERY_KIND
  version: number
  recoveredAt: number
  documentPath: string | null
  lastSavedAt: number | null
  dirty: boolean
  project: Project
}

export interface WorkspaceSession {
  lastDocumentPath: string | null
  lastSavedAt: number | null
}

export interface MediaRef {
  id: string
  name: string
  path: string
}

export function isExternalMediaPath(path: string): boolean {
  return /^(blob:|https?:|data:|media:)/i.test(path)
}

export function isAbsoluteMediaPath(path: string): boolean {
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(path)
}

export function isFilesystemPath(path: string | null | undefined): path is string {
  return Boolean(path && (isAbsoluteMediaPath(path) || /[\\/]/.test(path)))
}

export function parentDir(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (idx < 0) return ''
  if (idx === 2 && /^[a-zA-Z]:/.test(trimmed)) return trimmed.slice(0, 3)
  return trimmed.slice(0, idx)
}

export function fileName(path: string | null | undefined): string {
  if (!path) return ''
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return idx >= 0 ? path.slice(idx + 1) : path
}

function splitPath(path: string): { drive: string; parts: string[] } {
  const unix = path.replace(/\\/g, '/')
  const drive = /^[a-zA-Z]:/.test(unix) ? unix.slice(0, 2).toLowerCase() : ''
  const rest = drive ? unix.slice(2) : unix
  return { drive, parts: rest.split('/').filter(Boolean) }
}

export function joinMediaPath(dir: string, rel: string): string {
  if (!rel || isExternalMediaPath(rel) || isAbsoluteMediaPath(rel) || !dir) return rel
  const sep = dir.includes('\\') ? '\\' : '/'
  const tail = rel.replace(/^[\\/]+/, '').replace(/\//g, sep)
  return `${dir.replace(/[\\/]+$/, '')}${sep}${tail}`
}

export function relativizeMediaPath(fromDir: string, target: string): string {
  if (!target || !fromDir || isExternalMediaPath(target) || !isAbsoluteMediaPath(target)) return target
  const a = splitPath(fromDir)
  const b = splitPath(target)
  if (a.drive !== b.drive) return target
  let i = 0
  while (i < a.parts.length && i < b.parts.length && a.parts[i].toLowerCase() === b.parts[i].toLowerCase()) {
    i += 1
  }
  if (i !== a.parts.length) return target
  return b.parts.slice(i).join('/')
}

function mapAssets(project: Project, fn: (asset: Asset) => Asset): Project {
  const assets = Object.fromEntries(
    Object.entries(project.assets).map(([id, asset]) => [id, fn(asset)])
  )
  return { ...project, assets }
}

export function withRelativizedAssets(project: Project, projectDir: string): Project {
  return mapAssets(project, (asset) => ({
    ...asset,
    path: relativizeMediaPath(projectDir, asset.path)
  }))
}

export function withResolvedAssets(project: Project, projectDir: string): Project {
  return mapAssets(project, (asset) => ({
    ...asset,
    path: joinMediaPath(projectDir, asset.path)
  }))
}

export function slimProjectForCache(project: Project): Project {
  return mapAssets(project, (asset) => {
    if (!asset.thumbnails?.length) return asset
    const { thumbnails: _thumbs, ...rest } = asset
    return rest
  })
}

export function isProjectShape(raw: unknown): raw is Project {
  if (!raw || typeof raw !== 'object') return false
  const rec = raw as Record<string, unknown>
  return Boolean(rec.tracks && rec.assets && rec.transcript)
}

export function isDocumentEnvelope(raw: unknown): raw is ProjectDocument {
  if (!raw || typeof raw !== 'object') return false
  const rec = raw as Partial<ProjectDocument>
  return rec.kind === DOCUMENT_KIND && isProjectShape(rec.project)
}

export function parseProjectDocument(raw: unknown): { project: Project; savedAt: number; version: number } {
  if (isDocumentEnvelope(raw)) {
    return {
      project: normalizeProject(raw.project),
      savedAt: raw.savedAt ?? raw.project.updatedAt,
      version: raw.version ?? DOCUMENT_VERSION
    }
  }
  if (isProjectShape(raw)) {
    const project = normalizeProject(raw)
    return { project, savedAt: project.updatedAt, version: 0 }
  }
  throw new Error('Not a SpeechEdit project.')
}

export function serializeDocument(project: Project, documentPath?: string | null): ProjectDocument {
  const normalized = normalizeProject(project)
  const dir = isFilesystemPath(documentPath) ? parentDir(documentPath) : null
  return {
    kind: DOCUMENT_KIND,
    version: DOCUMENT_VERSION,
    savedAt: Date.now(),
    project: dir ? withRelativizedAssets(normalized, dir) : normalized
  }
}

export function openDocumentFromRaw(
  raw: unknown,
  documentPath: string | null
): { project: Project; savedAt: number; version: number } {
  const parsed = parseProjectDocument(raw)
  const dir = isFilesystemPath(documentPath) ? parentDir(documentPath) : ''
  return {
    ...parsed,
    project: dir ? withResolvedAssets(parsed.project, dir) : parsed.project
  }
}

export function makeRecovery(
  project: Project,
  meta: { documentPath: string | null; lastSavedAt: number | null; dirty: boolean }
): RecoveryRecord {
  return {
    kind: RECOVERY_KIND,
    version: DOCUMENT_VERSION,
    recoveredAt: Date.now(),
    documentPath: meta.documentPath,
    lastSavedAt: meta.lastSavedAt,
    dirty: meta.dirty,
    project
  }
}

export function parseRecovery(raw: unknown): RecoveryRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Partial<RecoveryRecord>
  if (rec.kind === RECOVERY_KIND && isProjectShape(rec.project)) {
    return {
      kind: RECOVERY_KIND,
      version: rec.version ?? DOCUMENT_VERSION,
      recoveredAt: rec.recoveredAt ?? rec.project.updatedAt,
      documentPath: rec.documentPath ?? null,
      lastSavedAt: rec.lastSavedAt ?? null,
      dirty: Boolean(rec.dirty),
      project: normalizeProject(rec.project)
    }
  }
  try {
    const parsed = parseProjectDocument(raw)
    return makeRecovery(parsed.project, {
      documentPath: null,
      lastSavedAt: parsed.savedAt,
      dirty: false
    })
  } catch {
    return null
  }
}

export function parseSession(raw: unknown): WorkspaceSession {
  if (!raw || typeof raw !== 'object') return { lastDocumentPath: null, lastSavedAt: null }
  const rec = raw as Partial<WorkspaceSession>
  return {
    lastDocumentPath: rec.lastDocumentPath ?? null,
    lastSavedAt: rec.lastSavedAt ?? null
  }
}

export function shouldOfferRecovery(
  recovery: RecoveryRecord,
  lastSaved: { savedAt: number; projectId: string; path?: string | null } | null
): boolean {
  if (!recovery.project) return false
  if (!lastSaved) return false
  if (recovery.project.id !== lastSaved.projectId) return recovery.dirty
  if (!recovery.dirty && recovery.project.updatedAt <= lastSaved.savedAt + 500) return false
  return recovery.dirty || recovery.project.updatedAt > lastSaved.savedAt + 250
}

export function localMediaRefs(project: Project): MediaRef[] {
  return Object.values(project.assets)
    .filter((asset) => asset.path && !isExternalMediaPath(asset.path))
    .map((asset) => ({ id: asset.id, name: asset.name, path: asset.path }))
}

export function missingMedia(
  project: Project,
  exists: ((path: string) => boolean) | Record<string, boolean>
): MediaRef[] {
  const check = typeof exists === 'function' ? exists : (path: string) => exists[path] !== false
  return localMediaRefs(project).filter((ref) => !check(ref.path))
}

export function suggestedDocumentName(project: Project): string {
  const slug =
    project.name
      .trim()
      .replace(/[^\w]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'project'
  return `${slug}.speechedit.json`
}

export function documentLabel(documentPath: string | null, projectName: string): string {
  return fileName(documentPath) || projectName || 'Untitled'
}
