import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {Fridge} from './Fridge'
import {familyArt,ellisonSlots} from './packs'
import {samples,type FridgeReader} from './model'
afterEach(()=>{cleanup();history.replaceState(null,'','#/fridge')})
it('selects approved art by recorded child ID, never by a display name',()=>{
 expect(familyArt('p_nora').slots).toEqual(ellisonSlots)
 for(const id of ['p_jax','Nora','Ellison','unknown'])expect(familyArt(id).slots).toBe(samples)
 expect(ellisonSlots.every(slot=>slot.source==='sample'&&slot.owner===null&&!slot.destination)).toBe(true)
})
it('shows DOM sample content and preserves independent caller reads with the pack',async()=>{
 const read=vi.fn<FridgeReader['read']>(async()=>({status:'empty'}));const art=familyArt('p_nora')
 render(<Fridge personId="p_mom" childId="p_nora" generation={1} reader={{read}} sampleSlots={art.slots} artLabel={art.label}/>)
 await waitFor(()=>expect(read).toHaveBeenCalledTimes(2))
 expect(read.mock.calls.map(([source])=>source).sort()).toEqual(['care','goals'])
 expect(screen.getByRole('button',{name:'The family dog'})).toBeInTheDocument()
 expect(screen.getByText('Family dinner · Sunday 6 PM')).toBeInTheDocument()
 expect(screen.getByText('Sample note')).toBeInTheDocument()
 expect(screen.getByText('Saturday, December 12, 2026')).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Permission slip'}));expect(screen.getByRole('dialog')).toHaveTextContent('Not submitted; no consent record created.')
 expect(screen.queryByRole('button',{name:/sign|submit|book/i})).not.toBeInTheDocument()
})
it('clears pack artwork and dialogs when the selected family changes',async()=>{
 const reader:FridgeReader={read:async()=>({status:'empty'})};const nora=familyArt('p_nora'),jax=familyArt('p_jax')
 const view=render(<Fridge personId="p_mom" childId="p_nora" generation={1} reader={reader} sampleSlots={nora.slots} artLabel={nora.label}/>)
 fireEvent.click(screen.getByRole('button',{name:'The family dog'}))
 view.rerender(<Fridge personId="p_dana" childId="p_jax" generation={2} reader={reader} sampleSlots={jax.slots} artLabel={jax.label}/>)
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'The family dog'})).not.toBeInTheDocument()
 expect(screen.getByRole('button',{name:'A quiet afternoon'})).toBeInTheDocument()
})
it('keeps layout instructions in an accessible help popover',()=>{
 render(<Fridge personId="p" childId="c" generation={1} reader={{read:async()=>({status:'empty'})}}/>)
 expect(screen.queryByText(/Alt \+ arrow/)).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Fridge layout and keyboard help'}))
 expect(screen.getByText(/Alt \+ arrow/)).toBeVisible()
 fireEvent.click(screen.getByRole('button',{name:'Close fridge help'}))
 expect(screen.queryByText(/Alt \+ arrow/)).not.toBeInTheDocument()
})
it('offers readable overview sample cards and keeps the save-the-date time concise',()=>{
 const art=familyArt('p_nora')
 render(<Fridge personId="p_mom" childId="p_nora" generation={1} reader={{read:async()=>({status:'empty'})}} sampleSlots={art.slots} artLabel={art.label}/>)
 for(const name of ['Retirement','Permission slip','Sitter schedule'])expect(screen.getByRole('button',{name:`Open sample ${name}`})).toHaveTextContent(name)
 expect(screen.getByText('2 PM')).toBeInTheDocument();expect(screen.queryByText(/America\/Detroit/)).not.toBeInTheDocument()
})
