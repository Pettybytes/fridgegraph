import {act,fireEvent,render,screen} from '@testing-library/react'
import {expect,it,vi} from 'vitest'
import {SessionProvider,useSession} from './Session'
import {createMockAuthAdapter} from './auth'
import type {AuthAdapter,AuthSession} from './auth'
import {PerspectiveError} from './liveAuth'
import {retryReadOnce} from './renewal'
let state:ReturnType<typeof useSession>
function Controls(){state=useSession();return <><p>{state.session?.persona.name??'Picker'}</p><p role="alert">{state.error}</p><button onClick={()=>{void state.switchPerson('kendra')}}>Kendra</button><button onClick={()=>{void state.switchPerson('dana')}}>Dana</button><button onClick={()=>{void state.switchPerson()}}>Leave</button></>}
async function raw(id:'kendra'|'dana'='kendra',expiry=Date.now()/1000+3600){const s=await createMockAuthAdapter().signInAsPersona(id);return {...s,accessToken:'test-only-session',expiresAt:expiry,marks:{demo:true,demoGuide:false}}}
async function mount(adapter:AuthAdapter){render(<SessionProvider adapter={adapter}><Controls/></SessionProvider>);fireEvent.click(screen.getByRole('button',{name:'Kendra'}));await act(async()=>{})}
it('renews from actual expiry at four minutes before, single-flight',async()=>{
 vi.useFakeTimers();const first=await raw();let resolve!:(value:Omit<AuthSession,'generation'>)=>void
 const choose=vi.fn<AuthAdapter['signInAsPersona']>().mockResolvedValueOnce(first).mockImplementation(()=>new Promise(r=>{resolve=r}))
 await mount({...createMockAuthAdapter(),mode:'live',signInAsPersona:choose})
 await act(async()=>{vi.advanceTimersByTime(3359000)});expect(choose).toHaveBeenCalledTimes(1)
 await act(async()=>{vi.advanceTimersByTime(1000)});expect(choose).toHaveBeenCalledTimes(2)
 void state.renewSession();void state.renewSession();expect(choose).toHaveBeenCalledTimes(2)
 await act(async()=>resolve({...first,expiresAt:Date.now()/1000+3600}));expect(state.session?.expiresAt).toBe(Date.now()/1000+3600);vi.useRealTimers()
})
it('unchanged expiry backs off 30, 60, 120 seconds with no tight loop',async()=>{
 vi.useFakeTimers();const first=await raw('kendra',Date.now()/1000+240),choose=vi.fn<AuthAdapter['signInAsPersona']>().mockResolvedValue(first)
 await mount({...createMockAuthAdapter(),mode:'live',signInAsPersona:choose})
 await act(async()=>{vi.advanceTimersByTime(0)});expect(choose).toHaveBeenCalledTimes(2)
 await act(async()=>{vi.advanceTimersByTime(29999)});expect(choose).toHaveBeenCalledTimes(2)
 await act(async()=>{vi.advanceTimersByTime(1)});expect(choose).toHaveBeenCalledTimes(3)
 await act(async()=>{vi.advanceTimersByTime(60000)});expect(choose).toHaveBeenCalledTimes(4)
 await act(async()=>{vi.advanceTimersByTime(119999)});expect(choose).toHaveBeenCalledTimes(4);vi.useRealTimers()
})
it('failed renewal honors a longer Retry-After and expired sessions return to the picker',async()=>{
 vi.useFakeTimers();const first=await raw('kendra',Date.now()/1000+45),choose=vi.fn<AuthAdapter['signInAsPersona']>().mockResolvedValueOnce(first).mockRejectedValue(new PerspectiveError(false,60000))
 await mount({...createMockAuthAdapter(),mode:'live',signInAsPersona:choose});await act(async()=>{vi.advanceTimersByTime(0)});expect(choose).toHaveBeenCalledTimes(2)
 await act(async()=>{vi.advanceTimersByTime(45010)});expect(state.session).toBeNull();expect(screen.getByRole('alert')).toHaveTextContent('Your session ended, choose a perspective again');expect(choose).toHaveBeenCalledTimes(2);vi.useRealTimers()
})
it('late renewal after switching is discarded, token dropped and caches cleared, without sign-out',async()=>{
 let resolve!:(value:Omit<AuthSession,'generation'>)=>void;const initial=await raw(),dana=await raw('dana'),choose=vi.fn<AuthAdapter['signInAsPersona']>().mockResolvedValueOnce(initial).mockImplementationOnce(()=>new Promise(r=>{resolve=r})).mockResolvedValue(dana)
 await mount({...createMockAuthAdapter(),mode:'live',signInAsPersona:choose});const generation=state.getSessionGeneration(),clear=vi.fn();state.registerPrivateCleanup(clear)
 const pending=state.renewSession();await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:'Dana'}));expect(clear).toHaveBeenCalledTimes(1);expect(state.getCurrentSession()).toBeNull();await act(async()=>{})
 await act(async()=>resolve({...initial,expiresAt:Date.now()/1000+7200}));await pending;expect(state.session?.persona.id).toBe('dana');expect(state.getSessionGeneration()).toBeGreaterThan(generation)
})
it('late login cannot replace a newer perspective and leaving clears the session',async()=>{
 let resolve!:(value:Omit<AuthSession,'generation'>)=>void;const initial=await raw(),dana=await raw('dana'),choose=vi.fn<AuthAdapter['signInAsPersona']>().mockImplementationOnce(()=>new Promise(r=>{resolve=r})).mockResolvedValue(dana)
 await mount({...createMockAuthAdapter(),mode:'live',signInAsPersona:choose});fireEvent.click(screen.getByRole('button',{name:'Dana'}));await act(async()=>{});await act(async()=>resolve(initial));expect(state.session?.persona.id).toBe('dana')
 fireEvent.click(screen.getByRole('button',{name:'Leave'}));expect(state.getCurrentSession()).toBeNull();await act(async()=>{});expect(state.session).toBeNull()
})
it('retries only an eligible read once, never a mutation or Rosina message',async()=>{
 const renew=vi.fn(async()=>true)
 for(const kind of ['mutation','message'] as const){const action=vi.fn(async()=>{throw {statusCode:401}});await expect(retryReadOnce(kind,action,renew,()=>true)).rejects.toMatchObject({statusCode:401});expect(action).toHaveBeenCalledTimes(1)}
 expect(renew).not.toHaveBeenCalled()
 const read=vi.fn().mockRejectedValueOnce({statusCode:401}).mockResolvedValue('ok');expect(await retryReadOnce('query',read,renew,()=>true)).toBe('ok');expect(read).toHaveBeenCalledTimes(2);expect(renew).toHaveBeenCalledTimes(1)
 const failing=vi.fn(async()=>{throw {statusCode:401}});await expect(retryReadOnce('query',failing,renew,()=>true)).rejects.toMatchObject({statusCode:401});expect(failing).toHaveBeenCalledTimes(2)
})
