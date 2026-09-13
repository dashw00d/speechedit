const DATABASE = 'speechedit-proxy-cache'
const MAX_BYTES = 128 * 1024 * 1024
interface CachedProxy { key: string; blob: Blob; usedAt: number }
async function database(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('previews', { keyPath: 'key' })
    request.onsuccess = () => ok(request.result); request.onerror = () => fail(request.error)
  })
}
/** Optional bounded cache. Failure to cache must never prevent sharing. */
export async function cachedReviewProxy(key: string): Promise<Blob | undefined> {
  let db: IDBDatabase | undefined
  try {
    db = await database()
    return await new Promise<Blob | undefined>((ok, fail) => {
      const tx = db!.transaction('previews', 'readwrite'), store = tx.objectStore('previews'), request = store.get(key)
      let blob: Blob | undefined
      request.onsuccess = () => { const row = request.result as CachedProxy | undefined; if (row) { blob = row.blob; store.put({ ...row, usedAt: Date.now() }) } }
      tx.oncomplete = () => ok(blob); tx.onerror = () => fail(tx.error); tx.onabort = () => fail(tx.error)
    })
  } catch { return undefined } finally { db?.close() }
}
export async function cacheReviewProxy(key: string, blob: Blob): Promise<void> {
  if (blob.size > MAX_BYTES) return
  let db: IDBDatabase | undefined
  try {
    db = await database()
    await new Promise<void>((ok, fail) => {
      const tx = db!.transaction('previews', 'readwrite'), store = tx.objectStore('previews'), request = store.getAll()
      request.onsuccess = () => {
        const rows = (request.result as CachedProxy[]).filter(row => row.key !== key).sort((a, b) => b.usedAt - a.usedAt)
        let bytes = blob.size
        for (const row of rows) { bytes += row.blob.size; if (bytes > MAX_BYTES) store.delete(row.key) }
        store.put({ key, blob, usedAt: Date.now() } satisfies CachedProxy)
      }
      tx.oncomplete = () => ok(); tx.onerror = () => fail(tx.error); tx.onabort = () => fail(tx.error)
    })
  } catch { /* Browser quota or unavailable storage: keep the generated preview usable. */ } finally { db?.close() }
}
