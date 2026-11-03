import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import App from '@/App'
import {createMockAuthAdapter} from '../personas/auth'
import {FridgeReadContext} from './FridgeReadContext'
import {FridgePhase2Preview,type Phase2PreviewFactory} from './FridgePhase2'
import {mockFridgeEditingAdapter} from './mockEditingAdapter'
import type {FridgeNoteRecord} from './editingContract'
const empty={read:async()=>({status:'empty' as const})}
afterEach(()=>{cleanup();localStorage.clear();history.replaceState(null,'','#/today')})
it('mounts confirmed posts on the door, preserves failed edits/removes, updates edits/removes, and clears on refusal/persona switch',async()=>{
 history.replaceState(null,'','#/fridge')
 const adapter=mockFridgeEditingAdapter([],[],{id:'p_mom',displayName:'Kendra'})
 const post=adapter.postFridgeNote
 let confirm!:()=>void
 adapter.postFridgeNote=vi.fn(async args=>{const result=await post(args);return new Promise<FridgeNoteRecord>(resolve=>{confirm=()=>resolve(result)})})
 const other=mockFridgeEditingAdapter([],[]);other.readNotes=vi.fn().mockRejectedValue(Error('UNAUTHORIZED'))
 const factory:Phase2PreviewFactory=viewer=>({check:async()=>({kind:'ready'}),adapter:viewer.personId==='p_mom'?adapter:other})
 render(<FridgeReadContext.Provider value={empty}><FridgePhase2Preview.Provider value={factory}><App authAdapter={createMockAuthAdapter()}/></FridgePhase2Preview.Provider></FridgeReadContext.Provider>)
 fireEvent.click(screen.getByRole('button',{name:'Explore as Kendra'}))
 fireEvent.click(await screen.findByRole('button',{name:'Family notes (0)'}))
 const form=await screen.findByRole('form',{name:'Post a fridge note'})
 fireEvent.change(within(form).getByRole('textbox',{name:'Note text'}),{target:{value:'Bring the library book.'}})
 fireEvent.click(within(form).getByRole('button',{name:'Post privately'}))
 await waitFor(()=>expect(confirm).toBeDefined())
 expect(document.querySelector('[aria-label="Posted fridge notes"]')).toBeNull()
 expect(screen.queryByText('Saved.')).not.toBeInTheDocument()
 await act(async()=>confirm())
 fireEvent.click(screen.getByRole('button',{name:'Close editor'}))
 const door=()=>screen.getByRole('region',{name:'Posted fridge notes'})
 expect(within(door()).getByText('Bring the library book.')).toBeInTheDocument()
 expect(within(door()).getByText('Parents only')).toBeInTheDocument()
 expect(within(door()).queryByText('Sample note')).not.toBeInTheDocument()
 expect(screen.getByRole('button',{name:'Family dinner · Sunday 6 PM'})).toBeInTheDocument()
 // Geometry persists, but private note bodies never enter browser storage.
 fireEvent.click(screen.getByRole('button',{name:'Open collage door'}))
 fireEvent.click(screen.getByRole('button',{name:'Arrange items'}))
 fireEvent.keyDown(screen.getByRole('button',{name:'The family dog'}),{key:'ArrowRight',altKey:true})
 const stored=localStorage.getItem('fridge-layout:p_mom')!
 expect(stored).not.toContain('library');expect(Object.values(JSON.parse(stored))).toEqual([expect.objectContaining({x:expect.any(Number),y:expect.any(Number),width:expect.any(Number),rotation:expect.any(Number)})])
 fireEvent.click(within(door()).getByRole('button',{name:'Open posted note: Bring the library book.'}))
 fireEvent.click(await screen.findByRole('button',{name:'Edit note'}))
 fireEvent.change(within(screen.getByRole('form',{name:'Edit fridge note'})).getByRole('textbox',{name:'Note text'}),{target:{value:'Bring the blue folder.'}})
 const update=vi.spyOn(adapter,'updateFridgeNote').mockRejectedValueOnce(Error('NETWORK_ERROR'))
 fireEvent.click(screen.getByRole('button',{name:'Save note'}))
 expect(await screen.findByText(/Couldn’t confirm this change/)).toBeInTheDocument()
 expect(document.querySelector('[aria-label="Posted fridge notes"]')).toHaveTextContent('Bring the library book.')
 expect(document.querySelector('[aria-label="Posted fridge notes"]')).not.toHaveTextContent('blue folder')
 fireEvent.click(screen.getByRole('button',{name:'Save note'}))
 await screen.findByText('Saved.');expect(update).toHaveBeenCalledTimes(2)
 fireEvent.click(screen.getByRole('button',{name:'Close editor'}))
 expect(within(door()).getByText('Bring the blue folder.')).toBeInTheDocument()
 fireEvent.click(within(door()).getByRole('button',{name:'Open posted note: Bring the blue folder.'}))
 const remove=vi.spyOn(adapter,'removeFridgeNote').mockRejectedValueOnce(Error('DB_UNAVAILABLE'))
 fireEvent.click(await screen.findByRole('button',{name:'Remove'}));fireEvent.click(screen.getByRole('button',{name:'Confirm remove'}))
 await screen.findByText('Couldn’t save this change just now. Try again.')
 expect(document.querySelector('[aria-label="Posted fridge notes"]')).toHaveTextContent('Bring the blue folder.')
 fireEvent.click(screen.getByRole('button',{name:'Confirm remove'}));await screen.findByText('Saved.');expect(remove).toHaveBeenCalledTimes(2)
 fireEvent.click(screen.getByRole('button',{name:'Close editor'}));expect(screen.queryByRole('region',{name:'Posted fridge notes'})).not.toBeInTheDocument()
 // Restore a confirmed record, then change perspective. The previous person's
 // note must disappear before the next persona's refused read can settle.
 adapter.postFridgeNote=post
 fireEvent.click(screen.getByRole('button',{name:'Family notes (0)'}))
 fireEvent.change(screen.getByRole('textbox',{name:'Note text'}),{target:{value:'Private next-week reminder'}})
 fireEvent.click(screen.getByRole('button',{name:'Post privately'}));await screen.findByText('Saved.')
 fireEvent.click(screen.getByRole('button',{name:'Close editor'}));expect(door()).toHaveTextContent('Private next-week reminder')
 fireEvent.click(screen.getByRole('button',{name:'Switch person'}))
 expect(screen.queryByText('Private next-week reminder')).not.toBeInTheDocument()
 await waitFor(()=>expect(screen.getByRole('button',{name:'Explore as Priya'})).toBeEnabled())
 fireEvent.click(screen.getByRole('button',{name:'Explore as Priya'}))
 fireEvent.click(await screen.findByRole('link',{name:'The Fridge'}))
 fireEvent.click(await screen.findByRole('button',{name:'Family notes'}))
 expect(await screen.findByText('Fridge notes are not shared with this perspective.')).toBeInTheDocument()
 expect(document.querySelector('[aria-label="Posted fridge notes"]')).toBeNull()
 expect(screen.queryByText('Private next-week reminder')).not.toBeInTheDocument()
 expect(JSON.stringify(localStorage)).not.toMatch(/library|blue folder|Private next-week/)
})
