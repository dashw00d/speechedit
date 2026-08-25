import { useEffect, useState } from 'react'
import {
  activeThemeId,
  applyTheme,
  subscribeTheme,
  THEME_IDS,
  THEME_META,
  type ThemeId
} from '../lib/theme'

export function ThemePreferences() {
  const [theme, setTheme] = useState<ThemeId>(() => activeThemeId())

  useEffect(() => subscribeTheme(setTheme), [])

  return (
    <section className="helper-section">
      <h3 className="helper-section-title">Appearance</h3>
      <div className="theme-cards" role="radiogroup" aria-label="Theme">
        {THEME_IDS.map((id) => {
          const meta = THEME_META[id]
          const on = theme === id
          return (
            <button
              key={id}
              type="button"
              className="theme-card"
              role="radio"
              aria-checked={on}
              data-on={on || undefined}
              onClick={() => {
                applyTheme(id)
                setTheme(id)
              }}
            >
              <span className="theme-card-swatches" aria-hidden="true">
                {meta.swatch.map((color) => (
                  <span key={color} className="theme-card-swatch" style={{ background: color }} />
                ))}
              </span>
              <span className="theme-card-copy">
                <strong>{meta.label}</strong>
                <span>{meta.blurb}</span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
