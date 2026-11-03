import {HttpLink} from '@apollo/client'
import {cleanup,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {createGraphClient} from '@/lib/frontendData/graphqlAdapter'
import {createPhase2Service} from './phase2Adapter'
import {FridgePhase2} from './FridgePhase2'
import type {FridgeReader} from './model'
import type {GoalRecord,FridgeNoteRecord} from './editingContract'

afterEach(cleanup)
const run=<T,>(read:()=>Promise<T>)=>read()
const goal={id:'goal',title:'Recorded goal',horizon:'Whenever',status:'APPROVED',period:null,completedAt:null,__typename:'Goal'}
const response=(data:unknown)=>new Response(JSON.stringify({data}),{headers:{'content-type':'application/json'}})

function abortableTransport(heldOperation='FridgePhase2Compatibility'){
 let held=false
 const signals:AbortSignal[]=[]
 const fetch=vi.fn<typeof globalThis.fetch>(async(_url,options)=>{
  const body=JSON.parse(options!.body as string)
  if(body.operationName===heldOperation&&!held){
   held=true
   const signal=options!.signal!
   signals.push(signal)
   return new Promise<Response>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))
  }
  return response({__typename:'Query',goals:[goal],fridgeNotes:[]})
 })
 const client=createGraphClient(async()=>'unit-parent-session',new HttpLink({uri:'http://fridge.invalid/graphql',fetch}),()=>1)
 return {client,fetch,signals,service:createPhase2Service(client,run,()=>true)}
}

it('keeps a replacement compatibility check independent of the prior mount’s aborted HttpLink request',async()=>{
 const {client,fetch,signals,service}=abortableTransport()
 try{
  const firstController=new AbortController(),nextController=new AbortController()
  const first=service.check('child',firstController.signal)
  // Attach the rejection assertion before aborting; the abandoned caller must still reject.
  const discarded=expect(first).rejects.toMatchObject({name:'AbortError'})
  await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1))
  firstController.abort()
  const next=service.check('child',nextController.signal)
  await discarded
  expect(nextController.signal.aborted).toBe(false)
  expect(signals[0].aborted).toBe(true)
  expect(await next).toEqual({kind:'ready'})
  expect(fetch).toHaveBeenCalledTimes(2)
 }finally{client.stop()}
})

it('mounts editing after an authorization-snapshot remount through the real auth link and HttpLink',async()=>{
 const {client,fetch,service}=abortableTransport()
 const reader:FridgeReader={read:async()=>({status:'empty'})}
 const props={fridge:{personId:'parent',childId:'child',generation:1,reader},viewer:{personId:'parent',role:'PARENT' as const,sessionKey:'1'},service,enabled:true}
 try{
  const view=render(<FridgePhase2 key="authorized-loading" {...props}/>)
  await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1))
  // ConnectedFridge keys this boundary on the authorized-child snapshot. Completing
  // MyChildren replaces the boundary without changing the persona, token or generation.
  view.rerender(<FridgePhase2 key="authorized-ready" {...props}/>)
  expect(await screen.findByRole('button',{name:/^Manage goals$/})).toBeInTheDocument()
  expect(screen.queryByText('Couldn’t load these records. Try again.')).not.toBeInTheDocument()
  expect(await screen.findByText('Recorded goal')).toBeInTheDocument()
  expect(fetch.mock.calls.every(([,options])=>new Headers(options?.headers).get('authorization')==='Bearer unit-parent-session')).toBe(true)
  view.unmount()
 }finally{client.stop()}
})

it.each([
 ['readGoals','FridgeEditableGoals'],
 ['readNotes','FridgePostedNotes'],
] as const)('keeps independently abortable %s reads separate through HttpLink',async(method,operation)=>{
 const {client,fetch,service}=abortableTransport(operation)
 try{
  const firstController=new AbortController(),nextController=new AbortController()
  const discarded=expect(service.adapter[method]('child',firstController.signal)).rejects.toMatchObject({name:'AbortError'})
  await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1))
  firstController.abort()
  const next=service.adapter[method]('child',nextController.signal)
  await discarded
  expect(await next).toEqual(method==='readGoals'?[goal]:[])
  expect(fetch).toHaveBeenCalledTimes(2)
 }finally{client.stop()}
})

it.each([
 ['__typename',{goals:[],fridgeNotes:[]}],
 ['goals',{__typename:'Query',fridgeNotes:[]}],
 ['fridgeNotes',{__typename:'Query',goals:[]}],
] as const)('still refuses a real-client response missing required %s',async(_field,data)=>{
 const fetch=vi.fn<typeof globalThis.fetch>(async()=>response(data))
 const client=createGraphClient(async()=>'unit-parent-session',new HttpLink({uri:'http://fridge.invalid/graphql',fetch}))
 try{expect(await createPhase2Service(client,run,()=>true).check('child',new AbortController().signal)).toEqual({kind:'failed'})}
 finally{client.stop()}
})

it.each(['parent-family-one','parent-family-two','guardian-family'])(
 'keeps confirmed note/goal edits readable after refresh and re-entry for %s through HttpLink',async(childId)=>{
  let storedGoal:GoalRecord|null=null,storedNote:FridgeNoteRecord|null=null
  const fetch=vi.fn<typeof globalThis.fetch>(async(_url,options)=>{
   const {operationName,variables:v}=JSON.parse(options!.body as string)
   switch(operationName){
    case 'FridgePhase2Compatibility':
    case 'FridgeEditableGoals':
    case 'FridgePostedNotes':
     expect(v.childId).toBe(childId)
     return response({__typename:'Query',goals:storedGoal?[storedGoal]:[],fridgeNotes:storedNote?[storedNote]:[]})
    case 'FridgePostNote':
     expect(v).toMatchObject({childId,audience:'PARENTS_ONLY'})
     storedNote={id:'note',author:{id:'parent',displayName:'Recorded author'},text:v.text,paperColor:v.paperColor,audience:v.audience,revision:1,createdAt:'2026-11-03T12:00:00Z',updatedAt:'2026-11-03T12:00:00Z'}
     return response({postFridgeNote:storedNote})
    case 'FridgeUpdateNote':
     storedNote={...storedNote!,...v,revision:2}
     return response({updateFridgeNote:storedNote})
    case 'FridgeCreateGoal':
     expect(v.childId).toBe(childId)
     storedGoal={id:'goal',title:v.title,horizon:v.horizon,status:v.status,period:v.period,completedAt:null}
     return response({createGoal:storedGoal})
    case 'FridgeUpdateGoal':
     storedGoal={...storedGoal!,...v}
     return response({updateGoal:storedGoal})
    default:throw Error(`Unexpected operation ${operationName}`)
   }
  })
  const connect=()=>createGraphClient(async()=>'unit-parent-session',new HttpLink({uri:'http://fridge.invalid/graphql',fetch}))
  let client=connect()
  try{
   let service=createPhase2Service(client,run,()=>true)
   expect(await service.check(childId,new AbortController().signal)).toEqual({kind:'ready'})
   await service.adapter.postFridgeNote({childId,text:'Original note',paperColor:'PINK',audience:'PARENTS_ONLY'})
   await service.adapter.updateFridgeNote({id:'note',text:'Confirmed edit',paperColor:'BLUE'})
   await service.adapter.createGoal({childId,title:'Original goal',horizon:'  when ready  ',period:null,status:'PROPOSED'})
   await service.adapter.updateGoal({id:'goal',title:'Confirmed goal edit',horizon:'  when ready  ',period:'WEEK'})
   await client.clearStore();client.stop()
   // Re-entry uses a new actual client/service, retaining only the mock server's records.
   client=connect();service=createPhase2Service(client,run,()=>true)
   expect(await service.check(childId,new AbortController().signal)).toEqual({kind:'ready'})
   expect(await service.adapter.readNotes(childId,new AbortController().signal)).toMatchObject([{text:'Confirmed edit',paperColor:'BLUE',audience:'PARENTS_ONLY',revision:2}])
   expect(await service.adapter.readGoals(childId,new AbortController().signal)).toMatchObject([{title:'Confirmed goal edit',horizon:'  when ready  ',period:'WEEK',status:'PROPOSED',completedAt:null}])
  }finally{client.stop()}
 })
