import { EditPage } from './components/EditPage'
import { ReviewPage } from './components/ReviewPage'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyTheme, bootstrapThemeFromQuery } from './lib/theme'
import './styles.css'

if (!bootstrapThemeFromQuery()) applyTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname.startsWith('/edit/') ? <EditPage /> : location.pathname.startsWith('/review/') ? <ReviewPage /> : <App />}
  </StrictMode>
)
