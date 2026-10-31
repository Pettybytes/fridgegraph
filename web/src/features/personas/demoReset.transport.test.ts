import {afterEach,expect,it,vi} from 'vitest'
import {createDemoReset,RESET_COOLDOWN,RESET_FAILED,RESET_UNCERTAIN} from './demoReset'
afterEach(()=>vi.useRealTimers())
it('sends one empty POST with the supplied current bearer and retains no response payload',async()=>{
 const request=vi.fn<typeof fetch>(async()=>Response.json({ok:true,restored:{private:'not returned'}})),reset=createDemoReset(request)
 expect(await reset('test-only-current')).toBeUndefined();expect(request).toHaveBeenCalledTimes(1)
 expect(request.mock.calls[0][0]).toBe('/api/demo/reset');expect(request.mock.calls[0][1]).toMatchObject({method:'POST',cache:'no-store',headers:{Authorization:'Bearer test-only-current'}});expect(request.mock.calls[0][1]?.body).toBeUndefined()
 await reset('test-only-next');expect((request.mock.calls[1][1]?.headers as Record<string,string>).Authorization).toBe('Bearer test-only-next')
})
it.each([[429,'RESET_RATE_LIMITED','cooldown',RESET_COOLDOWN],[500,'RESET_FAILED','failed',RESET_FAILED],[403,'DEMO_GUIDE_READ_ONLY','readonly','Demo guide is read-only'],[403,'DEMO_SESSION_REQUIRED','failed',RESET_FAILED],[403,'LOOPBACK_ONLY','failed',RESET_FAILED],[401,'UNAUTHENTICATED','session',RESET_FAILED]])('maps %s/%s without retrying or exposing raw details',async(status,error,kind,message)=>{
 const request=vi.fn<typeof fetch>(async()=>Response.json({error,retryAfterMs:20000,details:'raw backend detail must not render'},{status:Number(status)}))
 await expect(createDemoReset(request)('test-only-session')).rejects.toMatchObject({kind,message});expect(request).toHaveBeenCalledTimes(1)
})
it('treats a lost connection and an unconfirmed response as uncertain, never as a rollback',async()=>{
 for(const request of [vi.fn<typeof fetch>(async()=>{throw Error('raw network detail')}),vi.fn<typeof fetch>(async()=>new Response('upstream failure',{status:502})),vi.fn<typeof fetch>(async()=>Response.json({ok:false}))]){await expect(createDemoReset(request)('test-only-session')).rejects.toMatchObject({kind:'uncertain',message:RESET_UNCERTAIN});expect(request).toHaveBeenCalledTimes(1)}
})
it('a timeout aborts once and returns uncertainty even when a transport ignores cancellation',async()=>{
 vi.useFakeTimers();const request=vi.fn<typeof fetch>(()=>new Promise(()=>{})),pending=createDemoReset(request,100)('test-only-session');const result=expect(pending).rejects.toMatchObject({kind:'uncertain',message:RESET_UNCERTAIN});await vi.advanceTimersByTimeAsync(100);await result;expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true)
})
it('external cancellation yields no reset failure/fallback, and no request can start without a token',async()=>{
 const request=vi.fn<typeof fetch>(()=>new Promise(()=>{})),abort=new AbortController(),pending=createDemoReset(request)('test-only-session',abort.signal),result=expect(pending).rejects.toMatchObject({name:'AbortError'});abort.abort();await result;expect(request).toHaveBeenCalledTimes(1)
 const none=vi.fn<typeof fetch>();await expect(createDemoReset(none)()).rejects.toMatchObject({kind:'session'});expect(none).not.toHaveBeenCalled()
})
