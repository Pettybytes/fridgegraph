import {useLayoutEffect} from 'react'
import {gql} from '@apollo/client'
import type {ApolloClient} from '@apollo/client'
import {useSession} from './Session'
export const RESET_SEEDED_READS=gql`query WebResetSeededReads{myChildren{child{id} scopes} orbitVocabulary{kind value version}}`
// Verify delivered, caller-scoped reads. Authorized empty child lists are valid. No cached
// result, renewal or write. This optional probe does not gate a committed reset receipt.
export async function verifyResetSeededReads(client:ApolloClient,signal:AbortSignal,current:()=>boolean,timeoutMs=15000){
 const abort=new AbortController();const cancel=()=>abort.abort();signal.addEventListener('abort',cancel,{once:true})
 let timer:ReturnType<typeof setTimeout>|undefined
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('RESTORE_READ_UNAVAILABLE'))},timeoutMs)})
 try{
  if(signal.aborted||!current())throw Error('SESSION_CHANGED')
  const result=await Promise.race([client.query<{myChildren:{child:{id:string};scopes:string[]}[];orbitVocabulary:{kind:string;value:string;version:number}[]}>({query:RESET_SEEDED_READS,fetchPolicy:'no-cache',context:{fetchOptions:{signal:abort.signal}}}),timeout])
  if(signal.aborted||!current())throw Error('SESSION_CHANGED')
  if(!Array.isArray(result.data?.myChildren)||!Array.isArray(result.data?.orbitVocabulary)||!result.data.orbitVocabulary.length)throw Error('RESTORE_READ_UNAVAILABLE')
 }finally{clearTimeout(timer);signal.removeEventListener('abort',cancel)}
}
export function ResetSeededReads({client}:{client:ApolloClient}){
 const {session,registerResetVerification,getSessionGeneration}=useSession()
 useLayoutEffect(()=>{
  if(!session)return
  const owner=session.generation
  return registerResetVerification(signal=>verifyResetSeededReads(client,signal,()=>owner===getSessionGeneration()))
 },[client,session?.generation,registerResetVerification,getSessionGeneration])
 return null
}
