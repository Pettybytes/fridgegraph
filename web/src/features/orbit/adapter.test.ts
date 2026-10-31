import {ApolloLink,Observable} from '@apollo/client'
import {expect,it,vi} from 'vitest'
import {createGraphClient} from '@/lib/frontendData/graphqlAdapter'
import {retryReadOnce} from '@/features/personas/renewal'
import {createOrbitAdapter} from './adapter'
it('only reads use the eligible-read renewal path; preview and activation are never replayed',async()=>{
 let token='test-only-first'
 const calls:{name:string;bearer:string}[]=[]
 const link=new ApolloLink(operation=>new Observable(observer=>{calls.push({name:operation.operationName??'',bearer:operation.getContext().headers.authorization});if(calls.length===1||operation.operationName!=='WebOrbitVocabulary')observer.error(Object.assign(Error('UNAUTHENTICATED'),{statusCode:401}));else{observer.next({data:{orbitVocabulary:[]}});observer.complete()}}))
 const client=createGraphClient(async()=>token,link)
 const renew=vi.fn(async()=>{token='test-only-second';return {}}),read=<T,>(fn:()=>Promise<T>)=>retryReadOnce('query',fn,renew,()=>true)
 const adapter=createOrbitAdapter(client,read,()=>token)
 await adapter.vocabulary();expect(renew).toHaveBeenCalledTimes(1);expect(calls.map(c=>c.bearer)).toEqual(['Bearer test-only-first','Bearer test-only-second'])
 await expect(adapter.preview('oa_test')).rejects.toThrow();await expect(adapter.activate({draftId:'oa_test',draftVersion:1,message:'Exact message',messageHash:'test-binding',audienceSize:3,guidance:'Call 911 in an emergency.'})).rejects.toThrow()
 expect(calls.map(c=>c.name)).toEqual(['WebOrbitVocabulary','WebOrbitVocabulary','WebOrbitPreview','WebOrbitActivate']);expect(renew).toHaveBeenCalledTimes(1);client.stop()
})
it('media reads the current bearer each time and never replays an upload',async()=>{
 let token='test-only-first'
 const request=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({photoId:'ph_test'}),{status:200})).mockResolvedValueOnce(new Response(new Uint8Array([1,2,3]),{status:200})).mockResolvedValueOnce(new Response('',{status:401}))
 vi.stubGlobal('fetch',request)
 const client=createGraphClient(async()=>token,new ApolloLink(()=>new Observable(observer=>{observer.next({data:{}});observer.complete()})))
 const adapter=createOrbitAdapter(client,fn=>fn(),()=>token),signal=new AbortController().signal
 await adapter.upload('p_nora',new File(['x'],'test.png',{type:'image/png'}),signal);token='test-only-second';await adapter.photo('ph_test',signal)
 await expect(adapter.upload('p_nora',new File(['x'],'test.png',{type:'image/png'}),signal)).rejects.toThrow('UNAUTHENTICATED');expect(request).toHaveBeenCalledTimes(3)
 expect(request.mock.calls.map(c=>(c[1]?.headers as Record<string,string>).Authorization)).toEqual(['Bearer test-only-first','Bearer test-only-second','Bearer test-only-second'])
 expect(request.mock.calls.every(c=>c[1]?.cache==='no-store')).toBe(true);client.stop();vi.unstubAllGlobals()
})

it('an authenticated photo read renews once and reads the new bearer, without replaying writes',async()=>{
 let token='test-only-first';const request=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('',{status:401})).mockResolvedValueOnce(new Response(new Uint8Array([1]),{status:200}));vi.stubGlobal('fetch',request)
 const client=createGraphClient(async()=>token),renew=vi.fn(async()=>{token='test-only-second';return {}})
 const adapter=createOrbitAdapter(client,fn=>retryReadOnce('query',fn,renew,()=>true),()=>token)
 await adapter.photo('ph_test',new AbortController().signal);expect(renew).toHaveBeenCalledTimes(1);expect(request.mock.calls.map(c=>(c[1]?.headers as Record<string,string>).Authorization)).toEqual(['Bearer test-only-first','Bearer test-only-second']);client.stop();vi.unstubAllGlobals()
})
