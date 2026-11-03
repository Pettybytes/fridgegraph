import {cleanup,fireEvent,render,screen,within} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {FridgeIntake} from './FridgeIntake'
import type {PinIntakeClient,PinPrepareResult,PinnedResult} from './pinIntake'

afterEach(cleanup)

const extracted={title:{value:'Field trip',source:{type:'verified_quote' as const,quote:'Field trip'}},caption:'Field trip to the museum',date:'2026-11-20',startTime:null,place:{value:'Lincoln Elementary',source:{type:'transcription' as const,text:'Lincoln Elementary',ref:'image'}},term:null,event:{value:'Field trip',source:{type:'transcription' as const,text:'Field trip',ref:'image'}},dueDate:'2026-11-14',signatureRequired:true}
const readyProposal:PinPrepareResult={
 status:'READY',clarification:null,
 classification:{kind:'permission_slip',confidence:'high',uncertain:false,alternatives:[]},
 extracted,audience:{selected:'PARENTS_ONLY',options:['PARENTS_ONLY','SHARED']},suggestions:[],
 segmentation:{applied:true,source:'SAM_3_1',concept:'sheet of paper',crop:{x:0.1,y:0.1,width:0.8,height:0.8},rotationDeg:0,confidence:0.95},
 asset:{assetId:'pma_1',mimeType:'image/png'},
 proposal:{proposalId:'pin_1',version:1,expiresAt:'2099-01-01T00:00:00Z',claims:{},signature:'sig'},
}
const pinned:PinnedResult={status:'PINNED',created:true,pin:{id:'pinned_1',childId:'p_nora',assetId:'pma_1',kind:'permission_slip',audience:'PARENTS_ONLY',caption:'Field trip to the museum',extracted:null}}

function mockClient(over:Partial<PinIntakeClient>&{ready?:boolean}={}):PinIntakeClient{
 return {
  readiness:vi.fn(async()=>({ready:over.ready??true,reasons:[]})),
  upload:vi.fn(async()=>({assetId:'pma_1',mimeType:'image/png'})),
  prepare:vi.fn(async()=>readyProposal),
  confirm:vi.fn(async()=>pinned),
  ...over,
 }
}
const png=()=>new File([new Uint8Array([0x89,0x50,0x4e,0x47])],'slip.png',{type:'image/png'})

it('readiness-off keeps the exact honest unavailable state, disabled',async()=>{
 render(<FridgeIntake client={mockClient({ready:false})} childId="p_nora" canUse/>)
 const btn=await screen.findByRole('button',{name:'+ Add photo or paper'})
 expect(btn).toBeDisabled()
 expect(screen.getByText(/Photo and paper intake is unavailable/)).toBeInTheDocument()
})

it('a non-parent cannot use intake even when ready',async()=>{
 render(<FridgeIntake client={mockClient({ready:true})} childId="p_nora" canUse={false}/>)
 expect(await screen.findByRole('button',{name:'+ Add image and upload'})).toBeDisabled()
 expect(screen.getByText(/Only a parent or guardian/)).toBeInTheDocument()
})

it('parent flow: upload -> review (SAM crop + read fields) -> confirm -> pinned',async()=>{
 const client=mockClient({ready:true})
 const onPinned=vi.fn()
 render(<FridgeIntake client={client} childId="p_nora" canUse onPinned={onPinned}/>)
 const add=await screen.findByRole('button',{name:'+ Add image and upload'})
 expect(add).toBeEnabled()
 const input=document.querySelector('input[type=file]') as HTMLInputElement
 fireEvent.change(input,{target:{files:[png()]}})
 // review appears
 const review=await screen.findByLabelText('Review before pinning')
 expect(client.upload).toHaveBeenCalledOnce()
 expect(client.prepare).toHaveBeenCalledOnce()
 expect(within(review).getByText(/Cropped to the paper with Segment Anything 3.1/)).toBeInTheDocument()
 expect(within(review).getByText('Permission slip')).toBeInTheDocument()
 expect(within(review).getByText('Lincoln Elementary')).toBeInTheDocument()
 fireEvent.click(within(review).getByRole('button',{name:'Pin it to the fridge'}))
 expect(await screen.findByText(/Pinned to the fridge/)).toBeInTheDocument()
 expect(onPinned).toHaveBeenCalledWith(pinned.pin)
})

it('an uncropped SAM result is shown honestly, never faked as cropped',async()=>{
 const client=mockClient({ready:true,prepare:vi.fn(async():Promise<PinPrepareResult>=>({...readyProposal,segmentation:{applied:false,source:'SAM_3_1',reason:'no paper found'}}))})
 render(<FridgeIntake client={client} childId="p_nora" canUse/>)
 await screen.findByRole('button',{name:'+ Add image and upload'})
 fireEvent.change(document.querySelector('input[type=file]') as HTMLInputElement,{target:{files:[png()]}})
 expect(await screen.findByText(/Shown uncropped/)).toBeInTheDocument()
})

it('surfaces a refusal from the server as a plain alert, stays on compose',async()=>{
 const {PinError}=await import('./pinIntake')
 const client=mockClient({ready:true,upload:vi.fn(async()=>{throw new PinError('UNAUTHORIZED')})})
 render(<FridgeIntake client={client} childId="p_nora" canUse/>)
 await screen.findByRole('button',{name:'+ Add image and upload'})
 fireEvent.change(document.querySelector('input[type=file]') as HTMLInputElement,{target:{files:[png()]}})
 expect(await screen.findByRole('alert')).toHaveTextContent(/parent or guardian/i)
 expect(screen.getByRole('button',{name:'+ Add image and upload'})).toBeInTheDocument()
})
