import {createContext,useContext,useEffect,useRef,useState} from 'react'
import type {Position,MarkerStyle} from './model'
export type Preference={kind:'art'|'note'|'goal';itemId:string;position:Position|null;color:MarkerStyle['color']|null;font:MarkerStyle['font']|null}
export type PreferenceChange={kind?:Preference['kind'];itemId?:string;position?:Position;color?:MarkerStyle['color'];font?:MarkerStyle['font'];tidy?:boolean}
export type PreferenceClient={read(childId:string,signal:AbortSignal):Promise<Preference[]>;write(childId:string,change:PreferenceChange):Promise<Preference[]>}
export const FridgePreferencesContext=createContext<PreferenceClient|null>(null)
export function createPreferenceClient(getBearer:()=>string|null|undefined):PreferenceClient{
 async function request(childId:string,change?:PreferenceChange,signal?:AbortSignal){
  const bearer=getBearer();if(!bearer)throw Error('UNAUTHENTICATED')
  const response=await fetch(`/api/rosina/pin/preferences${change?'':`?childId=${encodeURIComponent(childId)}`}`,{
   method:change?'POST':'GET',headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json'},
   body:change?JSON.stringify({childId,...change}):undefined,signal:signal??AbortSignal.timeout(15000),cache:'no-store',
  })
  if(!response.ok)throw Error('PREFERENCES_UNAVAILABLE')
  const result=await response.json();if(!Array.isArray(result.items))throw Error('PREFERENCES_UNAVAILABLE')
  return result.items as Preference[]
 }
 return {read:(child,signal)=>request(child,undefined,signal),write:(child,change)=>request(child,change)}
}
export function useFridgePreferences(childId:string){
 const client=useContext(FridgePreferencesContext)
 const [items,setItems]=useState<Preference[]>([]),[status,setStatus]=useState(client?'Loading arrangement…':''),[ready,setReady]=useState(!client),[pending,setPending]=useState(false),[retry,setRetry]=useState(0)
 const busy=useRef(false),alive=useRef(true)
 useEffect(()=>{
  alive.current=true;const abort=new AbortController()
  if(client){setReady(false);void client.read(childId,abort.signal).then(rows=>{if(!abort.signal.aborted){setItems(rows);setReady(true);setStatus('')}},()=>{if(!abort.signal.aborted)setStatus('Couldn’t load the arrangement. Try again.')})}
  return()=>{alive.current=false;abort.abort()}
 },[client,childId,retry])
 async function change(patch:PreferenceChange){
  if(!ready||busy.current)return
  busy.current=true;setPending(true);setStatus('Saving arrangement…')
  try{
   let rows:Preference[]
   if(client)rows=await client.write(childId,patch)
   else if(patch.tidy)rows=items.map(item=>({...item,position:null}))
   else{const previous=items.find(item=>item.kind===patch.kind&&item.itemId===patch.itemId);rows=[...items.filter(item=>item!==previous),{position:null,color:null,font:null,...previous,...patch} as Preference]}
   if(alive.current){setItems(rows);setStatus('Arrangement saved.')}
  }catch{if(alive.current)setStatus('Couldn’t save the arrangement. Try again.')}
  finally{if(alive.current){busy.current=false;setPending(false)}}
 }
 return {layout:Object.fromEntries(items.filter(item=>item.position).map(item=>[item.itemId,item.position!])),markers:Object.fromEntries(items.filter(item=>item.kind==='goal').map(item=>[item.itemId,{color:item.color??'black',font:item.font??'kalam'}])),change,ready,pending,status,retry:()=>setRetry(n=>n+1)}
}
