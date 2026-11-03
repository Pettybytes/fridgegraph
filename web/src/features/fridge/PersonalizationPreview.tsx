// Offline evidence only. Never imported by the production route.
import {createRoot} from 'react-dom/client'
import {useMemo} from 'react'
import App from '@/App'
import {createMockAuthAdapter} from '../personas/auth'
import {FridgeReadContext} from './FridgeReadContext'
import {FridgePhase2Preview,type Phase2PreviewFactory} from './FridgePhase2'
import {mockFridgeEditingAdapter,sampleGoals,sampleNotes} from './mockEditingAdapter'
import type {FridgeReader} from './model'
import '../../index.css'
const reader:FridgeReader={read:async(source,child)=>source==='goals'&&child==='p_nora'?{status:'ready',value:sampleGoals}:{status:'empty'}}
function Preview(){
 const auth=useMemo(()=>createMockAuthAdapter(),[])
 const factory=useMemo<Phase2PreviewFactory>(()=>(viewer,child)=>({check:async()=>({kind:'ready'}),adapter:mockFridgeEditingAdapter(child==='p_nora'?sampleGoals:[],child==='p_nora'&&viewer.role!=='GUIDE'?sampleNotes:[],{id:viewer.personId,displayName:'Preview author'})}),[])
 return <><aside className="fridge-proof-banner" style={{padding:12,background:'#fff3c9',color:'#312c20'}}>Offline preview · sample records. No changes are saved.</aside><FridgeReadContext.Provider value={reader}><FridgePhase2Preview.Provider value={factory}><App authAdapter={auth}/></FridgePhase2Preview.Provider></FridgeReadContext.Provider></>
}
createRoot(document.getElementById('root')!).render(<Preview/>)
