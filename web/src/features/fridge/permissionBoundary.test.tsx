import {cleanup,render,screen,waitFor,act} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {ConnectedFridge} from './ConnectedFridge'
import {FridgeReadContext} from './FridgeReadContext'
import type {Read,Slot,Goal} from './model'
const scope=vi.hoisted(()=>({authorized:{status:'ready',children:[{id:'p_nora',scopes:['care.read']}]}}))
vi.mock('../personas/Session',()=>({useSession:()=>({session:{generation:1,persona:{id:'kendra',personId:'p_mom',parent:true},scope:{childId:'p_nora'}}})}))
vi.mock('../personas/childContext',()=>({useChildAccess:()=>({selectedChildId:'p_nora',authorized:scope.authorized,client:null})}))
afterEach(()=>{cleanup();history.replaceState(null,'','#/fridge')})
it('drops content immediately on permission change and discards the previous context response',async()=>{
 let careCalls=0,finish!:(value:Read<Slot[]|Goal[]>)=>void
 const reader={read:async(source:'care'|'goals')=>{
  if(source==='goals')return {status:'empty' as const}
  careCalls++
  if(careCalls===1)return {status:'ready' as const,value:[{id:'private',kind:'note' as const,text:'Old private record',caption:'Recorded care',position:{x:.2,y:.3,width:.1,rotation:0},source:'live' as const,owner:null}]}
  return new Promise<Read<Slot[]|Goal[]>>(resolve=>{finish=resolve})
 }}
 const tree=render(<FridgeReadContext.Provider value={reader}><ConnectedFridge/></FridgeReadContext.Provider>)
 await screen.findByText('Old private record')
 scope.authorized={status:'ready',children:[{id:'p_nora',scopes:[]}]}
 tree.rerender(<FridgeReadContext.Provider value={reader}><ConnectedFridge/></FridgeReadContext.Provider>)
 expect(screen.queryByText('Old private record')).not.toBeInTheDocument()
 await waitFor(()=>expect(finish).toBeDefined())
 tree.unmount()
 await act(async()=>finish({status:'ready',value:[{id:'late',kind:'note',text:'Late private record',caption:'Old response',position:{x:.2,y:.3,width:.1,rotation:0},source:'live',owner:null}]}))
 expect(screen.queryByText('Late private record')).not.toBeInTheDocument()
})
