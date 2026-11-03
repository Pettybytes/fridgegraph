import { createRoot } from 'react-dom/client'
import '@/index.css'
import './card-showcase.css'
import { CardShowcase } from './CardShowcase'

// Dev-only showcase: force the dark canvas so the card family is reviewed as it
// will ship. Not wired into the product router.
document.documentElement.classList.add('dark')
createRoot(document.getElementById('root')!).render(<CardShowcase />)
