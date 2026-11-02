import {act,render,screen,waitFor} from '@testing-library/react'
import {beforeEach,expect,it,vi} from 'vitest'
import {Activity} from './Activity'
import type {StoredMissionControl} from '@/lib/frontendData/deliveredAdapter'
import type {AuthSession} from '@/features/personas/auth'
let current:AuthSession,generation=1
const runRead=<T,>(read:()=>Promise<T>)=>read()
const getSessionGeneration=()=>generation
vi.mock('@/features/personas/Session',()=>({useSession:()=>({session:current,runRead,getSessionGeneration})}))
const base={candidates:[],events:[],recordedRuns:[{job:{id:'job',status:'OPEN',version:1,candidateEvaluations:[],confirmation:null},attempts:[],timeline:[{at:'2026-11-01T15:00:00Z',kind:'JOB_CREATED',attemptId:null,candidate:null,detail:null}]}]} as StoredMissionControl
function session(persona:'kendra'|'priya',version:number):AuthSession{return {generation:version,scope:{childId:'p_nora',childName:'Nora',parentName:persona,villageId:'v_nora'},persona:{id:persona,personId:persona,childId:'p_nora',childName:'Nora',name:persona,villageId:'v_nora',parent:persona==='kendra',grants:[],role:'test'}}}
function client(school:()=>Promise<unknown>,additions:()=>Promise<unknown>=async()=>({data:{villagerAdditions:[]}})){return {query:({query}:{query:{definitions:{name?:{value:string}}[]}})=>{const name=query.definitions[0]?.name?.value;if(name==='WebActivitySlips')return Promise.resolve({data:{permissionSlips:[]}});if(name==='WebActivityOrbit')return Promise.resolve({data:{orbitStatus:{status:null,latestResponses:[]}}});if(name==='WebActivityCheck')return Promise.resolve({data:{checkInStatus:{recorded:true}}});if(name==='WebActivitySchoolReportsWithTime')return school();if(name==='WebActivityVillagerAdditions')return additions();return Promise.resolve({data:{schoolReports:[]}})}} as unknown as Parameters<typeof Activity>[0]['client']}
const adapter={mode:'graphql' as const,readMissionControl:async()=>base,readVillage:async()=>({nodes:[],edges:[]})}
beforeEach(()=>{generation=1;current=session('kendra',1)})
it('renders school words as plain text with source date and no confirmation',async()=>{
 const graph=client(async()=>({data:{schoolReports:[{id:'one',kind:'health',text:'Nora said <b>tired</b>',at:'2026-11-01',reportedAt:null}]}}))
 const {container}=render(<Activity client={graph} adapter={adapter}/>);await screen.findByText('Nora said <b>tired</b>')
 expect(screen.getByText('Time not recorded')).toBeInTheDocument();expect(container.querySelector('b')).toBeNull();expect(screen.getByText('School report')).toBeInTheDocument();expect(screen.queryByText('CONFIRMED')).toBeNull()
})
it('keeps authorized activity when school reports fail',async()=>{
 render(<Activity client={client(async()=>{throw Error('SCHOOL_REPORTS_UNAVAILABLE')})} adapter={adapter}/>);await screen.findByText('School reports unavailable');expect(screen.getByText('Pickup coordination job created. A plan is not yet a decision.')).toBeInTheDocument()
})
it('keeps school refusal distinct from empty success',async()=>{
 render(<Activity client={client(async()=>{throw Error('UNAUTHORIZED')})} adapter={adapter}/>);await screen.findByText('School reports not shared');expect(screen.getByText('Pickup coordination job created. A plan is not yet a decision.')).toBeInTheDocument()
})
it('refuses Priya and discards late school responses from the previous persona',async()=>{
 let finish!:(value:unknown)=>void
 const graph=client(()=>new Promise(resolve=>{finish=resolve}))
 const view=render(<Activity client={graph} adapter={adapter}/>);await waitFor(()=>expect(finish).toBeDefined())
 generation=2;current=session('priya',2);view.rerender(<Activity client={graph} adapter={adapter}/>);await screen.findByText('This activity is not shared with you')
 await act(async()=>finish({data:{schoolReports:[{id:'late',kind:'health',text:'Old report',at:'2026-11-01'}]}}))
 expect(screen.queryByText('Old report')).toBeNull();expect(screen.queryByText('No records are available to this view')).toBeNull()
})
it('shows an Add-a-Villager confirmation with the actor who confirmed it and the exact granted scopes',async()=>{
 const graph=client(async()=>({data:{schoolReports:[]}}),async()=>({data:{villagerAdditions:[{id:'vp_1',person:{id:'p_dana',displayName:'Dana Coleman'},addedBy:{id:'kendra'},relationshipType:'family_friend',scopes:['pickup.request'],confirmedAt:'2026-11-01T15:30:00Z'}]}}))
 render(<Activity client={graph} adapter={adapter}/>);await screen.findByText('Added Dana Coleman — pickup access.')
 expect(screen.getByText('kendra')).toBeInTheDocument()
})
it('degrades to no villager-addition entries when the field is not deployed yet, without breaking the rest of Activity',async()=>{
 const graph=client(async()=>({data:{schoolReports:[]}}),async()=>{throw Error('Cannot query field "villagerAdditions" on type "Query"')})
 render(<Activity client={graph} adapter={adapter}/>);await screen.findByText('Pickup coordination job created. A plan is not yet a decision.')
 expect(screen.queryByText(/Added .* —/)).toBeNull()
})
