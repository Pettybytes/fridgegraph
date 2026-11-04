import {FridgePreferencesContext,createPreferenceClient} from './preferences'
import {useContext,useMemo} from 'react'
import {useSession} from '../personas/Session'
import {useChildAccess} from '../personas/childContext'
import {FridgePhase2,usePhase2Preview} from './FridgePhase2'
import {createPhase2Service} from './phase2Adapter'
import {FridgeIntake,buildPinIntakeClient} from './FridgeIntake'
import type {FridgeViewer} from './editingContract'
import {createFridgeReader} from './reader'
import {familyArt} from './packs'
import {FridgeReadContext} from './FridgeReadContext'
import {FridgeMediaContext,type MediaReader} from './FridgeMedia'
import type {FridgeReader} from './model'
export function ConnectedFridge(){
 const {session,getCurrentSession,authMode}=useSession(),access=useChildAccess(),evidenceReader=useContext(FridgeReadContext)
 const reader=useMemo<FridgeReader>(()=>evidenceReader??(access?.client?createFridgeReader(access.client,access.runRead):{read:async()=>({status:'unavailable'})}),[evidenceReader,access?.client,access?.runRead])
 const preview=usePhase2Preview()
 // The read-only compatibility probe gates the editors against the deployed schema.
 const verified=true
 const guide=(!!session?.marks?.demoGuide||session?.persona.id==='demo-guide')&&!session?.marks?.showcaseEditor
 const home=access?.selectedChildId===session?.scope.childId
 const viewer=useMemo<FridgeViewer|null>(()=>session?{personId:session.persona.personId,sessionKey:String(session.generation),role:guide?'GUIDE':home&&session.persona.guardian?'GUARDIAN':home&&session.persona.parent?'PARENT':'CAREGIVER'}:null,[session?.persona,session?.generation,guide,home])
 const service=useMemo(()=>viewer&&access?(preview?preview(viewer,access.selectedChildId):access.client?createPhase2Service(access.client,access.runRead,()=>verified):null):null,[preview,viewer,access?.selectedChildId,access?.client,access?.runRead,verified])
 // Live intake (its own bearer); self-gates on the backend readiness probe. Never in preview/evidence.
 const intake=useMemo(()=>guide?<></>:(!preview&&authMode==='live'&&session?.accessToken&&access?.selectedChildId)
  ?<FridgeIntake client={buildPinIntakeClient(()=>getCurrentSession()?.accessToken)} childId={access.selectedChildId} canUse={viewer?.role==='PARENT'||viewer?.role==='GUARDIAN'}/>
  :undefined,[guide,preview,authMode,session?.accessToken,access?.selectedChildId,viewer?.role,getCurrentSession])
 const mediaReader=useMemo<MediaReader>(()=>async(id,signal)=>{
  const token=getCurrentSession()?.accessToken
  if(!token)throw Error('UNAUTHENTICATED')
  const response=await fetch(`/api/rosina/pin/media/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`},signal,cache:'no-store'})
  if(!response.ok)throw Error('MEDIA_UNAVAILABLE')
  return response.blob()
 },[getCurrentSession,session?.generation])
 const preferences=useMemo(()=>preview?null:createPreferenceClient(()=>getCurrentSession()?.accessToken),[preview,getCurrentSession,session?.generation])
 if(!session||!access||!viewer)return <p>Choose a perspective to open the fridge.</p>
 const art=familyArt(access.selectedChildId)
 // Parent/guardian authority is only asserted for the session's own child, never borrowed across children.
 return <FridgePreferencesContext.Provider value={preferences}><FridgeMediaContext.Provider value={mediaReader}><FridgePhase2 key={JSON.stringify([session.generation,session.persona.personId,access.selectedChildId,viewer.role,access.authorized])} enabled={!!preview||verified} service={service} viewer={viewer} fridge={{personId:session.persona.personId,childId:access.selectedChildId,generation:session.generation,reader,readOnly:viewer.role!=='PARENT'&&viewer.role!=='GUARDIAN',sampleSlots:art.slots,artLabel:art.label,artPackId:art.id,albumAssets:art.album,intake}}/></FridgeMediaContext.Provider></FridgePreferencesContext.Provider>
}
