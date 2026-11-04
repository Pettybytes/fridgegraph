import type {ReactNode} from 'react'
import {fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {createMockAuthAdapter} from '@/features/personas/auth'
import {SessionProvider,useSession} from '@/features/personas/Session'
import {OrbitController} from './controller'
import {OrbitProvider} from './runtime'
import {OrbitView} from './Orbit'
import type {Alert,OrbitAdapter} from './adapter'

const motionSetting=vi.hoisted(()=>({reduced:false}))
vi.mock('motion/react',async original=>({...await original<typeof import('motion/react')>(),useReducedMotion:()=>motionSetting.reduced}))
const guidance='If there is an emergency, call 911.'
const activeAlert:Alert={id:'oa1',status:'ACTIVE',child:{id:'p_nora'},message:'Shared Orbit message.',share:{photoId:null,wearColor:'blue',wearGarment:'jacket'},activatedAt:'2026-11-03T05:40:00Z',closedAt:null,audience:[{person:{id:'p_gma',displayName:'Loretta'},eligible:true}],responses:[],latestResponses:[],guidance,lastSeenPlace:{id:'rp',kind:'PARK',label:'Lincoln Park'},lastSeenAt:'2026-11-03T05:36:00Z',lastSeenProvenance:'PARENT_ENTERED'}
function fixture(initial:Alert=activeAlert){
 let record:Alert=initial
 const adapter:OrbitAdapter={check:vi.fn(async()=>({recorded:false,label:'check',text:'not recorded',dueAt:null,guidance})),vocabulary:vi.fn(async()=>[]),status:vi.fn(async()=>({alertId:record.id,status:record.status,closeOutcome:record.closeOutcome??null,thankyou:record.thankyou??null,audienceCount:1,notifiedCount:1,latestResponses:record.latestResponses,guidance})),alert:vi.fn(async()=>record),draft:vi.fn(),preview:vi.fn(),activate:vi.fn(),respond:vi.fn(),close:vi.fn(async()=>{record={...record,status:'CLOSED',closeOutcome:'FOUND_SAFE',closedAt:'2026-11-03T05:52:00Z',thankyou:'Nora was found safe. Thank you.'};return record}),upload:vi.fn(),photo:vi.fn(async()=>new Blob())}
 const controller=new OrbitController(adapter,{childId:'p_nora',personId:'p_mom',parent:true,readOnly:false,generation:1},()=>1)
 return {adapter,controller}
}
function Login(){const {switchPerson,session}=useSession();return <button onClick={()=>{void switchPerson(session?undefined:'kendra')}}>{session?'Leave':'Enter'}</button>}
function Signed({controller,children}:{controller:OrbitController;children:ReactNode}){const {session}=useSession();return session?<OrbitProvider controller={controller}>{children}</OrbitProvider>:null}
function Wrapper({controller}:{controller:OrbitController}){return <SessionProvider adapter={createMockAuthAdapter()}><Login/><Signed controller={controller}><OrbitView controller={controller}/></Signed></SessionProvider>}
afterEach(()=>{motionSetting.reduced=false;vi.unstubAllGlobals();vi.restoreAllMocks()})

it('parent active page uses the glass facts card over a photo layer, not the old constellation',async()=>{
 const {controller}=fixture();render(<Wrapper controller={controller}/>);fireEvent.click(screen.getByText('Enter'))
 await screen.findByRole('button',{name:'Found safe'})
 expect(document.querySelector('.orbit-parent-alert')).not.toBeNull()
 expect(document.querySelector('.orbit-facts-card')).not.toBeNull()
 expect(document.querySelector('.orbit-takeover-photo')).not.toBeNull()
 expect(document.querySelector('.orbit-constellation')).toBeNull()
 expect(document.querySelector('.orbit-glass-scene')).toBeNull()
 expect(screen.getByText('Lincoln Park')).toBeVisible()
 expect(screen.getByText('Last seen place')).toBeVisible()
 expect(screen.getByText(/recorded by a parent/i)).toBeVisible()
})

it('parent closes Found safe: green payoff with a drawn check and confetti, then the closed card',async()=>{
 const {controller,adapter}=fixture();render(<Wrapper controller={controller}/>);fireEvent.click(screen.getByText('Enter'))
 fireEvent.click(await screen.findByRole('button',{name:'Found safe'}))
 fireEvent.click(screen.getByRole('button',{name:'Confirm found safe'}))
 await screen.findByRole('heading',{name:'Closed by Kendra'})
 expect(adapter.close).toHaveBeenCalledExactlyOnceWith('oa1','FOUND_SAFE')
 expect(document.querySelector('.orbit-found')).not.toBeNull()
 expect(document.querySelector('.orbit-safe-check')).not.toBeNull()
 expect(document.querySelector('.orbit-confetti')).not.toBeNull()
 expect(screen.getByText('Nora was found safe. Thank you.')).toBeVisible()
})

it('reduced motion closes without confetti and still reaches the closed card',async()=>{
 motionSetting.reduced=true
 const {controller}=fixture();render(<Wrapper controller={controller}/>);fireEvent.click(screen.getByText('Enter'))
 fireEvent.click(await screen.findByRole('button',{name:'Found safe'}))
 fireEvent.click(screen.getByRole('button',{name:'Confirm found safe'}))
 await screen.findByRole('heading',{name:'Closed by Kendra'})
 expect(document.querySelector('.orbit-confetti')).toBeNull()
})
