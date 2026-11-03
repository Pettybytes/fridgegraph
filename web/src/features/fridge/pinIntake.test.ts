import {describe,it,expect,vi} from 'vitest'
import {createPinIntakeClient,PinError,pinErrorMessage,sampleSlipFile,SAMPLE_SLIP_PATH} from './pinIntake'

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})
const token=()=>'tok-abc'
const ac=()=>new AbortController().signal

describe('pin intake client',()=>{
 it('readiness reads {ready,reasons}; any failure is treated as not ready',async()=>{
  const ok=createPinIntakeClient(token,vi.fn(async()=>json({ready:true,reasons:[]})) as unknown as typeof fetch)
  expect(await ok.readiness()).toEqual({ready:true,reasons:[]})
  const bad=createPinIntakeClient(token,vi.fn(async()=>{throw new Error('down')}) as unknown as typeof fetch)
  expect((await bad.readiness()).ready).toBe(false)
  const malformed=createPinIntakeClient(token,vi.fn(async()=>json({})) as unknown as typeof fetch)
  expect((await malformed.readiness()).ready).toBe(false)
 })

 it('forwards the caller bearer and refuses with no token',async()=>{
  const send=vi.fn(async()=>json({status:'READY'}))
  const client=createPinIntakeClient(token,send as unknown as typeof fetch)
  await client.prepare({childId:'p_nora',assetId:'pma_1'},ac())
  expect(((send.mock.calls[0] as unknown as [string,RequestInit])[1]).headers).toMatchObject({Authorization:'Bearer tok-abc'})
  const anon=createPinIntakeClient(()=>null,send as unknown as typeof fetch)
  await expect(anon.prepare({childId:'p_nora',assetId:'x'},ac())).rejects.toMatchObject({code:'UNAUTHENTICATED'})
 })

 it('maps known backend error codes and falls back to UNAVAILABLE for unknown ones',async()=>{
  const refuse=createPinIntakeClient(token,vi.fn(async()=>json({error:'UNAUTHORIZED'},403)) as unknown as typeof fetch)
  await expect(refuse.prepare({childId:'c',assetId:'a'},ac())).rejects.toMatchObject({code:'UNAUTHORIZED'})
  const weird=createPinIntakeClient(token,vi.fn(async()=>json({error:'TEAPOT'},418)) as unknown as typeof fetch)
  await expect(weird.prepare({childId:'c',assetId:'a'},ac())).rejects.toMatchObject({code:'UNAVAILABLE'})
  const boom=createPinIntakeClient(token,vi.fn(async()=>{throw new TypeError('network')}) as unknown as typeof fetch)
  await expect(boom.prepare({childId:'c',assetId:'a'},ac())).rejects.toMatchObject({code:'NETWORK'})
 })

 it('confirm sends claims+signature+reviewed and returns the pinned record',async()=>{
  const send=vi.fn(async()=>json({status:'PINNED',created:true,pin:{id:'pinned_1',childId:'p_nora',assetId:'pma_1',kind:'permission_slip',audience:'PARENTS_ONLY',caption:'Field trip',extracted:null}}))
  const client=createPinIntakeClient(token,send as unknown as typeof fetch)
  const proposal={proposalId:'pin_1',version:1,expiresAt:'2099-01-01T00:00:00Z',claims:{proposalId:'pin_1'},signature:'sig'}
  const out=await client.confirm({proposal,caption:'Field trip',extracted:{title:null,caption:'Field trip',date:null,startTime:null,place:null,term:null,event:null,dueDate:null,signatureRequired:true}},ac())
  expect(out.pin.id).toBe('pinned_1')
  const body=JSON.parse(((send.mock.calls[0] as unknown as [string,RequestInit])[1]).body as string)
  expect(body).toMatchObject({signature:'sig',claims:{proposalId:'pin_1'},reviewed:{caption:'Field trip'}})
 })

 it('sampleSlipFile fetches the Lincoln Elementary demo photo as a File',async()=>{
  const send=vi.fn(async()=>({ok:true,blob:async()=>new Blob([new Uint8Array([0x89,0x50,0x4e,0x47])],{type:'image/png'})}))
  const file=await sampleSlipFile(send as unknown as typeof fetch)
  expect((send.mock.calls[0] as unknown as [string])[0]).toBe(SAMPLE_SLIP_PATH)
  expect(file.name).toMatch(/lincoln-permission-slip-photo/)
  expect(file.type).toBe('image/png')
  // a missing sample surfaces as UNAVAILABLE, never a broken upload
  await expect(sampleSlipFile((async()=>new Response('x',{status:404})) as unknown as typeof fetch)).rejects.toMatchObject({code:'UNAVAILABLE'})
 })

 it('pinErrorMessage returns a plain message for every known code',()=>{
  expect(pinErrorMessage(new PinError('UNAUTHORIZED'))).toMatch(/parent or guardian/i)
  expect(pinErrorMessage(new PinError('CAPTION_REQUIRED'))).toMatch(/caption/i)
  expect(pinErrorMessage(new Error('x'))).toMatch(/available/i)
 })
})
