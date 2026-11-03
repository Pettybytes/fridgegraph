import {fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {AlertTakeover} from './AlertTakeover'
import {OrbitController} from './controller'
import type {Alert,OrbitAdapter} from './adapter'

const motionSetting=vi.hoisted(()=>({reduced:false}))
vi.mock('motion/react',async original=>({...await original<typeof import('motion/react')>(),useReducedMotion:()=>motionSetting.reduced}))

const guidance='If there is an emergency, call 911.'
const active:Alert={id:'alert',child:{id:'child'},status:'ACTIVE',message:'Exact shared message.',share:{photoId:null,wearColor:'blue'},activatedAt:'2026-11-01T20:00:00Z',closedAt:null,audience:[{person:{id:'recipient',displayName:'Recipient'},eligible:true}],responses:[],latestResponses:[],guidance,lastSeenPlace:{id:'place',kind:'PARK',label:'Recorded Park'},lastSeenAt:'2026-11-01T19:00:00Z',lastSeenProvenance:'PARENT_ENTERED'}

function fixture(record:Alert|null){
 const adapter:OrbitAdapter={check:async()=>({recorded:false,label:'check',text:'not recorded',dueAt:null,guidance}),vocabulary:async()=>[],places:async()=>[{id:'place',kind:'PARK',label:'Recorded Park'}],status:async()=>({alertId:record?.id??null,status:record?.status??null,audienceCount:1,notifiedCount:1,latestResponses:record?.latestResponses??[],guidance}),alert:async()=>record,draft:async()=>({draftId:'d',draftVersion:1,status:'PENDING_ACTIVATION',guidance}),preview:async()=>({draftId:'d',draftVersion:1,message:'m',messageHash:'h',audienceSize:1,guidance}),activate:async()=>record!,respond:async()=>{},close:async()=>record!,upload:async()=>'photo',photo:async()=>new Blob()}
 return new OrbitController(adapter,{childId:'child',personId:'recipient',parent:false,readOnly:false,generation:1},()=>1)
}
afterEach(()=>{motionSetting.reduced=false;vi.unstubAllGlobals()})

it('the facts card shows the title, deep-link arrow, centered name and 2x2 tiles from recorded data',async()=>{
 const controller=fixture(active);await controller.load()
 render(<AlertTakeover controller={controller} childName="Nora Ellison"/>)
 expect(screen.getByRole('dialog')).toHaveTextContent('Orbit Alert')
 expect(screen.getByRole('heading',{name:'Nora Ellison'})).toBeVisible()
 expect(screen.getByText('Last seen place')).toBeVisible();expect(screen.getByText('Recorded Park')).toBeVisible()
 expect(screen.getByText('Last seen time')).toBeVisible()
 expect(screen.getByText('Clothing color')).toBeVisible();expect(screen.getByText('blue')).toBeVisible()
 expect(screen.getByText(/recorded by a parent/i)).toBeVisible()
 const before=location.hash;fireEvent.click(screen.getByRole('button',{name:/Open the Orbit page/}));expect(location.hash).toBe('#/orbit');location.hash=before
})

it('a place with no provenance states the time is not recorded and never claims a parent source',async()=>{
 const controller=fixture({...active,lastSeenProvenance:null});await controller.load()
 render(<AlertTakeover controller={controller} childName="Nora Ellison"/>)
 expect(screen.getByText('Time not recorded.')).toBeVisible()
 expect(screen.queryByText(/recorded by a parent/i)).not.toBeInTheDocument()
})

it('active falls back to a non-empty photo layer and states the missing photo in the card',async()=>{
 const controller=fixture(active);await controller.load()
 render(<AlertTakeover controller={controller} childName="Nora Ellison"/>)
 expect(document.querySelector('.orbit-takeover.is-alert')).not.toBeNull()
 expect(document.querySelector('.orbit-takeover-photo.is-fallback')).not.toBeNull()
 expect(screen.getByText('Photo not recorded.')).toBeVisible()
})

it('a shared photo becomes the crisp card image and the full-bleed background, not a fallback',async()=>{
 vi.stubGlobal('URL',class extends URL{static createObjectURL=()=>'blob:orbit-fixture';static revokeObjectURL=()=>{}})
 const controller=fixture({...active,share:{photoId:'photo',wearColor:'blue'}});await controller.load()
 render(<AlertTakeover controller={controller} childName="Nora Ellison"/>)
 await screen.findByAltText('Photo shared by the parent')
 const layer=document.querySelector('.orbit-takeover-photo') as HTMLElement
 expect(layer).not.toBeNull();expect(layer.className).not.toContain('is-fallback')
 expect(layer.style.backgroundImage).toContain('blob:orbit-fixture')
})

it('red active carries a photo layer; green found is a distinct state with no photo layer',async()=>{
 const live=fixture(active);await live.load()
 const {unmount}=render(<AlertTakeover controller={live} childName="Nora Ellison"/>)
 expect(document.querySelector('.orbit-takeover.is-alert')).not.toBeNull()
 expect(document.querySelector('.orbit-takeover-photo')).not.toBeNull()
 unmount()
 const closed=fixture({...active,status:'CLOSED',closeOutcome:'FOUND_SAFE',closedAt:'2026-11-01T21:00:00Z',thankyou:'Recorded thank-you.'});await closed.load()
 render(<AlertTakeover controller={closed} childName="Nora Ellison"/>)
 expect(document.querySelector('.orbit-takeover.is-found')).not.toBeNull()
 expect(document.querySelector('.orbit-takeover.is-alert')).toBeNull()
 expect(document.querySelector('.orbit-takeover-photo')).toBeNull()
 expect(screen.getByText('Found safe')).toBeVisible()
})

it('reduced motion renders the stage without a warp transform',async()=>{
 motionSetting.reduced=true
 const controller=fixture(active);await controller.load()
 render(<AlertTakeover controller={controller} childName="Nora Ellison"/>)
 const stage=document.querySelector('.orbit-takeover-stage') as HTMLElement
 expect(stage).not.toBeNull()
 expect(stage.getAttribute('style')??'').not.toMatch(/transform|perspective|scale/)
 expect(screen.getByRole('heading',{name:'Nora Ellison'})).toBeVisible()
})
