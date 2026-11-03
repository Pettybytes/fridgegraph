import { createRoot } from 'react-dom/client'
import '@/index.css'
import './card-showcase.css'
import { CardShowcase } from './CardShowcase'

// Dev-only showcase on the light Framer-landing canvas (design-v2). Not wired
// into the product router.
createRoot(document.getElementById('root')!).render(<CardShowcase />)
