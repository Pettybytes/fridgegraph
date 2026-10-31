import {ApolloClient,ApolloLink,InMemoryCache,Observable,type Operation,type FetchResult} from '@apollo/client'
import {expect,it,vi} from 'vitest'
import {verifyResetSeededReads} from './ResetSeededReads'
it('accepts an authorized empty child list and reads the seeded vocabulary without populating cache',async()=>{
 const calls:string[]=[];const client=new ApolloClient({cache:new InMemoryCache(),link:new ApolloLink(op=>new Observable(observer=>{calls.push(op.operationName??'');observer.next({data:{myChildren:[],orbitVocabulary:[{kind:'WEAR_COLOR',value:'red',version:1}]}});observer.complete()}))})
 await verifyResetSeededReads(client,new AbortController().signal,()=>true);expect(calls).toEqual(['WebResetSeededReads']);expect(client.cache.extract()).toEqual({});client.stop()
})
it('a failed read is never retried or re-minted',async()=>{
 const request=vi.fn(()=>new Observable<FetchResult>(observer=>observer.error(Error('UNAUTHENTICATED')))),client=new ApolloClient({cache:new InMemoryCache(),link:new ApolloLink(request)})
 await expect(verifyResetSeededReads(client,new AbortController().signal,()=>true)).rejects.toThrow();expect(request).toHaveBeenCalledTimes(1);client.stop()
})
it('verification times out, aborts its read and never triggers a second read',async()=>{
 vi.useFakeTimers();let signal:AbortSignal|undefined;const request=vi.fn((op:Operation)=>{signal=op.getContext().fetchOptions.signal;return new Observable<FetchResult>(()=>{})}),client=new ApolloClient({cache:new InMemoryCache(),link:new ApolloLink(request)})
 const promise=verifyResetSeededReads(client,new AbortController().signal,()=>true,100),result=expect(promise).rejects.toThrow('RESTORE_READ_UNAVAILABLE');await vi.advanceTimersByTimeAsync(100);await result;expect(signal?.aborted).toBe(true);expect(request).toHaveBeenCalledTimes(1);client.stop();vi.useRealTimers()
})
