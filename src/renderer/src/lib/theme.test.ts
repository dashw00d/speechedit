import { describe, expect, test } from 'bun:test'
import {
  PREFERENCES_EVENT,
  THEME_CHANGE,
  THEME_IDS,
  THEME_META,
  THEMES,
  applyTheme,
  bootstrapThemeFromQuery,
  captionDefaults,
  defaultSpeakerColor,
  isThemeId,
  readStoredTheme,
  stillDefaults,
  subscribeTheme
} from './theme'

const THEME_KEY = 'speechedit:theme'

function withThemeEnv(fn: () => void, search = '') {
  const store = new Map<string, string>()
  const fakeStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    }
  }
  const listeners = new Map<string, Set<EventListener>>()
  const dataset: Record<string, string> = {}
  const windowObj = {
    location: { search },
    addEventListener(type: string, listener: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(listener)
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener)
    },
    dispatchEvent(event: Event) {
      listeners.get(event.type)?.forEach((listener) => listener(event))
      return true
    }
  }
  const prevStorage = (globalThis as { localStorage?: typeof fakeStorage }).localStorage
  const prevDocument = (globalThis as { document?: unknown }).document
  const prevWindow = (globalThis as { window?: unknown }).window
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fakeStorage })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: { dataset } }
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowObj })
  try {
    fn()
  } finally {
    if (prevStorage) Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: prevStorage })
    else delete (globalThis as { localStorage?: unknown }).localStorage
    if (prevDocument) Object.defineProperty(globalThis, 'document', { configurable: true, value: prevDocument })
    else delete (globalThis as { document?: unknown }).document
    if (prevWindow) Object.defineProperty(globalThis, 'window', { configurable: true, value: prevWindow })
    else delete (globalThis as { window?: unknown }).window
  }
}

describe('theme registry', () => {
  test('theme ids are stable', () => {
    expect(THEME_IDS).toEqual(['dashwood', 'party'])
  })

  test('every theme has metadata and js colors', () => {
    for (const id of THEME_IDS) {
      expect(isThemeId(id)).toBe(true)
      expect(THEME_META[id].label.length).toBeGreaterThan(0)
      expect(THEME_META[id].swatch).toHaveLength(3)
      expect(THEMES[id].speakers).toHaveLength(6)
      expect(THEMES[id].captionFill).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(THEMES[id].captionStroke).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(THEMES[id].stillBackground).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(THEMES[id].stillForeground).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  test('js defaults come from the active theme', () => {
    expect(captionDefaults().fill).toBe(THEMES.dashwood.captionFill)
    expect(defaultSpeakerColor()).toBe(THEMES.dashwood.speakers[0])
    expect(stillDefaults().background).toBe(THEMES.dashwood.stillBackground)
    expect(THEMES.party.captionFill).not.toBe(THEMES.dashwood.captionFill)
  })

  test('event names stay stable', () => {
    expect(THEME_CHANGE).toBe('speechedit:theme-change')
    expect(PREFERENCES_EVENT).toBe('speechedit:preferences')
  })

  test('isThemeId rejects unknown values', () => {
    expect(isThemeId('dashwood')).toBe(true)
    expect(isThemeId('party')).toBe(true)
    expect(isThemeId('neon')).toBe(false)
    expect(isThemeId('')).toBe(false)
  })

  test('applyTheme persists, sets data-theme, and notifies listeners', () => {
    withThemeEnv(() => {
      const seen: string[] = []
      const stop = subscribeTheme((id) => seen.push(id))
      applyTheme('party')
      expect(document.documentElement.dataset.theme).toBe('party')
      expect(localStorage.getItem(THEME_KEY)).toBe('party')
      expect(readStoredTheme()).toBe('party')
      expect(captionDefaults().fill).toBe(THEMES.party.captionFill)
      expect(defaultSpeakerColor()).toBe(THEMES.party.speakers[0])
      expect(seen).toEqual(['party'])
      applyTheme('party')
      expect(seen).toEqual(['party'])
      stop()
    })
  })

  test('bootstrapThemeFromQuery applies a valid ?theme= and ignores junk', () => {
    withThemeEnv(() => {
      expect(bootstrapThemeFromQuery()).toBe('party')
      expect(readStoredTheme()).toBe('party')
      expect(document.documentElement.dataset.theme).toBe('party')
    }, '?theme=party')
    withThemeEnv(() => {
      expect(bootstrapThemeFromQuery()).toBeUndefined()
      expect(readStoredTheme()).toBe('dashwood')
    }, '?theme=neon')
  })
})
