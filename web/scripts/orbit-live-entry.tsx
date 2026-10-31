// Local acceptance entry: real App, real picker, real services. No fixture data or session injection.
// Only Orbit's overdue derivation sees the scenario instant. Session expiry/auth use Date.now.
import {createRoot} from 'react-dom/client'
import App from '../src/App'
import '../src/index.css'
const scenarioNow=()=>Date.parse('2026-10-31T20:05:00Z')
createRoot(document.getElementById('root')!).render(<App orbitNow={scenarioNow}/>)
