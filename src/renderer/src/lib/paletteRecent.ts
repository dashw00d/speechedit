const KEY = 'speechedit:palette-recent'
const LIMIT = 8

export function readPaletteRecents(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string').slice(0, LIMIT) : []
  } catch {
    return []
  }
}

export function rememberPaletteCommand(name: string) {
  if (typeof localStorage === 'undefined') return
  const next = [name, ...readPaletteRecents().filter((item) => item !== name)].slice(0, LIMIT)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* quota */
  }
}
