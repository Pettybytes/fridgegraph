import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client'
import { expect, it, vi } from 'vitest'
import { refreshResource, resourceSnapshot } from './resourceCache'
const makeClient = () => new ApolloClient({ cache: new InMemoryCache(), link: ApolloLink.empty() })
it('deduplicates in-flight loads and isolates children and persona clients', async () => {
 const a=makeClient(),b=makeClient(); let done!:(v:string)=>void
 const load=vi.fn(()=>new Promise<string>(resolve=>{done=resolve}))
 const first=refreshResource(a,'care:nora',load),second=refreshResource(a,'care:nora',load)
 await Promise.resolve(); expect(load).toHaveBeenCalledTimes(1); done('Nora care'); await Promise.all([first,second])
 expect(resourceSnapshot(a,'care:nora')?.value).toBe('Nora care')
 expect(resourceSnapshot(a,'care:jax')).toBeUndefined();expect(resourceSnapshot(b,'care:nora')).toBeUndefined()
 a.stop();b.stop()
})
it('clears a cached value on refusal and ignores loads completed after clearStore', async()=>{
 const client=makeClient()
 await refreshResource(client,'care:nora',async()=> 'private')
 await expect(refreshResource(client,'care:nora',async()=>{throw Error('UNAUTHORIZED')})).rejects.toThrow('UNAUTHORIZED')
 expect(resourceSnapshot(client,'care:nora')).toEqual({error:'UNAUTHORIZED'})
 let done!:(v:string)=>void
 const pending=refreshResource(client,'care:nora',()=>new Promise<string>(resolve=>{done=resolve}))
 await Promise.resolve(); await client.clearStore();done('obsolete');await pending
 expect(resourceSnapshot(client,'care:nora')).toBeUndefined();client.stop()
})
