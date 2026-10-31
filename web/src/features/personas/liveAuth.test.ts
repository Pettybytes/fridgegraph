import {expect,it,vi} from 'vitest'
import {createLiveAuthAdapter,PerspectiveError,retryDelay} from './liveAuth'
import {readyBody as body} from './sessionTestFixtures'
it('parses the nested READY contract into memory-only whitelisted fields',async()=>{
 const payload=body(),request=vi.fn<typeof fetch>(async()=>Response.json(payload))
 const session=await createLiveAuthAdapter(request).signInAsPersona('kendra')
 expect(session).toMatchObject({persona:payload.persona,scope:payload.scope,expiresAt:payload.session.expires_at,accessToken:'test-only-session',marks:{demo:true,demoGuide:false}})
 expect(session).not.toHaveProperty('session');expect(session).not.toHaveProperty('refresh_token')
 expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({personaId:'kendra'})
 expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0)
})
it.each(['UNKNOWN_PERSONA','NO_SEEDED_IDENTITY'])('only 200 %s becomes terminal',async reason=>{
 const adapter=createLiveAuthAdapter(async()=>Response.json({status:'UNAVAILABLE',personaId:'rosa',reason}))
 await expect(adapter.signInAsPersona('rosa')).rejects.toMatchObject({terminal:true,message:'Not set up in this demo yet'})
})
it.each(['MINT_LINK_FAILED','MINT_VERIFY_FAILED','MINT_IDENTITY_MISMATCH','MINT_MARKER_MISSING','MINT_REFRESH_FAILED','DEMO_LOGIN_UNAVAILABLE'])('%s is retryable, never Coming soon',async reason=>{
 await expect(createLiveAuthAdapter(async()=>Response.json({status:'UNAVAILABLE',personaId:'kendra',reason},{status:503})).signInAsPersona('kendra')).rejects.toMatchObject({terminal:false,message:'Busy, try again in a moment'})
})
it('honors Retry-After globally without an immediate retry or identity substitution',async()=>{
 vi.useFakeTimers();const request=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('',{status:429,headers:{'Retry-After':'60'}})).mockResolvedValue(Response.json(body('dana')))
 const adapter=createLiveAuthAdapter(request)
 await expect(adapter.signInAsPersona('kendra')).rejects.toMatchObject({retryAfterMs:60000})
 await expect(adapter.signInAsPersona('dana')).rejects.toBeInstanceOf(PerspectiveError);expect(request).toHaveBeenCalledTimes(1)
 await vi.advanceTimersByTimeAsync(60000);expect((await adapter.signInAsPersona('dana')).persona.id).toBe('dana');vi.useRealTimers()
})
it('handles network failure and rejects a mismatched identity without a substitute',async()=>{
 await expect(createLiveAuthAdapter(async()=>{throw new Error('raw network body')}).signInAsPersona('kendra')).rejects.toMatchObject({terminal:false,message:'Busy, try again in a moment'})
 const wrong=body('dana');wrong.personaId='kendra'
 await expect(createLiveAuthAdapter(async()=>Response.json(wrong)).signInAsPersona('kendra')).rejects.toMatchObject({terminal:false})
})
it('readiness only disables personas confirmed by terminal login responses',async()=>{
 let calls=0;const request=vi.fn<typeof fetch>(async url=>{calls++;return String(url).endsWith('health')?Response.json({personas:[{personaId:'rosa',ready:false},{personaId:'simone',ready:false},{personaId:'kendra',ready:true}]}):calls===2?Response.json({status:'UNAVAILABLE',personaId:'rosa',reason:'NO_SEEDED_IDENTITY'}):new Response('',{status:503})})
 expect(await createLiveAuthAdapter(request).unavailablePersonas!(new AbortController().signal)).toEqual(['rosa'])
 expect(request).toHaveBeenCalledTimes(3)
})
it('parses seconds and HTTP-date Retry-After values',()=>{
 expect(retryDelay('42',0)).toBe(42000);expect(retryDelay('Thu, 01 Jan 1970 00:01:00 GMT',0)).toBe(60000)
})
