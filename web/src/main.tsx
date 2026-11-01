import {orbitDestination} from './features/orbit/deepLink'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const orbitLink=orbitDestination(location.pathname,location.search)
if(orbitLink)location.hash=orbitLink

// Dev-only recording focus mode (?focus): centres a single zoomed column with the app
// chrome hidden, so body text clears 16px at 1280×720. Styling in index.css [data-focus].
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('focus')) {
  document.documentElement.dataset.focus = '1'
}

// Dev-only PhoneFrame showcase at #/_showcase — never in production nav, never inside a
// persona session (no real data), lazily imported so it is tree-shaken from production.
function mount() {
  const root = createRoot(document.getElementById('root')!)
  if (import.meta.env.DEV && window.location.hash.startsWith('#/_showcase')) {
    void import('./showcase/PhoneShowcase.tsx').then(({ PhoneShowcase }) => {
      root.render(<StrictMode><PhoneShowcase /></StrictMode>)
    })
    return
  }
  root.render(<StrictMode><App /></StrictMode>)
}
mount()
