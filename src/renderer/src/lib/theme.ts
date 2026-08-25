/** JS-facing theme registry — keep in sync with themes/*.css */

export const THEME_IDS = ['dashwood', 'party'] as const
export type ThemeId = (typeof THEME_IDS)[number]

export const DEFAULT_THEME: ThemeId = 'dashwood'
const THEME_KEY = 'speechedit:theme'
export const THEME_CHANGE = 'speechedit:theme-change'
export const PREFERENCES_EVENT = 'speechedit:preferences'

export function openPreferences() {
  window.dispatchEvent(new Event(PREFERENCES_EVENT))
}

export interface ThemeJs {
  speakers: readonly [string, string, string, string, string, string]
  captionFill: string
  captionStroke: string
}

export interface ThemeMeta {
  label: string
  blurb: string
  /** paper / accent / ink */
  swatch: readonly [string, string, string]
}

export const THEME_META: Record<ThemeId, ThemeMeta> = {
  dashwood: {
    label: 'Dashwood',
    blurb: 'Sand desk — navy type, teal→navy actions.',
    swatch: ['#FBF6ED', '#036564', '#011725']
  },
  party: {
    label: 'Party',
    blurb: 'Editorial paper — espresso ink, purple accent.',
    swatch: ['#F2EADB', '#8452A1', '#1B130D']
  }
}

export const THEME_LABELS: Record<ThemeId, string> = {
  dashwood: THEME_META.dashwood.label,
  party: THEME_META.party.label
}

export const THEMES: Record<ThemeId, ThemeJs> = {
  dashwood: {
    speakers: ['#B02E2E', '#417094', '#2B7E72', '#D88D2A', '#036564', '#B69563'],
    captionFill: '#FBF6ED',
    captionStroke: '#011725'
  },
  party: {
    speakers: ['#8452A1', '#6B4283', '#478466', '#8A5A1F', '#3A2E23', '#B290C1'],
    captionFill: '#F2EADB',
    captionStroke: '#1B130D'
  }
}

export function isThemeId(value: string): value is ThemeId {
  return (THEME_IDS as readonly string[]).includes(value)
}

export function readStoredTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored && isThemeId(stored)) return stored
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME
}

export function activeThemeId(): ThemeId {
  if (typeof document === 'undefined') return DEFAULT_THEME
  const id = document.documentElement.dataset.theme
  return id && isThemeId(id) ? id : readStoredTheme()
}

function activeJs(): ThemeJs {
  return THEMES[activeThemeId()]
}

export function applyTheme(id: ThemeId = readStoredTheme()) {
  const prev =
    typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined
  document.documentElement.dataset.theme = id
  try {
    localStorage.setItem(THEME_KEY, id)
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && prev !== id) {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE, { detail: id }))
  }
}

export function subscribeTheme(listener: (id: ThemeId) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ThemeId>).detail
    if (detail && isThemeId(detail)) listener(detail)
  }
  window.addEventListener(THEME_CHANGE, handler)
  return () => window.removeEventListener(THEME_CHANGE, handler)
}

/** Boot from ?theme=party — used by index.html before React mounts. */
export function bootstrapThemeFromQuery(): ThemeId | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const query = new URLSearchParams(window.location.search).get('theme')
    if (!query || !isThemeId(query)) return undefined
    applyTheme(query)
    return query
  } catch {
    return undefined
  }
}

export function defaultSpeakerColor() {
  return speakerPalette()[0]
}

export function captionDefaults() {
  const js = activeJs()
  return { fill: js.captionFill, stroke: js.captionStroke }
}

/** @deprecated use speakerPalette() / defaultSpeakerColor() */
export const SPEAKER_PALETTE = THEMES.dashwood.speakers
/** @deprecated use defaultSpeakerColor() — snapshot of Dashwood for old fixtures */
export const DEFAULT_SPEAKER_COLOR = THEMES.dashwood.speakers[0]
/** @deprecated use captionDefaults().fill */
export const DEFAULT_CAPTION_FILL = THEMES.dashwood.captionFill
/** @deprecated use captionDefaults().stroke */
export const DEFAULT_CAPTION_STROKE = THEMES.dashwood.captionStroke

export function speakerPalette() {
  return activeJs().speakers
}

export function speakerColor(
  speakers: { id: string; color?: string }[],
  speakerId: string
): string {
  return speakers.find((s) => s.id === speakerId)?.color ?? activeJs().speakers[0]
}
