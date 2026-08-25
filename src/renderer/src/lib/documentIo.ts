import { host, isElectron } from '../host'
import { flushWorkspace, useEditor } from '../store'
import {
  documentLabel,
  localMediaRefs,
  makeRecovery,
  missingMedia,
  openDocumentFromRaw,
  parseRecovery,
  parseSession,
  serializeDocument,
  shouldOfferRecovery,
  suggestedDocumentName,
  type RecoveryRecord
} from './projectDocument'

export function confirmLoseWork(message = 'This reel has unsaved edits. Discard them?'): boolean {
  if (!useEditor.getState().dirty) return true
  if (typeof window === 'undefined') return true
  return window.confirm(message)
}

export async function refreshMissingAssets(): Promise<void> {
  const project = useEditor.getState().project
  const refs = localMediaRefs(project)
  if (!refs.length) {
    useEditor.getState().setMissingAssets([])
    return
  }
  const checks = await host.mediaExists(refs.map((ref) => ref.path))
  const present: Record<string, boolean> = {}
  for (const row of checks) present[row.path] = row.exists
  useEditor.getState().setMissingAssets(missingMedia(project, present))
}

export async function hydrateWorkspace(): Promise<{ source: string; recovery: boolean }> {
  const recovery = parseRecovery(await host.readRecovery())
  const session = parseSession(await host.readSession())
  let saved: { path: string; project: ReturnType<typeof openDocumentFromRaw>['project']; savedAt: number } | null =
    null
  if (session.lastDocumentPath) {
    const file = await host.readProject(session.lastDocumentPath)
    if (file) {
      const opened = openDocumentFromRaw(file.project, file.path)
      saved = { path: file.path, project: opened.project, savedAt: opened.savedAt }
    }
  }

  if (
    saved &&
    recovery &&
    shouldOfferRecovery(recovery, {
      savedAt: saved.savedAt,
      projectId: saved.project.id,
      path: saved.path
    })
  ) {
    useEditor.getState().loadProject(saved.project, {
      path: saved.path,
      clean: true,
      lastSavedAt: saved.savedAt
    })
    useEditor.getState().setRecoveryOffer(recovery)
    await refreshMissingAssets()
    return { source: 'saved', recovery: true }
  }

  if (saved) {
    useEditor.getState().loadProject(saved.project, {
      path: saved.path,
      clean: true,
      lastSavedAt: saved.savedAt
    })
    await refreshMissingAssets()
    return { source: 'document', recovery: false }
  }

  if (recovery?.project) {
    useEditor.getState().loadProject(recovery.project, {
      path: recovery.documentPath,
      clean: !recovery.dirty,
      lastSavedAt: recovery.lastSavedAt
    })
    await refreshMissingAssets()
    return { source: 'recovery', recovery: false }
  }

  await refreshMissingAssets()
  return { source: 'cache', recovery: false }
}

export async function restoreRecovery(): Promise<void> {
  const offer = useEditor.getState().recoveryOffer
  if (!offer) return
  useEditor.getState().loadProject(offer.project, {
    path: offer.documentPath,
    clean: false,
    lastSavedAt: offer.lastSavedAt
  })
  useEditor.getState().setRecoveryOffer(null)
  await refreshMissingAssets()
}

export async function discardRecovery(): Promise<void> {
  useEditor.getState().setRecoveryOffer(null)
  await host.clearRecovery().catch(() => undefined)
  flushWorkspace()
}

export async function saveCurrentDocument(opts?: { saveAs?: boolean }): Promise<string> {
  const editor = useEditor.getState()
  const envelope = serializeDocument(editor.project, editor.documentPath)
  const suggested = editor.documentPath || suggestedDocumentName(editor.project)
  let path: string | null = null
  if (!opts?.saveAs && editor.documentPath && isElectron) {
    path = await host.writeProject(editor.documentPath, envelope)
  } else {
    path = await host.saveProject(envelope, suggested)
  }
  if (!path) return ''
  useEditor.getState().markClean({ path, savedAt: envelope.savedAt })
  await refreshMissingAssets()
  return path
}

export async function openCurrentDocument(): Promise<string> {
  const result = await host.openProject()
  if (!result) return ''
  const opened = openDocumentFromRaw(result.project, result.path)
  useEditor.getState().loadProject(opened.project, {
    path: result.path,
    clean: true,
    lastSavedAt: opened.savedAt
  })
  await refreshMissingAssets()
  return result.path
}

export async function relinkAssetInteractive(assetId: string): Promise<string | null> {
  const file = await host.openMedia()
  if (!file) return null
  useEditor.getState().dispatch({ type: 'relinkAsset', assetId, path: file })
  await refreshMissingAssets()
  return file
}

export function currentDocumentTitle(): string {
  const editor = useEditor.getState()
  return documentLabel(editor.documentPath, editor.project.name)
}

export function recoveryCopy(offer: RecoveryRecord): string {
  const when = new Date(offer.recoveredAt).toLocaleString()
  return `Unsaved edits from ${when}`
}

export { makeRecovery }
