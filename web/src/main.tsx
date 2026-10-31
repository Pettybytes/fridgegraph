import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Dev-only recording focus mode (?focus): centres a single zoomed column with the app
// chrome hidden, so body text clears 16px at 1280×720. Styling in index.css [data-focus].
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('focus')) {
  document.documentElement.dataset.focus = '1'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
