// Explicit visual fixture only: no live session, service call or photo rendering handle.
import {useEffect,useMemo} from 'react'
import {createRoot} from 'react-dom/client'
import '../src/index.css'
import {Shell} from '../src/app/Shell'
import {SessionProvider,useSession} from '../src/features/personas/Session'
import {createMockAuthAdapter} from '../src/features/personas/auth'
import {createPersonaDataAdapter} from '../src/features/personas/personaData'
import {DataProvider} from '../src/lib/frontendData/provider'
import {OrbitView} from '../src/features/orbit/Orbit'
import {OrbitController} from '../src/features/orbit/controller'
import type {OrbitAdapter} from '../src/features/orbit/adapter'
const guidance='If a child is missing or in danger, call 911 immediately. Orbit notifies your approved village; it does not replace emergency services.'
const fixture:OrbitAdapter={check:async()=>({recorded:false,label:'4:00 check-in',text:'check-in not recorded',dueAt:'2026-10-30T20:00:00Z',guidance}),vocabulary:async()=>[{kind:'WEAR_COLOR',value:'yellow',version:1},{kind:'WEAR_GARMENT',value:'raincoat',version:1},{kind:'HAIR',value:'brown',version:1},{kind:'CARRY_COLOR',value:'green',version:1},{kind:'CARRY_ITEM',value:'backpack',version:1}],status:async()=>({alertId:null,status:null,audienceCount:0,notifiedCount:0,latestResponses:[],guidance}),alert:async()=>null,draft:async()=>({draftId:'oa_fixture',draftVersion:1,status:'PENDING_ACTIVATION',guidance}),preview:async()=>({draftId:'oa_fixture',draftVersion:1,message:'FridgeGraph Orbit: check-in not recorded for Nora. Wearing: yellow raincoat. Hair: brown. Carrying: green backpack. Reply WITH_ME, ON_WAY, or CANNOT_HELP.',messageHash:'fixture-binding',audienceSize:3,guidance}),activate:async()=>{throw Error('Visual fixture only')},respond:async()=>{},close:async()=>{throw Error('Visual fixture only')},upload:async()=>{throw Error('Visual fixture only')},photo:async()=>{throw Error('Visual fixture only')}}
function Design(){const {session,switchPerson,getSessionGeneration}=useSession();useEffect(()=>{queueMicrotask(()=>{void switchPerson('kendra')})},[]);const controller=useMemo(()=>session?new OrbitController(fixture,{childId:session.scope.childId,personId:session.persona.personId,parent:true,readOnly:false,generation:session.generation},getSessionGeneration):null,[session,getSessionGeneration]);useEffect(()=>{if(controller)void controller.load().then(()=>controller.prepare({childId:'p_nora',wearColor:'yellow',wearGarment:'raincoat',hair:'brown',carryColor:'green',carryItem:'backpack'}))},[controller]);if(!session||!controller)return <p>Loading UI fixture…</p>;return <><p style={{padding:'.5rem 1rem',fontSize:'.8rem',background:'#f0ebf6',textAlign:'center'}} data-state="unavailable">UI fixture · visual review only</p><DataProvider scope={session.scope} adapter={createPersonaDataAdapter(session)}><Shell slots={{orbit:<OrbitView controller={controller}/>}}/></DataProvider></>}
location.hash='#/orbit';createRoot(document.getElementById('root')!).render(<SessionProvider adapter={createMockAuthAdapter()}><Design/></SessionProvider>)
