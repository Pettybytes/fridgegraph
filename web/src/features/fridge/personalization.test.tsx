import {cleanup,fireEvent,render,screen,within} from '@testing-library/react'
import {afterEach,expect,it} from 'vitest'
import {familyArt,ellisonAlbum} from './packs'
import {Fridge} from './Fridge'
afterEach(()=>{cleanup();history.replaceState(null,'','#/fridge')})
const reader={read:async()=>({status:'empty' as const})}
it('resolves siblings/co-parent and caregiver-selected context by canonical child identity, never names or adult identity',()=>{
 const nora=familyArt('p_nora')
 for(const child of ['p_max','p_leo']){expect(familyArt(child).id).toBe(nora.id);expect(familyArt(child).album).toEqual(nora.album)}
 for(const unrelated of ['p_jax','p_emma','new-child','Nora Ellison','p_mom','p_dad'])expect(familyArt(unrelated)).toMatchObject({id:null,slots:[],album:[]})
 expect(ellisonAlbum).toHaveLength(12)
 expect(new Set(ellisonAlbum.map(a=>a.id)).size).toBe(12)
 expect(ellisonAlbum.every(a=>a.src.startsWith('/fridge/packs/ellison/')&&!a.src.includes('://'))).toBe(true)
})
it('browses large family-only previews with no persistence when attachment validation/read capability is absent',()=>{
 const art=familyArt('p_nora')
 const tree=render(<Fridge personId="parent" childId="p_nora" generation={1} reader={reader} sampleSlots={art.slots} albumAssets={art.album} boardReadOnly={false}/>)
 fireEvent.click(screen.getByRole('button',{name:'Add from family album'}))
 const dialog=screen.getByRole('dialog')
 expect(within(dialog).getByText(/preview only/)).toBeInTheDocument()
 fireEvent.click(within(dialog).getByRole('button',{name:'On the porch'}))
 expect(within(dialog).getByRole('region',{name:'Artwork preview'})).toHaveTextContent('This preview hasn’t changed your fridge.')
 expect(within(dialog).getByRole('button',{name:'Pin to fridge unavailable'})).toBeDisabled()
 expect(screen.queryByText('Saved.')).not.toBeInTheDocument()
 tree.rerender(<Fridge personId="other" childId="new-child" generation={2} reader={reader} sampleSlots={[]} albumAssets={[]}/>)
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
 expect(screen.queryByRole('button',{name:'The family dog'})).not.toBeInTheDocument()
 expect(screen.getByText(/There’s no artwork in this family album yet/)).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Add from family album'}))
 expect(screen.getByRole('dialog')).toHaveTextContent('No pictures have been provided yet.')
})
it('guide can browse artwork but gets no pin/replace/remove action',()=>{
 const art=familyArt('p_nora')
 render(<Fridge personId="guide" childId="p_nora" generation={1} reader={reader} readOnly sampleSlots={art.slots} albumAssets={art.album}/>)
 fireEvent.click(screen.getByRole('button',{name:'Add from family album'}))
 const dialog=screen.getByRole('dialog')
 expect(within(dialog).getByText('Read-only perspective.')).toBeInTheDocument()
 expect(within(dialog).queryByRole('button',{name:/pin|replace|remove/i})).not.toBeInTheDocument()
})
