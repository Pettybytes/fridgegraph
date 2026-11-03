import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {FridgePhase2} from './FridgePhase2'
import {mockFridgeEditingAdapter,sampleGoals} from './mockEditingAdapter'
import type {Compatibility,Phase2Service} from './phase2Adapter'
import type {FridgeReader} from './model'
import {FridgeEditing} from './FridgeEditing'
afterEach(()=>{cleanup();history.replaceState(null,'','#/fridge')})
const reader:FridgeReader={read:async source=>source==='goals'?{status:'ready',value:[{id:'old',title:'Original whiteboard',horizon:'Verbatim horizon',status:'APPROVED'}]}:{status:'empty'}}
const viewer={personId:'kendra',role:'PARENT' as const,sessionKey:'one'}
const fridge={personId:'kendra',childId:'nora',generation:1,reader}
const service=(kind:Compatibility['kind']='ready'):Phase2Service=>({check:vi.fn(async()=>({kind} as Compatibility)),adapter:mockFridgeEditingAdapter()})
it('does not probe or mount editing before verified deployment',async()=>{
 const live=service();render(<FridgePhase2 fridge={fridge} viewer={viewer} service={live} enabled={false}/>)
 expect(await screen.findByText('Original whiteboard')).toBeInTheDocument();expect(live.check).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Manage goals'})).not.toBeInTheDocument()
 expect(screen.getByText('Editing is not enabled yet.')).toBeInTheDocument()
})
it('keeps Phase 1 reads on recognized capability absence without a write',async()=>{
 const live=service('absent'),write=vi.spyOn(live.adapter,'createGoal')
 render(<FridgePhase2 fridge={fridge} viewer={viewer} service={live} enabled/>)
 expect(await screen.findByText(/Editing isn’t available on this version/)).toBeInTheDocument()
 expect(screen.getByText('Original whiteboard')).toBeInTheDocument();expect(write).not.toHaveBeenCalled()
})
it.each([
 ['authentication','Your perspective needs a fresh session. Choose a perspective again.'],
 ['refused','These records aren’t shared with this perspective.'],
 ['network','Couldn’t connect just now. Try again.'],
 ['database','Couldn’t load these records just now. Try again.'],
 ['server','The fridge service answered with an error. Try again.'],
 ['failed','Couldn’t load these records. Try again.'],
] as const)('keeps compatibility %s distinct from absent capability',async(kind,message)=>{
 render(<FridgePhase2 fridge={fridge} viewer={viewer} service={service(kind)} enabled/>)
 expect(await screen.findByText(message)).toBeInTheDocument();expect(screen.queryByText(/this version/)).not.toBeInTheDocument();expect(screen.getByText('Original whiteboard')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Manage goals'})).not.toBeInTheDocument()
})
it('discards a compatibility result from a previous persona so editing never mounts stale',async()=>{
 let resolveFirst!:(value:Compatibility)=>void
 const first:Phase2Service={check:vi.fn(()=>new Promise<Compatibility>(done=>{resolveFirst=done})),adapter:mockFridgeEditingAdapter()}
 const second=service('refused')
 const {rerender}=render(<FridgePhase2 fridge={fridge} viewer={viewer} service={first} enabled/>)
 expect(first.check).toHaveBeenCalledTimes(1)
 rerender(<FridgePhase2 fridge={fridge} viewer={{...viewer,personId:'priya',role:'CAREGIVER',sessionKey:'two'}} service={second} enabled/>)
 expect(await screen.findByText('These records aren’t shared with this perspective.')).toBeInTheDocument()
 await act(async()=>resolveFirst({kind:'ready'}))
 expect(screen.queryByRole('button',{name:'Manage goals'})).not.toBeInTheDocument()
 expect(screen.getByText('These records aren’t shared with this perspective.')).toBeInTheDocument()
})
it('updates the mounted whiteboard only after a confirmed completion, without changing approval',async()=>{
 const live=service();let resolve!:(goal:typeof sampleGoals[number])=>void
 live.adapter.completeGoal=vi.fn(()=>new Promise<typeof sampleGoals[number]>(done=>{resolve=done}))
 render(<FridgePhase2 fridge={fridge} viewer={viewer} service={live} enabled/>)
 fireEvent.click(await screen.findByRole('button',{name:'Manage goals'}));const dialog=screen.getByRole('dialog')
 const goal=(await within(dialog).findByText('Read together after school')).closest('article')!
 fireEvent.click(within(goal).getByRole('button',{name:'Mark complete'}))
 expect(within(goal).getByText('Not marked complete')).toBeInTheDocument();expect(screen.queryByText('Saved.')).not.toBeInTheDocument()
 await act(async()=>resolve({...sampleGoals[0],completedAt:'2026-11-03T12:00:00Z'}))
 expect(within(goal).getByText('Approved goal')).toBeInTheDocument();expect(screen.getByText('Saved.')).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Close editor'}))
 expect(within(screen.getByRole('region',{name:'Recorded goals'})).getByText('Nov 3, 2026')).toBeInTheDocument()
})
it('discards a late compatibility result and clears an open editor on context switch',async()=>{
 let resolve!:(value:Compatibility)=>void;const old=service();old.check=()=>new Promise<Compatibility>(done=>{resolve=done})
 const view=render(<FridgePhase2 fridge={fridge} viewer={viewer} service={old} enabled/>)
 view.rerender(<FridgePhase2 fridge={{...fridge,childId:'other'}} viewer={{...viewer,sessionKey:'two',role:'GUIDE'}} service={service()} enabled/>)
 fireEvent.click(await screen.findByRole('button',{name:'Family notes'}));expect(await screen.findByText('Fridge notes are not shared with this perspective.')).toBeInTheDocument()
 await act(async()=>resolve({kind:'ready'}));expect(screen.queryByRole('button',{name:'Manage goals'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Post privately'})).not.toBeInTheDocument()
 view.rerender(<FridgePhase2 fridge={{...fridge,childId:'third'}} viewer={{...viewer,sessionKey:'three'}} service={service('absent')} enabled/>)
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it.each([
 ['UNAUTHENTICATED','Your perspective needs a fresh session. Choose a perspective again.'],
 ['UNAUTHORIZED','Goals are not shared with this perspective.'],
 ['NETWORK_ERROR','Couldn’t connect just now.'],
 ['DB_UNAVAILABLE','Couldn’t load these records just now.'],
 ['READ_FAILED','Couldn’t load Goals.'],
])('retains %s in the independently loaded editor',async(code,message)=>{
 const adapter=mockFridgeEditingAdapter();adapter.readGoals=vi.fn().mockRejectedValue(Error(code))
 render(<FridgeEditing adapter={adapter} childId="nora" viewer={viewer}/>)
 expect(await screen.findByText(message,{exact:false})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Add goal'})).not.toBeInTheDocument()
 expect(await screen.findByRole('button',{name:'Post privately'})).toBeInTheDocument()
})
it('preserves horizon whitespace verbatim on save',async()=>{
 const adapter=mockFridgeEditingAdapter(),create=vi.spyOn(adapter,'createGoal')
 render(<FridgeEditing adapter={adapter} childId="nora" viewer={viewer}/>)
 const form=await screen.findByRole('form',{name:'Add a goal'})
 fireEvent.change(within(form).getByRole('textbox',{name:'Goal title'}),{target:{value:'Read'}})
 fireEvent.change(within(form).getByRole('textbox',{name:/Horizon/}),{target:{value:'  whenever we can  '}})
 fireEvent.click(within(form).getByRole('button',{name:'Add goal'}))
 await waitFor(()=>expect(create).toHaveBeenCalledWith(expect.objectContaining({horizon:'  whenever we can  ',period:null})))
})
it.each([
 ['UNAUTHENTICATED','Your perspective needs a fresh session. Try again.'],
 ['UNAUTHORIZED','This change is not allowed for this perspective.'],
 ['NETWORK_ERROR','Couldn’t confirm this change. Check the records before trying again.'],
 ['DB_UNAVAILABLE','Couldn’t save this change just now. Try again.'],
 ['WRITE_FAILED','Couldn’t save this change. Try again.'],
])('never reports saved or auto-retries a %s mutation',async(code,message)=>{
 const adapter=mockFridgeEditingAdapter();adapter.completeGoal=vi.fn().mockRejectedValue(Error(code))
 render(<FridgeEditing adapter={adapter} childId="nora" viewer={viewer}/>)
 const item=(await screen.findByText('Read together after school')).closest('article')!
 fireEvent.click(within(item).getByRole('button',{name:'Mark complete'}))
 expect(await screen.findByText(message)).toBeInTheDocument();expect(screen.queryByText('Saved.')).not.toBeInTheDocument()
 expect(within(item).getByText('Not marked complete')).toBeInTheDocument();expect(adapter.completeGoal).toHaveBeenCalledTimes(1)
})
it('does not publish a mutation response after the caller changes',async()=>{
 const adapter=mockFridgeEditingAdapter();let finish!:(value:typeof sampleGoals[number])=>void
 adapter.completeGoal=vi.fn(()=>new Promise<typeof sampleGoals[number]>(resolve=>{finish=resolve}))
 const view=render(<FridgeEditing adapter={adapter} childId="nora" viewer={viewer}/>)
 const item=(await screen.findByText('Read together after school')).closest('article')!
 fireEvent.click(within(item).getByRole('button',{name:'Mark complete'}))
 view.rerender(<FridgeEditing adapter={mockFridgeEditingAdapter([],[])} childId="other" viewer={{personId:'different',role:'CAREGIVER',sessionKey:'next'}}/>)
 await act(async()=>finish({...sampleGoals[0],completedAt:'2026-11-03T12:00:00Z'}))
 expect(screen.queryByText('Saved.')).not.toBeInTheDocument();expect(screen.queryByText('Read together after school')).not.toBeInTheDocument()
})
