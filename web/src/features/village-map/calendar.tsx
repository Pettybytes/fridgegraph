import {useEffect,useMemo,useState,type ReactNode} from 'react'
import {FamilyCalendar} from '@/features/calendar/FamilyCalendar'
import type {CalendarAdapter,CalendarChild,CalendarEvent} from '@/features/calendar/types'
import type {MapWorld} from './types'
import {useVillageMap,useMapState} from './runtime'
import type {MapController} from './controller'
// Explicit sample calendar projection: never inserted into the live calendar adapter.
export function mapCalendar(world:MapWorld):CalendarAdapter{
 const person=world.people.find(p=>p.id==='p_nora')
 const child:CalendarChild|undefined=person?{id:person.id,displayName:person.name,authority:world.canApprove?'parent':'schedule.read'}:undefined
 const events:CalendarEvent[]=child?world.events.filter(event=>event.peopleIds.includes(child.id)).map(event=>({id:event.id,child,title:event.title,category:event.id.startsWith('soccer-')?'PRACTICE':'PARENTING_HANDOFF',status:event.status,start:event.at,end:event.end,participants:event.peopleIds.flatMap(id=>{const p=world.people.find(p=>p.id===id);return p?[{id:p.id,displayName:p.name}]:[]}),location:world.places.some(p=>p.id===event.placeId)?{state:'visible',value:world.places.find(p=>p.id===event.placeId)!.name}:{state:'missing'},confirmedBy:{state:'missing'},confirmedAt:{state:'missing'},linkedRecords:{state:'missing'},attention:event.status==='PROPOSED'?['Unconfirmed']:[]})):[]
 return {mode:'mock',listChildren:async()=>child?[child]:[],readCalendar:async({childId,from,to})=>{if(!child||childId!==child.id)throw Error('UNAUTHORIZED');return{state:'mock',child,events:events.filter(e=>e.start.slice(0,10)>=from&&e.start.slice(0,10)<=to),weeklySchedule:[],holidayArrangements:[],busy:[]}},readEvent:async(id)=>{const event=events.find(e=>e.id===id);if(!event)throw Error('UNAUTHORIZED');return event}}
}
export function MapCalendarBridge({children}:{children:ReactNode}){const controller=useVillageMap();return controller?<Bridge controller={controller}>{children}</Bridge>:children}
function Bridge({controller,children}:{controller:MapController;children:ReactNode}){
 const state=useMapState(controller),[hash,setHash]=useState(location.hash)
 useEffect(()=>{const change=()=>{setHash(location.hash);const query=new URLSearchParams(location.hash.split('?')[1]);if(query.get('sampleMap')==='1'&&query.get('day'))controller.setDay(query.get('day')!)};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change)},[controller])
 const adapter=useMemo(()=>state.world?mapCalendar(state.world):null,[state.world])
 if(new URLSearchParams(hash.split('?')[1]).get('sampleMap')!=='1')return children
 return adapter?<><p className="persona-mock">Sample data · shared with the Village map scenario</p><a href={`#/map?day=${state.day}`}>Back to Village map</a><FamilyCalendar adapter={adapter}/></>:<p>This isn't shared with you.</p>
}
