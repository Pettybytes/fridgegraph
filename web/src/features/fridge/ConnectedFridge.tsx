import {useContext,useMemo} from 'react'
import {useSession} from '../personas/Session'
import {useChildAccess} from '../personas/childContext'
import {Fridge} from './Fridge'
import {createFridgeReader} from './reader'
import {familyArt} from './packs'
import {FridgeReadContext} from './FridgeReadContext'
import type {FridgeReader} from './model'
export function ConnectedFridge(){
 const {session}=useSession(),access=useChildAccess(),evidenceReader=useContext(FridgeReadContext)
 const reader=useMemo<FridgeReader>(()=>evidenceReader??(access?.client?createFridgeReader(access.client,access.runRead):{read:async()=>({status:'failed'})}),[evidenceReader,access?.client,access?.runRead])
 if(!session||!access)return <p>Choose a perspective to open the fridge.</p>
 const art=familyArt(access.selectedChildId)
 return <Fridge personId={session.persona.personId} childId={access.selectedChildId} generation={session.generation} reader={reader} readOnly={session.marks?.demoGuide} sampleSlots={art.slots} artLabel={art.label}/>
}
