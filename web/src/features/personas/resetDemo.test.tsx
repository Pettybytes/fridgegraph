import {useLayoutEffect} from 'react'
import {act,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {ApolloClient,ApolloLink,InMemoryCache,gql} from '@apollo/client'
import {SessionProvider,useSession} from './Session'
import {createMockAuthAdapter} from './auth'
import type {AuthAdapter} from './auth'
import {ResetDemoControl} from './ResetDemoControl'
import {DemoResetError,RESET_COMPLETE,RESET_COOLDOWN,RESET_FAILED,RESET_UNCERTAIN} from './demoReset'
let state:ReturnType<typeof useSession>
const query=gql`query ResetPrivateSelection{privateSelection}`
function Private({client,clear,verify}:{client:ApolloClient;clear:()=>void;verify:()=>Promise<void>}){
 const {registerPrivateCleanup,registerResetVerification}=useSession()
 useLayoutEffect(()=>registerPrivateCleanup(()=>{clear();return client.clearStore()}),[registerPrivateCleanup,client,clear])
 useLayoutEffect(()=>registerResetVerification(verify),[registerResetVerification,verify])
 return <p>Kendra private record and Rosina conversation</p>
}
function Harness({client,clear,verify}:{client:ApolloClient;clear:()=>void;verify:()=>Promise<void>}){state=useSession();return <><button onClick={()=>{void state.switchPerson('kendra')}}>Choose Kendra</button><button onClick={()=>{void state.switchPerson('demo-guide')}}>Choose guide</button><button onClick={()=>{void state.switchPerson('dana')}}>Choose Dana</button><p>{state.session?.persona.name??'Picker'}</p>{state.notice&&<p role="status">{state.notice}</p>}{state.error&&<p role="alert">{state.error}</p>}{state.session&&<Private client={client} clear={clear} verify={verify}/>}<ResetDemoControl/></>}
async function mount({reset=vi.fn(async()=>{}),verify=vi.fn(async()=>{}),live=false}={}){
 const base=createMockAuthAdapter(),client=new ApolloClient({cache:new InMemoryCache(),link:ApolloLink.empty()}),clear=vi.fn()
 client.writeQuery({query,data:{privateSelection:'Kendra private record'}})
 const adapter:AuthAdapter={...base,mode:live?'live':'mock',resetDemo:reset,signInAsPersona:async id=>({...await base.signInAsPersona(id),...(live?{accessToken:'test-only-session',expiresAt:Date.now()/1000+3600,marks:{demo:true,demoGuide:id==='demo-guide'}}:{})})}
 render(<SessionProvider adapter={adapter}><Harness client={client} clear={clear} verify={verify}/></SessionProvider>);fireEvent.click(screen.getByRole('button',{name:'Choose Kendra'}));await screen.findByText('Kendra private record and Rosina conversation');return {reset,verify,clear,client}
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()})
it('renders the shared confirmation, cancel does nothing, and sends only after confirm',async()=>{
 const {reset}=await mount();fireEvent.click(screen.getByRole('button',{name:'Reset demo'}));expect(screen.getByRole('dialog')).toHaveTextContent('Reset the demo village for everyone?');expect(screen.getByRole('dialog')).toHaveTextContent('This clears alerts, responses and changes made by visitors.');expect(reset).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(reset).not.toHaveBeenCalled()
})
it('resets once, verifies seeded reads, then drops token/generation/private state and returns to picker',async()=>{
 let finish!:()=>void;const reset=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve})),verify=vi.fn(async()=>{expect(state.getCurrentSession()?.accessToken).toBe('test-only-session');expect(screen.getByText('Kendra private record and Rosina conversation')).toBeVisible()})
 const {clear,client}=await mount({reset,verify,live:true}),generation=state.getSessionGeneration();window.history.replaceState(null,'','?private=selection#/orbit?alertId=private')
 fireEvent.click(screen.getByRole('button',{name:'Reset demo'}));fireEvent.click(screen.getByRole('button',{name:'Reset demo for everyone'}));fireEvent.click(screen.getByRole('button',{name:'Resetting demo…'}));await act(async()=>{})
 expect(reset).toHaveBeenCalledTimes(1);expect(verify).not.toHaveBeenCalled();expect(state.getCurrentSession()?.accessToken).toBe('test-only-session')
 await act(async()=>finish());await screen.findByText(RESET_COMPLETE);expect(verify).toHaveBeenCalledTimes(1);expect(clear).toHaveBeenCalledTimes(1);expect(client.readQuery({query})).toBeNull();expect(state.getCurrentSession()).toBeNull();expect(state.getSessionGeneration()).toBeGreaterThan(generation);expect(screen.queryByText('Kendra private record and Rosina conversation')).not.toBeInTheDocument();expect(location.search).toBe('');expect(location.hash).toBe('#/mission-control');expect((reset.mock.calls as unknown[][])[0]?.[0]).toBe('test-only-session')
})
it.each([['failed',RESET_FAILED],['cooldown',RESET_COOLDOWN]] as const)('%s leaves the current session intact and never automatically retries',async(kind,copy)=>{
 const reset=vi.fn(async()=>{throw new DemoResetError(kind,30000)});const {verify,clear}=await mount({reset,live:true});fireEvent.click(screen.getByRole('button',{name:'Reset demo'}));fireEvent.click(screen.getByRole('button',{name:'Reset demo for everyone'}));await screen.findByText(copy);expect(state.getCurrentSession()?.accessToken).toBe('test-only-session');expect(clear).not.toHaveBeenCalled();expect(verify).not.toHaveBeenCalled();expect(reset).toHaveBeenCalledTimes(1)
})
it('an uncertain result clears local state and never retries the reset',async()=>{
 const reset=vi.fn(async()=>{throw new DemoResetError('uncertain')});const {clear}=await mount({reset,live:true});fireEvent.click(screen.getByRole('button',{name:'Reset demo'}));fireEvent.click(screen.getByRole('button',{name:'Reset demo for everyone'}));await screen.findByText(RESET_UNCERTAIN);expect(state.getCurrentSession()).toBeNull();expect(clear).toHaveBeenCalledTimes(1);expect(reset).toHaveBeenCalledTimes(1)
})
it('failed post-reset verification clears local state with uncertainty, never replays the mutation',async()=>{
 const verify=vi.fn(async()=>{throw Error('read failed')});const {reset}=await mount({verify,live:true});fireEvent.click(screen.getByRole('button',{name:'Reset demo'}));fireEvent.click(screen.getByRole('button',{name:'Reset demo for everyone'}));await screen.findByText(RESET_UNCERTAIN);expect(state.getCurrentSession()).toBeNull();expect(reset).toHaveBeenCalledTimes(1)
})
it('hides reset for the Demo guide and blocks direct handler calls',async()=>{
 const {reset}=await mount({live:true});fireEvent.click(screen.getByRole('button',{name:'Choose guide'}));await screen.findByText('Demo guide');expect(screen.queryByRole('button',{name:'Reset demo'})).not.toBeInTheDocument();await act(async()=>{await state.resetDemo()});expect(reset).not.toHaveBeenCalled()
})
it('late reset completion cannot clear a newer perspective',async()=>{
 let finish!:()=>void;const reset=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve}));await mount({reset,live:true});fireEvent.click(screen.getByRole('button',{name:'Reset demo'}));fireEvent.click(screen.getByRole('button',{name:'Reset demo for everyone'}));await act(async()=>{});await act(async()=>{await state.switchPerson('dana')});await screen.findByText('Dana');await act(async()=>finish());expect(state.getCurrentSession()?.persona.id).toBe('dana');expect(screen.queryByText(RESET_COMPLETE)).not.toBeInTheDocument()
})
it('another tab keeps its session and token; the next explicit read needs no login or reset replay',async()=>{
 const holders:ReturnType<typeof useSession>[]=[],chooses:ReturnType<typeof vi.fn>[]=[],resets:ReturnType<typeof vi.fn>[]=[]
 function Tab({id}:{id:number}){holders[id]=useSession();useLayoutEffect(()=>holders[id].registerResetVerification(async()=>{}),[id]);return <p>Tab {id}</p>}
 const adapters=[0,1].map(id=>{const base=createMockAuthAdapter(),choose=vi.fn<AuthAdapter['signInAsPersona']>(async name=>({...await base.signInAsPersona(name),accessToken:`test-only-tab-${id}`,expiresAt:Date.now()/1000+3600,marks:{demo:true,demoGuide:false}})),reset=vi.fn(async()=>{});chooses.push(choose);resets.push(reset);return {...base,mode:'live' as const,signInAsPersona:choose,resetDemo:reset}})
 render(<><SessionProvider adapter={adapters[0]}><Tab id={0}/></SessionProvider><SessionProvider adapter={adapters[1]}><Tab id={1}/></SessionProvider></>);await act(async()=>{await holders[0].switchPerson('kendra');await holders[1].switchPerson('kendra')});const token=holders[1].getCurrentSession()?.accessToken,generation=holders[1].getSessionGeneration()
 await act(async()=>{await holders[0].resetDemo()});expect(holders[0].getCurrentSession()).toBeNull();expect(holders[1].getCurrentSession()?.accessToken).toBe(token);expect(holders[1].getSessionGeneration()).toBe(generation);expect(await holders[1].runRead(async()=> 'seeded data')).toBe('seeded data');expect(chooses[1]).toHaveBeenCalledTimes(1);expect(resets[0]).toHaveBeenCalledTimes(1);expect(resets[1]).not.toHaveBeenCalled()
})
