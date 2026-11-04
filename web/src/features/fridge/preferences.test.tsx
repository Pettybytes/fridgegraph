import {act,renderHook,waitFor} from '@testing-library/react'
import {expect,it,vi} from 'vitest'
import type {ReactNode} from 'react'
import {FridgePreferencesContext,useFridgePreferences,type PreferenceClient,type Preference} from './preferences'
const row:Preference={kind:'art',itemId:'photo',position:{x:.25,y:.2,width:.1,rotation:0},color:null,font:null}
it('keeps confirmed geometry and exposes failed saves instead of claiming success or using browser storage',async()=>{
 const client:PreferenceClient={read:async()=>[row],write:vi.fn().mockRejectedValue(Error('offline'))}
 const {result}=renderHook(()=>useFridgePreferences('child'),{wrapper:({children}:{children:ReactNode})=><FridgePreferencesContext.Provider value={client}>{children}</FridgePreferencesContext.Provider>})
 await waitFor(()=>expect(result.current.ready).toBe(true))
 await act(()=>result.current.change({kind:'art',itemId:'photo',position:{...row.position!,x:.3}}))
 expect(result.current.layout.photo.x).toBe(.25)
 expect(result.current.status).toBe('Couldn’t save the arrangement. Try again.')
 expect(result.current.pending).toBe(false)
 expect(localStorage.getItem('fridge-layout:child')).toBeNull()
})
it('does not enable changes while the preference service is unavailable',async()=>{
 const client:PreferenceClient={read:vi.fn().mockRejectedValue(Error('missing migration')),write:vi.fn()}
 const {result}=renderHook(()=>useFridgePreferences('child'),{wrapper:({children}:{children:ReactNode})=><FridgePreferencesContext.Provider value={client}>{children}</FridgePreferencesContext.Provider>})
 await waitFor(()=>expect(result.current.status).toMatch(/Couldn’t load/))
 await act(()=>result.current.change({tidy:true}))
 expect(client.write).not.toHaveBeenCalled();expect(result.current.ready).toBe(false)
})
