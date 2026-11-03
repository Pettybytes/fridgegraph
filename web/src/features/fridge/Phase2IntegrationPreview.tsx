// Offline evidence entry. Never imported by the production app.
import {createRoot} from 'react-dom/client'
import {useMemo,useState} from 'react'
import App from '@/App'
import {createMockAuthAdapter} from '../personas/auth'
import {FridgeReadContext} from './FridgeReadContext'
import {FridgePhase2Preview,type Phase2PreviewFactory} from './FridgePhase2'
import {mockFridgeEditingAdapter,sampleGoals,sampleNotes} from './mockEditingAdapter'
import type {Compatibility} from './phase2Adapter'
import type {FridgeReader} from './model'
import '../../index.css'
const phase1:FridgeReader={read:async source=>source==='care'?{status:'empty'}:{status:'ready',value:sampleGoals.filter(goal=>goal.status==='APPROVED').map(({id,title,horizon,status})=>({id,title,horizon,status}))}}
function Preview(){
 const auth=useMemo(()=>createMockAuthAdapter(),[])
 const [mode,setMode]=useState('ready')
 const factory=useMemo<Phase2PreviewFactory>(()=>(viewer)=>{
  const parent=viewer.role==='PARENT'||viewer.role==='GUARDIAN'
  const notes=sampleNotes.map(note=>({...note,author:{...note.author,id:note.id==='note_kendra'?viewer.personId:'other-author'}}))
  const adapter=mockFridgeEditingAdapter(parent?sampleGoals:sampleGoals.filter(goal=>goal.status==='APPROVED'),parent?notes:[])
  const post=adapter.postFridgeNote;adapter.postFridgeNote=async args=>({...await post(args),author:{id:viewer.personId,displayName:'Mock author'}})
  if(!parent)adapter.readNotes=async()=>{throw Error('UNAUTHORIZED')}
  if(mode==='read-database')adapter.readGoals=async()=>{throw Error('DB_UNAVAILABLE')}
  if(mode==='save-failed')adapter.createGoal=async()=>{throw Error('NETWORK_ERROR')}
  return {adapter,check:async()=>({kind:mode==='read-database'||mode==='save-failed'?'ready':mode as Compatibility['kind']}) as Compatibility}
 },[mode])
 return <><aside className="fridge-proof-banner" style={{fontSize:12,padding:12,position:'sticky',top:0,zIndex:120,background:'#fff3c9',color:'#312c20'}}>Mock data · no records written <select aria-label="Preview capability" value={mode} onChange={e=>setMode(e.target.value)}>{['ready','absent','authentication','refused','network','database','failed','read-database','save-failed'].map(value=><option key={value}>{value}</option>)}</select></aside><FridgeReadContext.Provider value={phase1}><FridgePhase2Preview.Provider value={factory}><App authAdapter={auth}/></FridgePhase2Preview.Provider></FridgeReadContext.Provider></>
}
createRoot(document.getElementById('root')!).render(<Preview/> )
