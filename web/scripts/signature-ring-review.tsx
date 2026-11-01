// Controlled visual review only; never imported by an app route. No network or authentication.
import {createRoot} from 'react-dom/client'
import {useState} from 'react'
import {OrbitRollCall} from '../src/components/signature/OrbitRollCall'
import {ActivityLedger} from '../src/components/signature/activityLedger'
import type {Alert} from '../src/features/orbit/adapter'
import {portraitFor} from '../src/components/fg/portraits'
import '../src/index.css'
import '../src/components/fg/fg.css'
const ledger=new ActivityLedger()
const record:Alert={id:'controlled',child:{id:'p_nora'},status:'ACTIVE',message:'Controlled visual fixture',share:{photoId:null},activatedAt:null,closedAt:null,guidance:'If there is an emergency, call 911.',responses:[],latestResponses:[],audience:[{person:{id:'p_gma',displayName:'Loretta Brooks'},eligible:true},{person:{id:'p_dad',displayName:'Andre Ellison'},eligible:true},{person:{id:'p_priya',displayName:'Priya Nair'},eligible:true}]}
function Review(){const [alert,setAlert]=useState(record),[parent,setParent]=useState(true);return <main style={{maxWidth:1100,margin:'0 auto',padding:24}}><p>Controlled visual fixture · no live requests</p><button onClick={()=>setParent(!parent)}>Switch authorized view</button><button onClick={()=>setAlert({...record,latestResponses:[{person:{id:'p_gma',displayName:'Loretta Brooks'},response:'ON_WAY',respondedAt:'2026-10-31T20:05:00Z'}]})}>Apply controlled persisted response</button><OrbitRollCall alert={alert} child={{id:'p_nora',name:'Nora Ellison',portraitSrc:portraitFor({personId:'p_nora'})}} parent={parent} personId={parent?'p_mom':'p_gma'} ledger={ledger} portraitFor={id=>portraitFor({personId:id})}/></main>}
createRoot(document.getElementById('root')!).render(<Review/> )
