import {createContext,useContext,useEffect,useState} from 'react'
import type {FridgeNoteRecord} from './editingContract'

export type MediaReader=(id:string,signal:AbortSignal)=>Promise<Blob>
export const FridgeMediaContext=createContext<MediaReader|null>(null)

/** Only caller-authorized image bytes become temporary URLs, revoked on scope change. */
export function useFridgeMedia(notes:FridgeNoteRecord[]){
 const read=useContext(FridgeMediaContext)
 const [urls,setUrls]=useState<Record<string,string>>({})
 const ids=JSON.stringify(notes.map(n=>n.attachmentRef).filter((id):id is string=>!!id&&id.startsWith('pm_')))
 useEffect(()=>{
  const abort=new AbortController(),created:string[]=[]
  setUrls({})
  if(read)for(const id of JSON.parse(ids) as string[])void read(id,abort.signal).then(blob=>{
   if(abort.signal.aborted)return
   const url=URL.createObjectURL(blob);created.push(url);setUrls(old=>({...old,[id]:url}))
  }).catch(()=>{/* The note remains visible with its caption if media access is refused. */})
  return()=>{abort.abort();created.forEach(url=>URL.revokeObjectURL(url))}
 },[read,ids])
 return urls
}
