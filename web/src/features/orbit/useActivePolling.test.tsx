import {act,renderHook} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import type {OrbitController} from './controller'
import {useActivePolling} from './useActivePolling'
afterEach(()=>{vi.useRealTimers();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'})})
it('does not poll idle or hidden workflows and immediately pauses when the active workflow closes',async()=>{
 vi.useFakeTimers();const refresh=vi.fn(async()=>{}),controller={refresh,getSnapshot:()=>({phase:'active',error:''})} as unknown as OrbitController
 const hook=renderHook(({active})=>useActivePolling(controller,active),{initialProps:{active:false}});await act(async()=>{await vi.advanceTimersByTimeAsync(10000)});expect(refresh).not.toHaveBeenCalled()
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});hook.rerender({active:true});await act(async()=>{await vi.advanceTimersByTimeAsync(10000)});expect(refresh).not.toHaveBeenCalled()
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});await act(async()=>{document.dispatchEvent(new Event('visibilitychange'))});expect(refresh).toHaveBeenCalledTimes(1)
 hook.rerender({active:false});await act(async()=>{await vi.advanceTimersByTimeAsync(20000)});expect(refresh).toHaveBeenCalledTimes(1);hook.unmount()
})
it('keeps one refresh in flight and backs off after an unsuccessful read',async()=>{
 vi.useFakeTimers();let finish!:()=>void;let error='';const refresh=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve})),controller={refresh,getSnapshot:()=>({phase:'active',error})} as unknown as OrbitController
 const hook=renderHook(()=>useActivePolling(controller,true));await act(async()=>{await vi.advanceTimersByTimeAsync(2000)});expect(refresh).toHaveBeenCalledTimes(1);await act(async()=>{await vi.advanceTimersByTimeAsync(16000);document.dispatchEvent(new Event('visibilitychange'))});expect(refresh).toHaveBeenCalledTimes(1)
 error='Temporary failure';await act(async()=>finish());await act(async()=>{await vi.advanceTimersByTimeAsync(3999)});expect(refresh).toHaveBeenCalledTimes(1);await act(async()=>{await vi.advanceTimersByTimeAsync(1)});expect(refresh).toHaveBeenCalledTimes(2);hook.unmount();await act(async()=>finish())
})
