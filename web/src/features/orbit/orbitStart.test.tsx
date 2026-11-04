import type {ReactNode} from 'react'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {expect,it,vi} from 'vitest'
import {SessionProvider} from '@/features/personas/Session'
import {createMockAuthAdapter} from '@/features/personas/auth'
import {OrbitController} from './controller'
import {OrbitStart,extractDescriptors} from './OrbitStart'
import type {Alert,OrbitAdapter,Vocabulary} from './adapter'
// The start screen hosts the voice co-pilot, which needs a session context like the real app.
const withSession=(node:ReactNode)=>render(<SessionProvider adapter={createMockAuthAdapter()}>{node}</SessionProvider>)

const guidance='If there is an emergency, call 911.'
const vocab:Vocabulary[]=[{kind:'WEAR_COLOR',value:'red',version:1},{kind:'WEAR_GARMENT',value:'jacket',version:1},{kind:'HAIR',value:'curly',version:1},{kind:'CARRY_ITEM',value:'book_bag',version:1}]
const places=[{id:'rp_park',kind:'PARK',label:'Riverside Park'}]
function fixture(){
 const active:Alert={id:'a1',status:'ACTIVE',child:{id:'child'},message:'msg',share:{photoId:null,wearColor:'red',wearGarment:'jacket'},activatedAt:'2026-11-03T05:40:00Z',closedAt:null,audience:[{person:{id:'p_gma',displayName:'Loretta'},eligible:true}],responses:[],latestResponses:[],guidance,lastSeenPlace:{id:'rp_park',kind:'PARK',label:'Riverside Park'},lastSeenAt:null}
 const adapter:OrbitAdapter={check:vi.fn(async()=>({recorded:false,label:'c',text:'t',dueAt:null,guidance})),vocabulary:vi.fn(async()=>vocab),places:vi.fn(async()=>places),status:vi.fn(async()=>({alertId:null,status:null,audienceCount:1,notifiedCount:1,latestResponses:[],guidance})),alert:vi.fn(async()=>null),draft:vi.fn(async()=>({draftId:'d',draftVersion:1,status:'PENDING_ACTIVATION',guidance})),preview:vi.fn(async()=>({draftId:'d',draftVersion:1,message:'Exact',messageHash:'h',audienceSize:1,guidance})),activate:vi.fn(async()=>active),respond:vi.fn(),close:vi.fn(),upload:vi.fn(async()=>'ph'),photo:vi.fn(async()=>new Blob())}
 const controller=new OrbitController(adapter,{childId:'child',personId:'p_mom',parent:true,readOnly:false,generation:1},()=>1)
 return {adapter,controller}
}

it('extractDescriptors pulls controlled-vocabulary details from free text; unknown words yield nothing',()=>{
 expect(extractDescriptors('She has curly hair, a red jacket and a book bag.',vocab)).toEqual({wearColor:'red',wearGarment:'jacket',hair:'curly',carryItem:'book_bag'})
 expect(extractDescriptors('I honestly do not know what she had on.',vocab)).toEqual({})
})

it('the START screen leads with empathy, needs only a description, and one Send drafts+previews+activates (no form, no review page)',async()=>{
 const {adapter,controller}=fixture();await controller.load()
 withSession(<OrbitStart controller={controller} childName="Nora Ellison"/>)
 expect(screen.getByText(/I'm here\. Tell me what's happening, and I'll help you find Nora\./)).toBeVisible()
 // No dropdown wall and no separate review page.
 expect(screen.queryByLabelText('Clothing color')).not.toBeInTheDocument()
 expect(screen.queryByRole('button',{name:'Review message'})).not.toBeInTheDocument()
 expect(screen.queryByRole('button',{name:'Confirm and activate Orbit'})).not.toBeInTheDocument()
 // A real styled Add-a-photo control backed by an actual file input.
 expect(screen.getByText('Add a photo').closest('label')?.querySelector('input[type=file]')).not.toBeNull()
 const send=screen.getByRole('button',{name:/Send Orbit alert/});expect(send).toBeDisabled()
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'Nora, red jacket and curly hair, last seen a little while ago.'}})
 fireEvent.change(screen.getByLabelText('Where last seen'),{target:{value:'rp_park'}})
 expect(send).toBeEnabled()
 fireEvent.click(send)
 await waitFor(()=>expect(adapter.activate).toHaveBeenCalledTimes(1))
 expect(adapter.draft).toHaveBeenCalledTimes(1);expect(adapter.preview).toHaveBeenCalledTimes(1)
 const call=vi.mocked(adapter.draft).mock.calls[0] as unknown as [string,Record<string,string>,string|undefined,{lastSeenPlaceId?:string;lastSeenAt?:string}]
 expect(call[0]).toBe('child')
 expect(call[1]).toMatchObject({wearColor:'red',wearGarment:'jacket',hair:'curly'})
 expect(call[3]?.lastSeenPlaceId).toBe('rp_park');expect(typeof call[3]?.lastSeenAt).toBe('string')
})

it('Send stays disabled with no description; the summary previews the extracted details',async()=>{
 const {controller}=fixture();await controller.load()
 withSession(<OrbitStart controller={controller} childName="Nora Ellison"/>)
 expect(screen.getByRole('button',{name:/Send Orbit alert/})).toBeDisabled()
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'red jacket'}})
 expect(screen.getByRole('button',{name:/Send Orbit alert/})).toBeEnabled()
 expect(screen.getByText('red')).toBeVisible();expect(screen.getByText('jacket')).toBeVisible()
})
