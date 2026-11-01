// Controlled UI review only. Browser harness intercepts ALL graph/API traffic.
// Never used by the production entry or as a live-service fallback.
import {createRoot} from 'react-dom/client'
import App from '../src/App'
import {createMockAuthAdapter} from '../src/features/personas/auth'
import '../src/index.css'
const base=createMockAuthAdapter(),auth={...base,mode:'live' as const,signInAsPersona:async(id:Parameters<typeof base.signInAsPersona>[0])=>({...await base.signInAsPersona(id),accessToken:'test-only-session',expiresAt:Date.now()/1000+3600,marks:{demo:true,demoGuide:id==='demo-guide'}})}
createRoot(document.getElementById('root')!).render(<><p className="sg-fixture-label">Controlled UI fixture · no live services</p><App authAdapter={auth}/></>)
