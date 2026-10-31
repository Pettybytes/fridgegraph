import {ApolloLink,Observable} from '@apollo/client'
import {GraphQLError,print} from 'graphql'
import {fireEvent,render,screen,within} from '@testing-library/react'
import {expect,it} from 'vitest'
import {createGraphClient} from '@/lib/frontendData/graphqlAdapter'
import {createMockAuthAdapter} from '@/features/personas/auth'
import {LiveFamilyCalendar} from './LiveFamilyCalendar'
import {ADULT_AVAILABILITY,CHILD_EVENTS,createLiveCalendarAdapter} from './liveAdapter'
import type {LiveCalendarAdapter} from './liveAdapter'
const baseEvent={id:'confirmed',title:'Confirmed commitment',start:'2026-11-26T18:00:00Z',end:'2026-11-26T19:00:00Z',location:null,status:'confirmed'}
async function fixture(options:{empty?:boolean;refused?:boolean;failed?:boolean}={}){
 const calls:{name:string;variables:Record<string,unknown>}[]=[]
 const session={...await createMockAuthAdapter().signInAsPersona('kendra'),generation:1}
 let generation=1
 const client=createGraphClient(async()=> 'test-only-bearer',new ApolloLink(op=>new Observable(observer=>{
  const v=op.variables;calls.push({name:op.operationName??'',variables:{...v}})
  if(options.refused&&op.operationName!=='WebAdultAvailability'){observer.next({errors:[new GraphQLError('Access denied',{extensions:{code:'UNAUTHORIZED'}})]});observer.complete();return}
  if(options.failed&&op.operationName==='WebChildEvents'){observer.error(new Error('Raw upstream stack text'));return}
  let data
  if(op.operationName==='WebChildEvents')data={childEvents:options.empty?[]:[baseEvent,{...baseEvent,id:'proposal',title:'Proposed commitment',status:'proposed'},...(v.includeCancelled?[{...baseEvent,id:'cancelled',title:'Cancelled commitment',status:'cancelled'}]:[])]}
  else if(op.operationName==='WebEffectiveSchedule')data={effectiveScheduleFor:{parent:options.empty?null:{id:v.date>='2026-11-25'&&v.date<='2026-11-27'?'p_dad':'p_mom',displayName:v.date>='2026-11-25'&&v.date<='2026-11-27'?'Andre Ellison':'Kendra Ellison'},source:v.date>='2026-11-25'&&v.date<='2026-11-27'?'ARRANGEMENT':'WEEKLY',arrangementId:v.date>='2026-11-25'&&v.date<='2026-11-27'?'recorded-arrangement':null}}
  else if(op.operationName==='WebScheduleConflicts')data={scheduleConflicts:options.empty?[]:[{kind:'OVERLAP',onDay:'2026-11-26',arrangementIds:['recorded-arrangement','other-arrangement']}]}
  else data={adultAvailability:options.empty?[]:[{person:{id:v.personId,displayName:v.personId==='p_mom'?'Kendra Ellison':'Andre Ellison'},start:'2026-11-25T14:00:00Z',end:'2026-11-25T22:00:00Z',state:v.personId==='p_mom'?'BUSY':'FREE',reason:'PRIVATE employer details'}]}
  observer.next({data});observer.complete()
 })),()=>generation)
 const adapter=createLiveCalendarAdapter(client,session,read=>read(),()=>generation)
 return {adapter,calls,client,switchGeneration:()=>{generation++}}
}
function mount(adapter:LiveCalendarAdapter){window.history.replaceState(null,'','#/calendar?day=2026-11-25&childId=p_nora');return render(<LiveFamilyCalendar adapter={adapter}/>)}
it('uses the delivered fields only; availability never requests a private reason',()=>{
 expect(print(ADULT_AVAILABILITY)).not.toMatch(/reason/);expect(print(CHILD_EVENTS)).not.toMatch(/category|confirmedBy|dayKind|participants|linkedRecords/)
})
it('composes daily WEEKLY/ARRANGEMENT answers without manufacturing weekly rules or holiday objects',async()=>{
 const {adapter,calls,client}=await fixture(),data=await adapter.readWindow({childId:'p_nora',from:'2026-11-23',to:'2026-11-29'})
 expect(data.care['2026-11-25']).toMatchObject({state:'ready',value:{source:'ARRANGEMENT',parent:{id:'p_dad'}}});expect(data.care['2026-11-27']).toMatchObject({state:'ready',value:{source:'ARRANGEMENT'}});expect(data.care['2026-11-28']).toMatchObject({state:'ready',value:{source:'WEEKLY',parent:{id:'p_mom'}}})
 expect(calls.filter(c=>c.name==='WebEffectiveSchedule')).toHaveLength(7);expect(data.conflicts).toMatchObject({state:'ready',value:[{kind:'OVERLAP'}]});expect(adapter.getActionScope().calendarEventIds.has('confirmed')).toBe(true);adapter.clear();expect(adapter.knownEvent('confirmed')).toBeUndefined();client.stop()
})
it('renders the approved holiday band, weekly return, proposals, conflict and Busy/Free honestly',async()=>{
 const {adapter,client}=await fixture();mount(adapter)
 const wed=await screen.findByRole('region',{name:'Wednesday, Nov 25 day'});await within(wed).findByText('Approved arrangement: scheduled with Andre')
 expect(within(screen.getByRole('region',{name:'Saturday, Nov 28 day'})).getByText('Scheduled with Kendra')).toBeVisible()
 expect(screen.getAllByText('Approved arrangement')).toHaveLength(3);expect(screen.getAllByText('Proposed')).toHaveLength(1)
 expect(screen.getByRole('button',{name:/Proposed commitment/})).toHaveClass('is-proposed');expect(screen.getByText(/overlapping arrangements/)).toBeVisible()
 expect(screen.getByText('Andre Ellison · free time recorded')).toBeVisible();expect(screen.getByText('Kendra Ellison · Busy')).toBeVisible();expect(screen.queryByText(/PRIVATE employer|available to watch|late shift/)).not.toBeInTheDocument()
 expect(screen.getByText(/School-closure information isn’t available/)).toBeVisible();client.stop()
})
it('cancelled stays hidden until the toggle requests includeCancelled; missing source fields stay missing',async()=>{
 const {adapter,calls,client}=await fixture();mount(adapter);await screen.findByRole('button',{name:/Confirmed commitment/});expect(screen.queryByRole('button',{name:/Cancelled commitment/})).not.toBeInTheDocument()
 fireEvent.click(screen.getByLabelText('Show cancelled events'));expect(await screen.findByRole('button',{name:/Cancelled commitment/})).toHaveClass('is-cancelled');expect(calls.filter(c=>c.name==='WebChildEvents').at(-1)?.variables.includeCancelled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:/Proposed commitment/}));const detail=screen.getByRole('dialog');expect(detail).toHaveTextContent('Not confirmed yet');expect(detail).toHaveTextContent('Category not recorded');expect(detail).toHaveTextContent('Linked records are not available');client.stop()
})
it('authorized empty, authorization refusal and upstream failure have distinct exact wordings',async()=>{
 for(const state of ['empty','refused','failed'] as const){
  const f=await fixture({[state]:true});const view=mount(f.adapter)
  if(state==='empty')expect((await screen.findAllByText('No records are available to this view')).length).toBeGreaterThan(0)
  if(state==='refused'){await screen.findByText("This isn't shared with you");expect(screen.queryByText('No records are available to this view')).not.toBeInTheDocument()}
  if(state==='failed'){await screen.findAllByText("Couldn't load this just now");expect(screen.queryByText('Raw upstream stack text')).not.toBeInTheDocument()}
  view.unmount();f.client.stop()
 }
})
it('refuses hidden/nonexistent/malformed children identically within the child reads',async()=>{
 const f=await fixture({refused:true});const outcomes=[]
 for(const childId of ['unshared-child','nonexistent-child','!malformed']){const result=await f.adapter.readWindow({childId,from:'2026-11-25',to:'2026-11-25'});outcomes.push({events:result.events,care:result.care['2026-11-25'],conflicts:result.conflicts})}
 expect(outcomes).toEqual(Array(3).fill({events:{state:'refused'},care:{state:'refused'},conflicts:{state:'refused'}}));f.client.stop()
})
it('late calendar reads cannot restore a prior perspective or enter the catalog scope',async()=>{
 const f=await fixture();const pending=f.adapter.readWindow({childId:'p_nora',from:'2026-11-25',to:'2026-11-25'});f.switchGeneration();await expect(pending).rejects.toThrow('SESSION_CHANGED');expect(f.adapter.knownEvent('confirmed')).toBeUndefined();f.client.stop()
})
it('opens the recorded Free window without revealing a reason or claiming willingness',async()=>{
 const {adapter,client}=await fixture();mount(adapter);fireEvent.click(await screen.findByRole('button',{name:/Andre Ellison · free time recorded/}));const detail=screen.getByRole('dialog',{name:'Free time recorded'});expect(detail).toHaveTextContent('Andre Ellison');expect(detail).not.toHaveTextContent(/PRIVATE|employer|reason|available to/);client.stop()
})
