import type { Asset } from '../types'

type StoredBrowserMedia = {
  key: string
  blob: Blob
  name: string
  type: string
  lastModified: number
}

type LiveBrowserMedia = {
  file: File
  key: string
}

type BrowserMediaState = {
  byUrl: Map<string, LiveBrowserMedia>
  urlByKey: Map<string, string>
}

const DATABASE = 'speechedit-browser-media'
const STORE = 'files'
const STATE_KEY = '__speecheditBrowserMediaState'

const root = globalThis as typeof globalThis & { [STATE_KEY]?: BrowserMediaState }
const live = root[STATE_KEY] ?? { byUrl: new Map(), urlByKey: new Map() }
root[STATE_KEY] = live

function mediaKey(file: File): string {
  return `v1:${file.lastModified}:${file.size}:${encodeURIComponent(file.name)}`
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Browser media storage did not open.'))
  })
}

async function putMedia(row: StoredBrowserMedia): Promise<void> {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put(row)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Browser media storage failed.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Browser media storage was interrupted.'))
    })
  } finally {
    database.close()
  }
}

async function getMedia(key: string): Promise<StoredBrowserMedia | null> {
  if (typeof indexedDB === 'undefined') return null
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      request.onsuccess = () => resolve((request.result as StoredBrowserMedia | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error('Browser media could not be restored.'))
    })
  } finally {
    database.close()
  }
}

function mount(file: File, key: string): string {
  const current = live.urlByKey.get(key)
  if (current && live.byUrl.has(current)) return current
  const url = URL.createObjectURL(file)
  live.byUrl.set(url, { file, key })
  live.urlByKey.set(key, url)
  return url
}

export async function registerBrowserMedia(file: File): Promise<string> {
  const key = mediaKey(file)
  const url = mount(file, key)
  if (typeof indexedDB !== 'undefined') {
    await putMedia({ key, blob: file, name: file.name, type: file.type, lastModified: file.lastModified }).catch(
      () => undefined
    )
    void navigator.storage?.persist?.().catch(() => false)
  }
  return url
}

export function browserMediaForPath(path: string): File | undefined {
  return live.byUrl.get(path)?.file
}

export function browserMediaKeyForPath(path: string): string | undefined {
  return live.byUrl.get(path)?.key
}

async function restoreKey(key: string): Promise<string | null> {
  const current = live.urlByKey.get(key)
  if (current && live.byUrl.has(current)) return current
  const stored = await getMedia(key).catch(() => null)
  if (!stored?.blob) return null
  const file = new File([stored.blob], stored.name, {
    type: stored.type,
    lastModified: stored.lastModified
  })
  return mount(file, key)
}

export async function remountBrowserAssets(assets: ProjectAssets): Promise<{ assets: ProjectAssets; restored: number }> {
  let restored = 0
  let changed = false
  const next = { ...assets }
  for (const asset of Object.values(next)) {
    if (!asset.browserMediaKey) continue
    const path = await restoreKey(asset.browserMediaKey)
    if (!path || path === asset.path) continue
    next[asset.id] = { ...asset, path, proxyPath: undefined }
    restored += 1
    changed = true
  }
  return { assets: changed ? next : assets, restored }
}

type ProjectAssets = Record<string, Asset>
