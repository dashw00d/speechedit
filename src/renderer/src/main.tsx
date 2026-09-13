import { ReviewPage } from './components/ReviewPage'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { applyTheme, bootstrapThemeFromQuery } from './lib/theme'
import './styles.css'

const App = lazy(() => import('./App').then(m => ({ default: m.App })))
const EditPage = lazy(() => import('./components/EditPage').then(m => ({ default: m.EditPage })))

if (!bootstrapThemeFromQuery()) applyTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<p role="status">Opening SpeechEdit…</p>}>
    {location.pathname.startsWith('/edit/') ? <EditPage /> : location.pathname.startsWith('/review/') ? <ReviewPage /> : <App />}
    </Suspense>
  </StrictMode>
)
