import type { Project } from '../types'
export const isSharedEditor = () => typeof location !== 'undefined' && location.pathname.startsWith('/edit/')
export const sharedSession: { persist?: (project: Project) => void; save?: () => Promise<string>; projectId?: string } = {}

/** Separate durable store: opening a collaboration link never replaces the owner's workspace or recovery. */
async function database() {
  return new Promise<IDBDatabase>((ok, fail) => {
    const request = indexedDB.open('speechedit-collaboration', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('state')
    request.onsuccess = () => ok(request.result); request.onerror = () => fail(request.error)
  })
}
export async function readSharedState<T>(key: string): Promise<T | undefined> {
  const db = await database()
  try { return await new Promise<T | undefined>((ok, fail) => { const req = db.transaction('state').objectStore('state').get(key); req.onsuccess = () => ok(req.result); req.onerror = () => fail(req.error) }) } finally { db.close() }
}
export async function writeSharedState(key: string, value: unknown): Promise<void> {
  const db = await database()
  try { await new Promise<void>((ok, fail) => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(value, key); tx.oncomplete = () => ok(); tx.onerror = () => fail(tx.error); tx.onabort = () => fail(tx.error) }) } finally { db.close() }
}
export function mountSharedProject(project: Project, roomId: string, originals?: Project): Project {
  return { ...project, assets: Object.fromEntries(Object.entries(project.assets).map(([id, asset]) => {
    const original = originals?.assets[id]
    return [id, original ? { ...asset, displayRotation: original.displayRotation, codec: original.codec, vfr: original.vfr, path: original.path, browserMediaKey: original.browserMediaKey, proxyPath: original.proxyPath, thumbnails: original.thumbnails, proxyOnly: original.proxyOnly } : { ...asset, path: `${location.origin}/api/reviews/${roomId}/media/${id}`, proxyOnly: !asset.isRecording }]
  })) }
}
