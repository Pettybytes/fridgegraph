import {ApolloClient,HttpLink,InMemoryCache} from '@apollo/client'
import {expect,it} from 'vitest'
import {createVillageWorldReader} from './worldReader'
it('a remounted guide map does not inherit the previous map request cancellation',async()=>{
 const pending:{resolve:()=>void;signal:AbortSignal}[]=[]
 const fetchWorld: typeof fetch = async (_url, options) => new Promise<Response>((resolve,reject) => {
  const signal=options!.signal as AbortSignal
  signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})
  pending.push({signal,resolve:()=>resolve(new Response(JSON.stringify({
   data:{villageWorld:{child:{id:'p_nora'},people:[],places:[],events:[]}},
  }),{headers:{'content-type':'application/json'}}))})
 })
 const client=new ApolloClient({
  cache:new InMemoryCache(),
  link:new HttpLink({uri:'http://local.invalid/graphql',fetch:fetchWorld}),
 })
 const read=createVillageWorldReader(client,fn=>fn(),()=>Date.parse('2026-11-04T12:00:00Z'))
 const session={generation:1,childId:'p_nora',accessToken:'test-only',canReadCost:false}
 const oldLifetime=new AbortController(),newLifetime=new AbortController()
 const old=read(session,oldLifetime.signal).catch(()=>null)
 await expect.poll(()=>pending.length).toBe(5)
 const current=read(session,newLifetime.signal)
 oldLifetime.abort()
 await expect.poll(()=>pending.filter(item=>!item.signal.aborted).length).toBe(5)
 for(const request of pending.filter(item=>!item.signal.aborted))request.resolve()
 await expect(current).resolves.toMatchObject({state:'live',childId:'p_nora'})
 await old;client.stop()
})
