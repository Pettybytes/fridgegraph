import {flushSync} from 'react-dom'
import {createContext,useContext,useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react'
import {Dialog} from 'radix-ui'
import {useReducedMotion} from './useMapReducedMotion'
import {useSession} from '@/features/personas/Session'
import {personPoint} from './model'
import {MapController} from './controller'
import {createMockMapAdapter} from './mockAdapter'
const Context=createContext<MapController|null>(null)
export const useVillageMap=()=>useContext(Context)
export const useMapState=(controller:MapController)=>useSyncExternalStore(controller.subscribe,controller.getSnapshot)
export function expandMap(){if(location.hash.split('?')[0]==='#/map')return;const go=()=>{flushSync(()=>{location.hash='#/map';window.dispatchEvent(new HashChangeEvent('hashchange'))})};if(document.startViewTransition&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.startViewTransition(go);else go()}
export function VillageMapProvider({children}:{children:ReactNode}){
 const {session,registerPrivateCleanup}=useSession()
 const controller=useMemo(()=>session?new MapController(createMockMapAdapter(session.persona.id)):null,[session?.generation])
 const attachment=useRef(0),latest=useRef(controller);latest.current=controller
 useEffect(()=>{if(!controller)return;const owner=++attachment.current;void controller.load();const remove=registerPrivateCleanup(controller.dispose);return()=>{remove();queueMicrotask(()=>{if(latest.current!==controller||attachment.current===owner)controller.dispose()})}},[controller,registerPrivateCleanup])
 return <Context.Provider value={controller}>{controller&&<ReplayClock controller={controller}/>} {children}{controller&&<ProposalConfirm controller={controller}/>}</Context.Provider>
}
function ReplayClock({controller}:{controller:MapController}){
 const state=useMapState(controller),reduced=useReducedMotion()
 useEffect(()=>{if(reduced&&state.playing){controller.pause();return}if(!state.playing)return;let handle=0,last=performance.now();const tick=(now:number)=>{if(!document.hidden)controller.tick(Math.min(250,now-last));last=now;handle=requestAnimationFrame(tick)};handle=requestAnimationFrame(tick);return()=>cancelAnimationFrame(handle)},[controller,state.playing,reduced]);return null
}
export function RideCost({controller}:{controller:MapController}){
 const state=useMapState(controller),ride=state.route?.rideEstimate;if(!ride)return null
 return <div className="vm-ride"><strong>Rideshare to school · Est. ${ride.amountUsd.toFixed(2)}</strong><p>No vehicle on record. Paid-ride path in this sample scenario.</p><p>{ride.amountUsd>ride.capUsd?'Over':'Within'} {state.world?.parentName}'s ${ride.capUsd.toFixed(0)} ride limit</p><small>{ride.basis}</small></div>
}
function ProposalConfirm({controller}:{controller:MapController}){
 const state=useMapState(controller),[open,setOpen]=useState(false)
 useEffect(()=>{const review=()=>setOpen(true);window.addEventListener('map:review-proposal',review);return()=>window.removeEventListener('map:review-proposal',review)},[])
 useEffect(()=>{if(state.proposal!=='review')setOpen(false)},[state.proposal])
 const ride=state.route?.rideEstimate,over=!!ride&&ride.amountUsd>ride.capUsd
 return <Dialog.Root open={open&&state.proposal==='review'} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="vm-confirm-backdrop"/><Dialog.Content className="vm-confirm fg-glass"><Dialog.Title>Review pickup proposal</Dialog.Title><Dialog.Description>Sample proposal only. This does not assign a caregiver, contact anyone or book a ride.</Dialog.Description><p>{state.world?.people.find(p=>p.id===state.route?.fromId)?.name} → {state.world?.places.find(p=>p.id===state.route?.toId)?.name}</p><RideCost controller={controller}/>{over&&<label><input type="checkbox" checked={state.acceptedOverCap} onChange={e=>controller.acceptOverCap(e.target.checked)}/>I explicitly accept this sample option above the ride limit.</label>}<button disabled={!state.world?.canApprove||(over&&!state.acceptedOverCap)} onClick={()=>{if(controller.approve())setOpen(false)}}>Approve sample proposal</button>{!state.world?.canApprove&&<p>Only an authorized parent can approve.</p>}<Dialog.Close>Keep reviewing</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
}
export function MapRosinaContext(){const controller=useVillageMap();return controller?<MapContextCard controller={controller}/>:null}
function MapContextCard({controller}:{controller:MapController}){
 const state=useMapState(controller),[route,setRoute]=useState(location.hash);useEffect(()=>{const onHash=()=>setRoute(location.hash);window.addEventListener('hashchange',onHash);return()=>window.removeEventListener('hashchange',onHash)},[])
 if(!route.startsWith('#/map')&&state.proposal!=='review')return null
 const s=state.selection,w=state.world,label=s?.kind==='person'?w?.people.find(p=>p.id===s.id)?.name:s?.kind==='place'?w?.places.find(p=>p.id===s.id)?.name:w?.events.find(p=>p.id===s?.id)?.title
 const restricted=!!s&&!!w&&(s.kind==='person'?!personPoint(w.people.find(p=>p.id===s.id)!,w):s.kind==='place'?!w.places.find(p=>p.id===s.id)?.point:!w.places.find(p=>p.id===w.events.find(e=>e.id===s.id)?.placeId)?.point)
 return <section className="vm-rosina-context" aria-label="Map context"><small>{w?.state==='live'?'Map context':'Sample map context'}</small><h3>{label??'Your village, on the map'}</h3><p>No live locations. Dragging only requests a route estimate.</p><button disabled={restricted} onClick={()=>{expandMap();controller.follow();if(innerWidth<1250)window.dispatchEvent(new Event('rosina:close'))}}>Show on map</button>{restricted&&<p>Location restricted. This record appears in the list only.</p>}{state.proposal==='review'&&<><p>Pickup proposal ready for parent review.</p><RideCost controller={controller}/><button onClick={()=>window.dispatchEvent(new Event('map:review-proposal'))}>Review pickup proposal</button><a href="#/mission-control" onClick={()=>window.dispatchEvent(new Event('rosina:close'))}>Review in Mission Control</a></>}</section>
}
