import {useContext,useMemo} from 'react'
import {useSession} from '../personas/Session'
import {useChildAccess} from '../personas/childContext'
import {FridgePhase2,usePhase2Preview} from './FridgePhase2'
import {createPhase2Service} from './phase2Adapter'
import type {FridgeViewer} from './editingContract'
import {createFridgeReader} from './reader'
import {familyArt} from './packs'
import {FridgeReadContext} from './FridgeReadContext'
import type {FridgeReader} from './model'
export function ConnectedFridge(){
 const {session}=useSession(),access=useChildAccess(),evidenceReader=useContext(FridgeReadContext)
 const reader=useMemo<FridgeReader>(()=>evidenceReader??(access?.client?createFridgeReader(access.client,access.runRead):{read:async()=>({status:'failed'})}),[evidenceReader,access?.client,access?.runRead])
 const preview=usePhase2Preview()
 // Off until the migration + compatible backend have been deployed and verified.
 const verified=import.meta.env.VITE_FRIDGE_EDITING_VERIFIED==='true'
 const guide=!!session?.marks?.demoGuide||session?.persona.id==='demo-guide'
 const home=access?.selectedChildId===session?.scope.childId
 const viewer=useMemo<FridgeViewer|null>(()=>session?{personId:session.persona.personId,sessionKey:String(session.generation),role:guide?'GUIDE':home&&session.persona.guardian?'GUARDIAN':home&&session.persona.parent?'PARENT':'CAREGIVER'}:null,[session?.persona,session?.generation,guide,home])
 const service=useMemo(()=>viewer&&access?(preview?preview(viewer,access.selectedChildId):access.client?createPhase2Service(access.client,access.runRead,()=>verified):null):null,[preview,viewer,access?.selectedChildId,access?.client,access?.runRead,verified])
 if(!session||!access||!viewer)return <p>Choose a perspective to open the fridge.</p>
 const art=familyArt(access.selectedChildId)
 // Parent/guardian authority is only asserted for the session's own child, never borrowed across children.
 return <FridgePhase2 key={JSON.stringify([session.generation,session.persona.personId,access.selectedChildId,viewer.role,access.authorized])} enabled={!!preview||verified} service={service} viewer={viewer} fridge={{personId:session.persona.personId,childId:access.selectedChildId,generation:session.generation,reader,readOnly:guide,sampleSlots:art.slots,artLabel:art.label,artPackId:art.id,albumAssets:art.album}}/>
}
