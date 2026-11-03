import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {Fridge} from './Fridge'
import type {FridgeReader} from './model'
const empty:FridgeReader={read:async()=>({status:'empty'})}
const props={personId:'p',childId:'c',generation:1,reader:empty}
afterEach(()=>{cleanup();history.replaceState(null,'','#/fridge')})
function historyHash(hash:string){act(()=>{history.replaceState(null,'',hash);window.dispatchEvent(new HashChangeEvent('hashchange'))})}
it('synchronizes controls, Back, Escape and history hash changes',async()=>{
 history.replaceState(null,'','#/fridge');const {container}=render(<Fridge {...props}/>)
 const view=()=>container.querySelector('.fridge-viewport')!.getAttribute('data-view')
 fireEvent.click(screen.getByRole('button',{name:'Open collage door'}));expect(location.hash).toBe('#/fridge/notes');expect(view()).toBe('notes')
 fireEvent.click(screen.getByRole('button',{name:'Open goals door'}));expect(location.hash).toBe('#/fridge/goals');expect(view()).toBe('goals')
 fireEvent.click(screen.getByRole('button',{name:'← Back to fridge'}));expect(location.hash).toBe('#/fridge');expect(view()).toBe('overview')
 historyHash('#/fridge/notes');expect(view()).toBe('notes')
 fireEvent.keyDown(window,{key:'Escape'});expect(location.hash).toBe('#/fridge');expect(view()).toBe('overview')
 historyHash('#/fridge/goals');expect(view()).toBe('goals')
 historyHash('#/fridge');expect(view()).toBe('overview')
})
it('makes the opposite door inert, including failed read Retry controls',async()=>{
 const {container}=render(<Fridge {...props} reader={{read:async()=>({status:'failed'})}}/>)
 await screen.findByRole('button',{name:'Retry goals'})
 fireEvent.click(screen.getByRole('button',{name:'Open collage door'}))
 expect(container.querySelector('[data-fridge-door="goals"]')).toHaveAttribute('inert')
 expect(screen.queryByRole('button',{name:'Retry goals'})).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Open goals door'}))
 expect(container.querySelector('[data-fridge-door="notes"]')).toHaveAttribute('inert')
 expect(screen.queryByRole('button',{name:'Retry care notes'})).not.toBeInTheDocument()
 expect(screen.getByRole('button',{name:'Retry goals'})).toBeInTheDocument()
})
it('Retry refreshes only the failed source and cannot hide a separate refusal',async()=>{
 const read=vi.fn<FridgeReader['read']>(async source=>({status:source==='care'?'failed':'refused'}))
 render(<Fridge {...props} reader={{read}}/>);await screen.findByRole('button',{name:'Retry care notes'})
 fireEvent.click(screen.getByRole('button',{name:'Zoom in'}));fireEvent.click(screen.getByRole('button',{name:'Retry care notes'}));await waitFor(()=>expect(read).toHaveBeenCalledTimes(3))
 expect(read.mock.calls.filter(([source])=>source==='care')).toHaveLength(2)
 expect(screen.getByText("These notes aren't shared with this perspective.")).toBeInTheDocument()
})
