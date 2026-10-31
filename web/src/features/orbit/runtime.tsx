import {createContext,useContext,useEffect,useSyncExternalStore,useState,useRef} from 'react'
import type {ReactNode} from 'react'
import {useSession} from '@/features/personas/Session'
import type {OrbitController} from './controller'
const Context=createContext<OrbitController|null>(null)
export function OrbitProvider({controller,children}:{controller:OrbitController|null;children:ReactNode}){
 const {registerPrivateCleanup}=useSession()
 const attachment=useRef(0)
 useEffect(()=>{
  if(!controller)return
  const owner=++attachment.current
  const unregister=registerPrivateCleanup(controller.dispose)
  void controller.load()
  return()=>{unregister();queueMicrotask(()=>{if(attachment.current===owner)controller.dispose()})}
 },[controller,registerPrivateCleanup])
 return <Context.Provider value={controller}>{children}</Context.Provider>
}
export function useOrbit(){return useContext(Context)}
export function useOrbitState(controller:OrbitController){return useSyncExternalStore(controller.subscribe,controller.getSnapshot)}
// Object URLs are memory-only rendering handles. Never put them in controller state, routes or logs.
export function useOrbitPhoto(controller:OrbitController,id:string|undefined){
 const [image,setImage]=useState<{id:string;url:string}|null>(null),[failed,setFailed]=useState(false)
 useEffect(()=>{
  let active=true,url:string|undefined
  const abort=new AbortController();setFailed(false);setImage(null)
  if(id)void controller.photo(id,abort.signal).then(blob=>{if(active&&controller.current()){url=URL.createObjectURL(blob);setImage({id,url})}},()=>{if(active&&controller.current())setFailed(true)})
  return()=>{active=false;abort.abort();if(url)URL.revokeObjectURL(url)}
 },[controller,id])
 return {url:image&&image.id===id?image.url:undefined,failed}
}
