import {useMemo} from 'react'
import {useSession} from '../personas/Session'
import {useChildAccess} from '../personas/childContext'
import {useOrbit} from '../orbit/runtime'
import {Fridge} from './Fridge'
import {createFridgeReader} from './reader'
import type {FridgeReader} from './model'
// Ready for the later authorized route mount. No provider, route, or app entry is changed here.
export function ConnectedFridge(){
 const {session}=useSession(),access=useChildAccess(),orbit=useOrbit()
 const reader=useMemo<FridgeReader>(()=>access?.client?createFridgeReader(access.client,access.runRead,orbit):{read:async()=>({status:'failed'})},[access?.client,access?.runRead,orbit])
 if(!session||!access)return <p>Choose a perspective to open the fridge.</p>
 return <Fridge personId={session.persona.personId} childId={access.selectedChildId} generation={session.generation} reader={reader} readOnly={session.marks?.demoGuide}/>
}
