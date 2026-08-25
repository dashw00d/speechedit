import { fileName } from './projectDocument'

export interface RecentDocument {
  path: string
  name: string
  savedAt: number
}

const KEY = 'speechedit:recents'
export const RECENTS_LIMIT = 8

export function canReopenRecent(path: string): boolean {
  return /[/\\]/.test(path) && !/^(blob:|https?:|data:)/i.test(path)
}

export function recentWhen(savedAt: number, now = Date.now()): string {
  if (!savedAt) return 'Saved reel'
  const days = Math.round((now - savedAt) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(savedAt).toLocaleDateString()
}

export function listRecents(raw?: string | null): RecentDocument[] {
  try {
    const text = raw ?? (typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY))
    if (!text) return []
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const rec = item as Partial<RecentDocument>
        if (typeof rec.path !== 'string' || !rec.path) return []
        return [
          {
            path: rec.path,
            name: rec.name || fileName(rec.path) || rec.path,
            savedAt: Number(rec.savedAt) || 0
          }
        ]
      })
      .filter((item) => canReopenRecent(item.path))
      .slice(0, RECENTS_LIMIT)
  } catch {
    return []
  }
}

export function rememberRecent(
  path: string,
  name?: string,
  savedAt = Date.now(),
  existing?: RecentDocument[]
): RecentDocument[] {
  if (!canReopenRecent(path)) return existing ?? listRecents()
  const next = [
    { path, name: name || fileName(path) || path, savedAt },
    ...(existing ?? listRecents()).filter((item) => item.path !== path)
  ].slice(0, RECENTS_LIMIT)
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* quota */
    }
  }
  return next
}

export function forgetRecent(path: string, existing?: RecentDocument[]): RecentDocument[] {
  const next = (existing ?? listRecents()).filter((item) => item.path !== path)
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* quota */
    }
  }
  return next
}
