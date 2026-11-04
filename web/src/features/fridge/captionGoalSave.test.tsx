import {act,renderHook,waitFor} from '@testing-library/react'
import {expect,it,vi} from 'vitest'
import type {ReactNode} from 'react'
import {useFridgeEditing} from './useFridgeEditing'
import {mockFridgeEditingAdapter} from './mockEditingAdapter'
import {FridgePreferencesContext,type PreferenceClient} from './preferences'
import {latestCaptions} from './captions'
const viewer={personId:'kendra',role:'PARENT' as const,sessionKey:'one'}
it('refreshes a deleted caption before save and creates a private replacement, then updates it',async()=>{
 const adapter=mockFridgeEditingAdapter([],[])
 const note=await adapter.postFridgeNote({childId:'nora',text:'Old',paperColor:'WHITE',audience:'PARENTS_ONLY',attachmentRef:'fridge-art:dog'})
 const update=vi.spyOn(adapter,'updateFridgeNote'),post=vi.spyOn(adapter,'postFridgeNote')
 const {result}=renderHook(()=>useFridgeEditing(adapter,'nora',viewer))
 await waitFor(()=>expect(result.current.notes.kind).toBe('ready'))
 await adapter.removeFridgeNote({id:note.id})
 await act(async()=>{expect(await result.current.saveCaption('dog','Oscar misses you!')).toBe(true)})
 expect(update).not.toHaveBeenCalled()
 expect(post).toHaveBeenCalledWith(expect.objectContaining({text:'Oscar misses you!',audience:'PARENTS_ONLY'}))
 await act(async()=>{expect(await result.current.saveCaption('dog','See you soon')).toBe(true)})
 expect(update).toHaveBeenCalledTimes(1)
 expect((await adapter.readNotes('nora',new AbortController().signal))[0].text).toBe('See you soon')
})
it('does not turn an authorization failure into a new caption',async()=>{
 const adapter=mockFridgeEditingAdapter([],[])
 const {result}=renderHook(()=>useFridgeEditing(adapter,'nora',viewer))
 await waitFor(()=>expect(result.current.notes.kind).toBe('ready'))
 adapter.readNotes=vi.fn().mockRejectedValue(Error('UNAUTHORIZED'))
 const post=vi.spyOn(adapter,'postFridgeNote')
 await act(async()=>{expect(await result.current.saveCaption('dog','Private')).toBe(false)})
 expect(post).not.toHaveBeenCalled()
})
it('uses the same latest duplicate caption for display and save',async()=>{
 const adapter=mockFridgeEditingAdapter([],[])
 const args={childId:'nora',paperColor:'WHITE' as const,audience:'PARENTS_ONLY' as const,attachmentRef:'fridge-art:dog'}
 const first=await adapter.postFridgeNote({...args,text:'First'})
 const last=await adapter.postFridgeNote({...args,text:'Last'})
 const notes=[{...last,updatedAt:'2026-11-03T12:00:00Z'},{...first,updatedAt:'2026-11-02T12:00:00Z'}]
 expect(latestCaptions(notes)[0].id).toBe(last.id)
 adapter.readNotes=vi.fn().mockResolvedValue(notes)
 const update=vi.spyOn(adapter,'updateFridgeNote')
 const {result}=renderHook(()=>useFridgeEditing(adapter,'nora',viewer))
 await waitFor(()=>expect(result.current.notes.kind).toBe('ready'))
 await act(()=>result.current.saveCaption('dog','Latest'))
 expect(update).toHaveBeenCalledWith(expect.objectContaining({id:last.id,text:'Latest'}))
})
it('retains a created goal ID when style saving fails and retries without another creation',async()=>{
 const adapter=mockFridgeEditingAdapter([],[]),create=vi.spyOn(adapter,'createGoal')
 const client:PreferenceClient={read:async()=>[],write:vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue([{kind:'goal',itemId:'goal-new-1',color:'green',font:'caveat',position:null}])}
 const {result}=renderHook(()=>useFridgeEditing(adapter,'nora',viewer),{wrapper:({children}:{children:ReactNode})=><FridgePreferencesContext.Provider value={client}>{children}</FridgePreferencesContext.Provider>})
 await waitFor(()=>expect(result.current.preferences.ready).toBe(true))
 let id:string|undefined
 const fields={title:'Read together',horizon:'This week',period:'WEEK' as const},marker={color:'green' as const,font:'caveat' as const}
 await act(async()=>{const saved=await result.current.saveGoal(fields,marker);expect(saved.saved).toBe(false);id=saved.id})
 expect(id).toBeTruthy();expect(result.current.notice?.text).toMatch(/Goal text saved, but/)
 await act(async()=>{expect((await result.current.saveGoal(fields,marker,id)).saved).toBe(true)})
 expect(create).toHaveBeenCalledTimes(1)
 expect(client.write).toHaveBeenLastCalledWith('nora',{kind:'goal',itemId:id,...marker})
})
it('shows the submitted caption immediately and restores the old caption on failure',async()=>{
 const adapter=mockFridgeEditingAdapter([],[])
 await adapter.postFridgeNote({childId:'nora',text:'Old caption',paperColor:'WHITE',audience:'PARENTS_ONLY',attachmentRef:'fridge-art:dog'})
 const {result}=renderHook(()=>useFridgeEditing(adapter,'nora',viewer))
 await waitFor(()=>expect(result.current.notes.kind).toBe('ready'))
 let reject!:(error:Error)=>void
 adapter.readNotes=vi.fn(()=>new Promise<import('./editingContract').FridgeNoteRecord[]>((_,fail)=>{reject=fail}))
 let pending!:Promise<boolean>
 act(()=>{pending=result.current.saveCaption('dog','New caption')})
 expect(result.current.notes.kind==='ready'&&latestCaptions(result.current.notes.items)[0].text).toBe('New caption')
 expect(result.current.pending).toBe('notes')
 await act(async()=>{reject(Error('NETWORK_ERROR'));expect(await pending).toBe(false)})
 expect(result.current.notes.kind==='ready'&&latestCaptions(result.current.notes.items)[0].text).toBe('Old caption')
 expect(result.current.notice?.kind).toBe('failed')
})
