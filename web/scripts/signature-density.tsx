// Synthetic stress records, never imported by production routes. No live requests.
import {createRoot} from 'react-dom/client'
import {VillageRings} from '../src/components/signature/VillageRings'
import '../src/index.css'
import '../src/components/fg/fg.css'
const long=new URLSearchParams(location.search).has('long')
const people=Array.from({length:30},(_,i)=>({id:`stress-${i}`,name:long?`Alexandria-Rosamund Fernández-Castellano ${i}`:`Authorized person ${i}`,relationship:i<10?'household member':i<20?'grandparent':'school activity contact',group:i<10?'Household':i<20?'Family':'School & activities'}))
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1100,margin:'auto',padding:24}}><p>Controlled dense fixture — 30 authorized people</p><VillageRings child={{id:'stress-child',name:long?'Alexandria-Rosamund Fernández-Castellano':'Selected child'}} people={people}/></main>)
