// Local visual fixture only. Names/relationships taken from the supplied fictional seed.
// Real routes use delivered bearer-scoped reads, never these controlled records.
import {createRoot} from 'react-dom/client'
import {useState} from 'react'
import {VillageRings} from '../src/components/signature/VillageRings'
import {portraitFor} from '../src/components/fg/portraits'
import '../src/index.css'
const records=[{id:'p_mom',name:'Kendra Ellison',relationship:'parent',group:'Family'},{id:'p_dad',name:'Andre Ellison',relationship:'parent',group:'Family'},{id:'p_gma',name:'Loretta Brooks',relationship:'grandmother',group:'Family'},{id:'p_bryan',name:'Bryan Brooks',relationship:'uncle',group:'Family'},{id:'p_tasha',name:'Tasha Ellison',relationship:'aunt, godmother',group:'Family'},{id:'p_walter',name:'Walter Ellison',relationship:'grandfather',group:'Family'},{id:'p_priya',name:'Priya Nair',relationship:'sitter',group:'Care'}]
function Review(){const [compact,setCompact]=useState(false);return <main style={{maxWidth:1100,margin:'0 auto',padding:'32px 24px',color:'var(--fg-ink)'}}><p>Controlled visual fixture · fictional seed records</p><h1 style={{fontSize:32,margin:'16px 0'}}>A village around Nora.</h1><button style={{minHeight:44,marginBottom:24}} onClick={()=>setCompact(!compact)}>Switch composition</button><VillageRings child={{id:'p_nora',name:'Nora Ellison',portraitSrc:portraitFor({personId:'p_nora'})}} people={records.map(person=>({...person,portraitSrc:portraitFor({personId:person.id})}))} variant={compact?'compact':'full'} onOpenVillage={()=>{location.hash='#/village'}}/></main>}
createRoot(document.getElementById('root')!).render(<Review/> )
