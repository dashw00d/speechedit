import { host, isElectron } from '../host'
import { assetNeedsProxy } from '../../../shared/proxy'
import { flushWorkspace, useEditor } from '../store'
import {
  documentLabel,
  isExternalMediaPath,
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

export async function hydrateAssetLooks(): Promise<void> {
  if (useEditor.getState().exporting) return
  const project = useEditor.getState().project
  const missing = new Set(useEditor.getState().missingAssets.map((ref) => ref.id))
  const assets = { ...project.assets }
  let changed = false
  for (const asset of Object.values(assets)) {
    if (!asset.path || isExternalMediaPath(asset.path) || missing.has(asset.id)) continue
    const needPeaks = !asset.waveform?.length
    const needThumbs = !asset.thumbnails?.length
    if (!needPeaks && !needThumbs) continue
    const waveform = needPeaks
      ? await host.waveform(asset.path).catch(() => asset.waveform ?? [])
      : asset.waveform
    const thumbnails = needThumbs
      ? await host.thumbnails(asset.path).catch(() => asset.thumbnails ?? [])
      : asset.thumbnails
    const waveChanged = needPeaks && waveform.length > 0
    const thumbsChanged = needThumbs && (thumbnails?.length ?? 0) > 0
    if (!waveChanged && !thumbsChanged) continue
    assets[asset.id] = {
      ...asset,
      waveform: waveChanged ? waveform : asset.waveform,
      ...(thumbsChanged ? { thumbnails } : {})
    }
    changed = true
  }
  if (changed) useEditor.getState().hydrateLooks(assets)
}

/** Remake or drop a saved preview proxy that is no longer on disk. Does not mark dirty. */
export async function hydrateAssetProxies(): Promise<void> {
  if (useEditor.getState().exporting) return
  const project = useEditor.getState().project
  const missing = new Set(useEditor.getState().missingAssets.map((ref) => ref.id))
  const assets = { ...project.assets }
  const candidates = Object.values(assets).filter(
    (asset) =>
      asset.kind === 'video' &&
      asset.path &&
      !isExternalMediaPath(asset.path) &&
      !missing.has(asset.id)
  )
  if (!candidates.length) return
  const proxyPaths = candidates.map((asset) => asset.proxyPath).filter((path): path is string => Boolean(path))
  const checks = proxyPaths.length ? await host.mediaExists(proxyPaths) : []
  const present: Record<string, boolean> = {}
  for (const row of checks) present[row.path] = row.exists
  let changed = false
  for (const asset of candidates) {
    if (asset.proxyPath && present[asset.proxyPath]) continue
    let next = asset
    let want = Boolean(asset.proxyPath) || assetNeedsProxy(asset)
    if (!want && !asset.codec) {
      const probed = await host.probe(asset.path).catch(() => null)
      if (probed) {
        next = {
          ...asset,
          ...(probed.codec ? { codec: probed.codec } : {}),
          ...(probed.vfr ? { vfr: true } : {})
        }
        want = assetNeedsProxy(next)
      }
    }
    if (!want) {
      if (next !== asset) {
        assets[asset.id] = next
        changed = true
      }
      continue
    }
    const made = await host.makeProxy(next.path).catch(() => '')
    assets[asset.id] = made ? { ...next, proxyPath: made } : { ...next, proxyPath: undefined }
    changed = true
  }
  if (changed) useEditor.getState().hydrateLooks(assets)
}

export async function hydrateMedia(): Promise<void> {
  await hydrateAssetProxies()
  await hydrateAssetLooks()
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
    await hydrateMedia()
    return { source: 'saved', recovery: true }
  }

  if (saved) {
    useEditor.getState().loadProject(saved.project, {
      path: saved.path,
      clean: true,
      lastSavedAt: saved.savedAt
    })
    await refreshMissingAssets()
    await hydrateMedia()
    return { source: 'document', recovery: false }
  }

  if (recovery?.project) {
    useEditor.getState().loadProject(recovery.project, {
      path: recovery.documentPath,
      clean: !recovery.dirty,
      lastSavedAt: recovery.lastSavedAt
    })
    await refreshMissingAssets()
    await hydrateMedia()
    return { source: 'recovery', recovery: false }
  }

  await refreshMissingAssets()
  await hydrateMedia()
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
  await hydrateMedia()
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
  await hydrateMedia()
  return result.path
}

export async function relinkAssetInteractive(assetId: string): Promise<string | null> {
  const file = await host.openMedia()
  if (!file) return null
  useEditor.getState().dispatch({ type: 'relinkAsset', assetId, path: file })
  await refreshMissingAssets()
  await hydrateMedia()
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
