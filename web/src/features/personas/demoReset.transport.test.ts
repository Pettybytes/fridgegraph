import {afterEach,expect,it,vi} from 'vitest'
import {createDemoReset,RESET_COOLDOWN,RESET_FAILED,RESET_FORBIDDEN,RESET_UNCERTAIN} from './demoReset'
afterEach(()=>vi.useRealTimers())
const session=()=>({access_token:'test-only-fresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600})
function receipt(runId:string,extra:Record<string,unknown>={}){return {ok:true,runId,status:'committed',personaId:'kendra',session:session(),...extra}}
it('sends one run id with the current bearer and maps only the committed session fields',async()=>{
 const request=vi.fn<typeof fetch>(async(_url,init)=>Response.json(receipt(JSON.parse(String(init?.body)).runId,{private:'discarded'})))
 const result=await createDemoReset(request)('test-only-current',undefined,'kendra')
 expect(result).toEqual({runId:expect.any(String),status:'committed',personaId:'kendra',session:{accessToken:'test-only-fresh',expiresAt:expect.any(Number)}})
 expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0][1]).toMatchObject({method:'POST',cache:'no-store',headers:{Authorization:'Bearer test-only-current','Content-Type':'application/json'}})
 expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({runId:result.runId})
})
it.each([[429,'RESET_RATE_LIMITED','cooldown',RESET_COOLDOWN],[500,'RESET_FAILED','failed',RESET_FAILED],[403,'RESET_NOT_ALLOWED','forbidden',RESET_FORBIDDEN],[403,'DEMO_GUIDE_READ_ONLY','readonly','Reset is not available for this perspective'],[403,'DEMO_SESSION_REQUIRED','failed',RESET_FAILED],[403,'LOOPBACK_ONLY','failed',RESET_FAILED],[401,'UNAUTHENTICATED','session',RESET_FAILED]])('maps %s/%s without retrying or exposing raw details',async(status,error,kind,message)=>{
 const request=vi.fn<typeof fetch>(async()=>Response.json({error,retryAfterMs:20000,details:'raw backend detail must not render'},{status:Number(status)}))
 await expect(createDemoReset(request)('test-only-session')).rejects.toMatchObject({kind,message});expect(request).toHaveBeenCalledTimes(1)
})
it('recovers a lost POST through GET of the same run id without replaying the mutation',async()=>{
 let runId='';const request=vi.fn<typeof fetch>(async(url,init)=>{
  if(init?.method==='POST'){runId=JSON.parse(String(init.body)).runId;throw Error('lost response')}
  expect(url).toBe(`/api/demo/reset/${runId}`);return Response.json(receipt(runId))
 })
 expect((await createDemoReset(request)('test-only-current',undefined,'kendra')).runId).toBe(runId)
 expect(request.mock.calls.map(([,init])=>init?.method)).toEqual(['POST','GET'])
})
it('polls running status then accepts a committed reset with no replacement token',async()=>{
 let runId='',reads=0;vi.useFakeTimers();const request=vi.fn<typeof fetch>(async(_url,init)=>{
  if(init?.method==='POST'){runId=JSON.parse(String(init.body)).runId;throw Error('lost response')}
  return Response.json(++reads===1?{runId,status:'running'}:receipt(runId,{session:null}))
 })
 const pending=createDemoReset(request)('test-only-current');await vi.advanceTimersByTimeAsync(300)
 expect(await pending).toMatchObject({runId,status:'committed',session:null});expect(request.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1)
})
it.each(['runId','personaId','token','expiry','missing'])('rejects an invalid %s receipt after a read-only recovery attempt',async(field)=>{
 let runId='';const request=vi.fn<typeof fetch>(async(_url,init)=>{
  if(init?.body)runId=JSON.parse(String(init.body)).runId
  const body=receipt(runId)
  if(field==='runId')body.runId='other-run'
  if(field==='personaId')body.personaId='dana'
  if(field==='token')body.session={...session(),access_token:''}
  if(field==='expiry')body.session={...session(),expires_at:0}
  if(field==='missing')delete (body as Partial<typeof body>).session
  return Response.json(init?.method==='POST'?body:{runId,status:'unknown'})
 })
 await expect(createDemoReset(request)('test-only-current',undefined,'kendra')).rejects.toMatchObject({kind:'uncertain',message:RESET_UNCERTAIN})
 expect(request.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1)
})
it('bounds timeout recovery even when transport ignores cancellation',async()=>{
 vi.useFakeTimers();const request=vi.fn<typeof fetch>(()=>new Promise(()=>{})),pending=createDemoReset(request,100,200)('test-only-session');const result=expect(pending).rejects.toMatchObject({kind:'uncertain'});await vi.advanceTimersByTimeAsync(400);await result
 expect(request.mock.calls.map(([,init])=>init?.method)).toEqual(['POST','GET']);expect(request.mock.calls.every(([,init])=>init?.signal?.aborted)).toBe(true)
})
it('external cancellation stops recovery and no request can start without a token',async()=>{
 const request=vi.fn<typeof fetch>(()=>new Promise(()=>{})),abort=new AbortController(),pending=createDemoReset(request)('test-only-session',abort.signal),result=expect(pending).rejects.toMatchObject({name:'AbortError'});abort.abort();await result;expect(request).toHaveBeenCalledTimes(1)
 const none=vi.fn<typeof fetch>();await expect(createDemoReset(none)()).rejects.toMatchObject({kind:'session'});expect(none).not.toHaveBeenCalled()
})

it('a timed out POST can recover a committed receipt by GET without waiting for the old request',async()=>{
 vi.useFakeTimers();let runId='';const request=vi.fn<typeof fetch>(async(_url,init)=>{if(init?.method==='POST'){runId=JSON.parse(String(init.body)).runId;return new Promise(()=>{})}return Response.json(receipt(runId))})
 const pending=createDemoReset(request,100,300)('test-only-current');await vi.advanceTimersByTimeAsync(101);expect(await pending).toMatchObject({runId,status:'committed'});expect(request).toHaveBeenCalledTimes(2)
})
it('cancelling recovery stops a pending status read and never issues another POST',async()=>{
 let reads!:()=>void;const started=new Promise<void>(resolve=>{reads=resolve}),request=vi.fn<typeof fetch>(async(_url,init)=>{if(init?.method==='POST')throw Error('lost response');reads();return new Promise(()=>{})}),controller=new AbortController()
 const pending=createDemoReset(request)('test-only-current',controller.signal),result=expect(pending).rejects.toMatchObject({name:'AbortError'});await started;controller.abort();await result;expect(request.mock.calls.map(([,init])=>init?.method)).toEqual(['POST','GET'])
})
it('a failed run is a definite failure after lost POST response',async()=>{
 let runId='';const request=vi.fn<typeof fetch>(async(_url,init)=>{if(init?.method==='POST'){runId=JSON.parse(String(init.body)).runId;throw Error('lost response')}return Response.json({runId,status:'failed'})})
 await expect(createDemoReset(request)('test-only-current')).rejects.toMatchObject({kind:'failed',message:RESET_FAILED});expect(request).toHaveBeenCalledTimes(2)
})
