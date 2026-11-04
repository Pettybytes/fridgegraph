import {useLayoutEffect} from 'react'
import {act,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {ApolloClient,ApolloLink,InMemoryCache,gql} from '@apollo/client'
import {SessionProvider,useSession} from './Session'
import {createMockAuthAdapter} from './auth'
import type {AuthAdapter} from './auth'
import {ResetDemoControl} from './ResetDemoControl'
import type {DemoResetReceipt} from './demoReset'
import {DemoResetError,RESET_COMPLETE,RESET_COOLDOWN,RESET_FAILED,RESET_UNCERTAIN} from './demoReset'
let state:ReturnType<typeof useSession>
const query=gql`query ResetPrivateSelection{privateSelection}`
function Private({client,clear,verify}:{client:ApolloClient;clear:()=>void;verify:()=>Promise<void>}){
 const {registerPrivateCleanup,registerResetVerification}=useSession()
 useLayoutEffect(()=>registerPrivateCleanup(()=>{clear();return client.clearStore()}),[registerPrivateCleanup,client,clear])
 useLayoutEffect(()=>registerResetVerification(verify),[registerResetVerification,verify])
 return <p>Kendra private record and Rosina conversation</p>
}
function Harness({client,clear,verify}:{client:ApolloClient;clear:()=>void;verify:()=>Promise<void>}){state=useSession();return <><button onClick={()=>{void state.switchPerson('kendra')}}>Choose Kendra</button><button onClick={()=>{void state.switchPerson('demo-guide')}}>Choose guide</button><button onClick={()=>{void state.switchPerson('dana')}}>Choose Dana</button><p>{state.session?.persona.name??'Picker'}</p>{state.error&&<p role="alert">{state.error}</p>}{state.session&&<Private client={client} clear={clear} verify={verify}/>}<ResetDemoControl/></>}
async function mount({reset=vi.fn<AuthAdapter['resetDemo']>(async()=>({runId:'test-run',status:'committed',personaId:'kendra',session:null})),verify=vi.fn(async()=>{}),live=false}:{reset?:AuthAdapter['resetDemo'];verify?:()=>Promise<void>;live?:boolean}={}){
 const base=createMockAuthAdapter(),client=new ApolloClient({cache:new InMemoryCache(),link:ApolloLink.empty()}),clear=vi.fn()
 client.writeQuery({query,data:{privateSelection:'Kendra private record'}})
 const adapter:AuthAdapter={...base,mode:live?'live':'mock',resetDemo:reset,signInAsPersona:async id=>({...await base.signInAsPersona(id),...(live?{accessToken:'test-only-session',expiresAt:Date.now()/1000+3600,marks:{demo:true,demoGuide:id==='demo-guide'}}:{})})}
 render(<SessionProvider adapter={adapter}><Harness client={client} clear={clear} verify={verify}/></SessionProvider>);fireEvent.click(screen.getByRole('button',{name:'Choose Kendra'}));await screen.findByText('Kendra private record and Rosina conversation');return {reset,verify,clear,client}
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()})
it('renders the shared confirmation, cancel does nothing, and sends only after confirm',async()=>{
 const {reset}=await mount();fireEvent.click(screen.getByRole('button',{name:'Reset demo'}));expect(screen.getByRole('alertdialog')).toHaveTextContent('Reset the demo village for everyone?');expect(screen.getByRole('alertdialog')).toHaveTextContent('This clears alerts, responses and changes made by visitors.');expect(reset).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(reset).not.toHaveBeenCalled()
})
it('committed reset preserves persona, scope and route, replaces its token and clears private caches without waiting for graph verification',async()=>{
 let finish!:(value:DemoResetReceipt)=>void;const reset=vi.fn(()=>new Promise<DemoResetReceipt>(resolve=>{finish=resolve})),verify=vi.fn(()=>new Promise<void>(()=>{}))
 const {clear,client}=await mount({reset,verify,live:true}),generation=state.getSessionGeneration(),scope=state.session?.scope
 window.history.replaceState(null,'','?view=selection#/orbit?alertId=private')
 fireEvent.click(screen.getByRole('button',{name:'Reset demo'}));fireEvent.click(screen.getByRole('button',{name:'Reset demo for everyone'}));await act(async()=>{})
 expect(reset).toHaveBeenCalledTimes(1);expect(verify).not.toHaveBeenCalled()
 await act(async()=>finish({runId:'test-run',status:'committed',personaId:'kendra',session:{accessToken:'test-only-fresh',expiresAt:Date.now()/1000+7200}}))
 await screen.findByText(RESET_COMPLETE);expect(verify).not.toHaveBeenCalled();expect(clear).toHaveBeenCalledTimes(1);expect(client.readQuery({query})).toBeNull()
 expect(state.getCurrentSession()?.persona.id).toBe('kendra');expect(state.getCurrentSession()?.scope).toEqual(scope);expect(state.getCurrentSession()?.accessToken).toBe('test-only-fresh');expect(state.getSessionGeneration()).toBeGreaterThan(generation)
 expect(location.search).toBe('?view=selection');expect(location.hash).toBe('#/orbit?alertId=private');expect(state.resetting).toBe(false)
})
it('committed reset without a freshly minted session retains the current valid bearer',async()=>{
 const reset=vi.fn(async()=>({runId:'test-run',status:'committed' as const,personaId:'kendra' as const,session:null}));await mount({reset,live:true})
 await act(async()=>{expect(await state.resetDemo()).toBe(true)})
 expect(state.getCurrentSession()?.accessToken).toBe('test-only-session');expect(state.getCurrentSession()?.persona.id).toBe('kendra')
})
it('a receipt for a different persona cannot install its session',async()=>{
 const reset=vi.fn(async()=>({runId:'test-run',status:'committed' as const,personaId:'dana' as const,session:{accessToken:'test-only-other',expiresAt:Date.now()/1000+3600}}));await mount({reset,live:true})
 await act(async()=>{expect(await state.resetDemo()).toBe(false)})
 expect(state.getCurrentSession()?.persona.id).toBe('kendra');expect(state.getCurrentSession()?.accessToken).toBe('test-only-session');expect(state.resetError).toBe(RESET_UNCERTAIN)
})
it.each([['failed',RESET_FAILED],['cooldown',RESET_COOLDOWN],['session',RESET_FAILED]] as const)('%s leaves the current session intact and never automatically retries',async(kind,copy)=>{
 const reset=vi.fn(async()=>{throw new DemoResetError(kind,30000)});const {verify,clear}=await mount({reset,live:true});fireEvent.click(screen.getByRole('button',{name:'Reset demo'}));fireEvent.click(screen.getByRole('button',{name:'Reset demo for everyone'}));await screen.findByText(copy);expect(state.getCurrentSession()?.accessToken).toBe('test-only-session');expect(clear).not.toHaveBeenCalled();expect(verify).not.toHaveBeenCalled();expect(reset).toHaveBeenCalledTimes(1)
})
it('an uncertain result retains perspective and never retries the reset',async()=>{
 const reset=vi.fn(async()=>{throw new DemoResetError('uncertain')});const {clear}=await mount({reset,live:true}),generation=state.getSessionGeneration();window.history.replaceState(null,'','?view=calendar#/calendar?day=2026-11-03');fireEvent.click(screen.getByRole('button',{name:'Reset demo'}));fireEvent.click(screen.getByRole('button',{name:'Reset demo for everyone'}));await screen.findByText(RESET_UNCERTAIN);expect(state.getCurrentSession()?.persona.id).toBe('kendra');expect(state.getCurrentSession()?.accessToken).toBe('test-only-session');expect(state.getSessionGeneration()).toBeGreaterThan(generation);expect(location.hash).toBe('#/calendar?day=2026-11-03');expect(location.search).toBe('?view=calendar');expect(clear).toHaveBeenCalledTimes(1);expect(reset).toHaveBeenCalledTimes(1)
})
it('slow cleanup disposal cannot block committed feedback and sees the replacement bearer immediately',async()=>{
 const reset=vi.fn<AuthAdapter['resetDemo']>(async()=>({runId:'test-run',status:'committed',personaId:'kendra',session:{accessToken:'test-only-fresh',expiresAt:Date.now()/1000+7200}}));await mount({reset,live:true})
 let bearerAtCleanup:string|undefined;const dispose=vi.fn(()=>{bearerAtCleanup=state.getCurrentSession()?.accessToken;return new Promise<void>(()=>{})});state.registerPrivateCleanup(dispose)
 await act(async()=>{expect(await state.resetDemo()).toBe(true)})
 expect(dispose).toHaveBeenCalledTimes(1);expect(bearerAtCleanup).toBe('test-only-fresh');expect(state.notice).toBe(RESET_COMPLETE);expect(state.resetting).toBe(false)
})
it('a live adapter without a commit receipt reports uncertainty and preserves the perspective',async()=>{
 await mount({reset:async()=>{},live:true});await act(async()=>{expect(await state.resetDemo()).toBe(false)})
 expect(state.getCurrentSession()?.persona.id).toBe('kendra');expect(state.resetError).toBe(RESET_UNCERTAIN)
})
it.each(['rosa'] as const)('allows the %s guardian to reset',async(id)=>{
 const reset=vi.fn<AuthAdapter['resetDemo']>(async(_bearer,_signal,personaId)=>({runId:'test-run',status:'committed',personaId:personaId!,session:null}));await mount({reset,live:true})
 await act(async()=>{await state.switchPerson(id)})
 expect(screen.getByRole('button',{name:'Reset demo'})).toBeVisible()
 await act(async()=>{expect(await state.resetDemo()).toBe(true)})
 expect(reset).toHaveBeenCalledTimes(1);expect(state.getCurrentSession()?.persona.id).toBe(id)
})
it.each(['loretta','priya','whitfield'] as const)('hides reset for %s and blocks direct handler calls',async(id)=>{
 const {reset}=await mount({live:true});await act(async()=>{await state.switchPerson(id)})
 expect(screen.queryByRole('button',{name:'Reset demo'})).not.toBeInTheDocument();await act(async()=>{expect(await state.resetDemo()).toBe(false)});expect(reset).not.toHaveBeenCalled()
})
it('late reset completion cannot clear a newer perspective',async()=>{
 let finish!:()=>void;const reset=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve}));await mount({reset,live:true});fireEvent.click(screen.getByRole('button',{name:'Reset demo'}));fireEvent.click(screen.getByRole('button',{name:'Reset demo for everyone'}));await act(async()=>{});await act(async()=>{await state.switchPerson('dana')});await screen.findByText('Dana');await act(async()=>finish());expect(state.getCurrentSession()?.persona.id).toBe('dana');expect(screen.queryByText(RESET_COMPLETE)).not.toBeInTheDocument()
})
it('another tab keeps its session and token; the next explicit read needs no login or reset replay',async()=>{
 const holders:ReturnType<typeof useSession>[]=[],chooses:ReturnType<typeof vi.fn>[]=[],resets:ReturnType<typeof vi.fn>[]=[]
 function Tab({id}:{id:number}){holders[id]=useSession();useLayoutEffect(()=>holders[id].registerResetVerification(async()=>{}),[id]);return <p>Tab {id}</p>}
 const adapters=[0,1].map(id=>{const base=createMockAuthAdapter(),choose=vi.fn<AuthAdapter['signInAsPersona']>(async name=>({...await base.signInAsPersona(name),accessToken:`test-only-tab-${id}`,expiresAt:Date.now()/1000+3600,marks:{demo:true,demoGuide:false}})),reset=vi.fn(async()=>({runId:'test-run',status:'committed' as const,personaId:'kendra' as const,session:null}));chooses.push(choose);resets.push(reset);return {...base,mode:'live' as const,signInAsPersona:choose,resetDemo:reset}})
 render(<><SessionProvider adapter={adapters[0]}><Tab id={0}/></SessionProvider><SessionProvider adapter={adapters[1]}><Tab id={1}/></SessionProvider></>);await act(async()=>{await holders[0].switchPerson('kendra');await holders[1].switchPerson('kendra')});const token=holders[1].getCurrentSession()?.accessToken,generation=holders[1].getSessionGeneration()
 await act(async()=>{await holders[0].resetDemo()});expect(holders[0].getCurrentSession()?.persona.id).toBe('kendra');expect(holders[1].getCurrentSession()?.accessToken).toBe(token);expect(holders[1].getSessionGeneration()).toBe(generation);expect(await holders[1].runRead(async()=> 'seeded data')).toBe('seeded data');expect(chooses[1]).toHaveBeenCalledTimes(1);expect(resets[0]).toHaveBeenCalledTimes(1);expect(resets[1]).not.toHaveBeenCalled()
})
it('cooldown expiry only enables a manual confirmation; it never schedules another reset',async()=>{
 const reset=vi.fn(async()=>{throw new DemoResetError('cooldown',30000)});await mount({reset,live:true});vi.useFakeTimers();fireEvent.click(screen.getByRole('button',{name:'Reset demo'}));await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Reset demo for everyone'}))});expect(screen.getByRole('button',{name:'Reset demo for everyone'})).toBeDisabled();await act(async()=>{await vi.advanceTimersByTimeAsync(30001)});expect(reset).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'Reset demo for everyone'})).toBeEnabled();await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Reset demo for everyone'}))});expect(reset).toHaveBeenCalledTimes(2)
})

it('guide Reset names its Ellison boundary and requires confirmation',async()=>{
 const {reset}=await mount({live:true});await act(async()=>{await state.switchPerson('demo-guide')})
 fireEvent.click(screen.getByRole('button',{name:'Reset demo'}))
 expect(screen.getByRole('alertdialog')).toHaveTextContent('Other families stay unchanged')
 expect(reset).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'Reset Ellison showcase'}))
 await act(async()=>{})
 expect(reset).toHaveBeenCalledTimes(1)
 expect(state.getCurrentSession()?.persona.id).toBe('demo-guide')
})
