// Offline visual fixture. No live authentication, reset or graph traffic.
import {createRoot} from 'react-dom/client'
import App from '../src/App'
import {createMockAuthAdapter} from '../src/features/personas/auth'
import '../src/index.css'
createRoot(document.getElementById('root')!).render(<><p role="note">UI fixture · reset visual review only</p><App authAdapter={createMockAuthAdapter()}/></>)
