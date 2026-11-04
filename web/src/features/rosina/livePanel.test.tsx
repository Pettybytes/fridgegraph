import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {expect,it,vi} from 'vitest'
import App from '@/App'
import {SessionProvider,useSession} from '@/features/personas/Session'
import {createMockAdapter} from '@/lib/frontendData/mockAdapter'
import {RosinaPanel} from './RosinaPanel'
import type {FrontendAdapter} from '@/lib/frontendData/types'
import {createMockAuthAdapter} from '@/features/personas/auth'
import {LIVE_FALLBACK} from './liveAdapter'
async function enter(live=true){
 const base=createMockAuthAdapter()
 const auth={...base,signInAsPersona:async(id:Parameters<typeof base.signInAsPersona>[0])=>({...await base.signInAsPersona(id),...(live?{accessToken:'test-only-browser-session'}:{})})}
 window.location.hash='#/ask-rosina';render(<App authAdapter={auth}/>);fireEvent.click(screen.getByRole('button',{name:/Kendra/}));await screen.findByText('Signed in as Kendra')
}
function send(message='Who can pick up Nora?'){fireEvent.change(screen.getByLabelText('Message Rosina'),{target:{value:message}});fireEvent.submit(screen.getByLabelText('Message Rosina').closest('form')!)}
it('selects Sample answers without a bearer and makes no readiness request',async()=>{
 const request=vi.fn();vi.stubGlobal('fetch',request);await enter(false);expect(screen.getByText('Sample answers')).toBeVisible();expect(request).not.toHaveBeenCalled();vi.unstubAllGlobals()
})
it('shows Live with no TURN request before send (the warm ping is fire-and-forget), loading, plain text and only client-validated allowed cards',async()=>{
 let resolve!:(response:Response)=>void
 // The warm ping (latency playbook 6) is answered inline and must never affect the UI; turn
 // requests are counted by exact path.
 const request=vi.fn<typeof fetch>((url)=>url==='/api/rosina/warm'?Promise.resolve(new Response(JSON.stringify({ok:true}),{status:200})):new Promise(r=>{resolve=r}));vi.stubGlobal('fetch',request)
 const turnCalls=()=>request.mock.calls.filter(([u])=>u==='/api/rosina')
 await enter();expect(screen.getByText('Live')).toBeVisible();expect(turnCalls()).toHaveLength(0);send();expect(within(screen.getByRole('log',{name:'Rosina conversation'})).getByRole('status')).toHaveTextContent('Sending your question…');await waitFor(()=>expect(turnCalls()).toHaveLength(1));expect(within(screen.getByRole('log',{name:'Rosina conversation'})).getByRole('status')).toHaveTextContent('Waiting for Rosina’s reply…');expect(screen.queryByText('Talk with Rosina')).not.toBeInTheDocument();expect(within(screen.getByRole('log',{name:'Rosina conversation'})).getByRole('status')).not.toHaveTextContent(/Checking .*check-in|Looking up/);
 await act(async()=>{resolve(new Response(JSON.stringify({reply:'<img src=x onerror=bad()>Live evidence',actions:[{id:'unknown',args:{}},{id:'open-screen',args:{screen:'https://untrusted.example'}},{id:'open-person',args:{personId:'p_foreign'}},{id:'open-screen',args:{screen:'village'}}]}),{status:200}))})
 const log=screen.getByRole('log');expect(log).toHaveTextContent('<img src=x onerror=bad()>Live evidence');expect(log.querySelector('img,a,script')).toBeNull();expect(within(log).getAllByRole('button')).toHaveLength(1);expect(within(log).getByRole('button',{name:'Open Living Village'})).toBeVisible();vi.unstubAllGlobals()
})
it('stays live after failure, never displaying a sample allergy answer',async()=>{
 const request=vi.fn<typeof fetch>(async()=>new Response('stack trace',{status:503}));vi.stubGlobal('fetch',request);await enter();send('Can Nora have a peanut snack?');await screen.findByText(LIVE_FALLBACK)
 expect(screen.getByText('Live')).toBeVisible();expect(screen.queryByText('Sample answers')).not.toBeInTheDocument();expect(screen.getByRole('log')).not.toHaveTextContent(/Peanut allergy|stack trace|503/);expect(request.mock.calls.filter(([u])=>u==='/api/rosina')).toHaveLength(1);vi.unstubAllGlobals()
})
it('requires sign-in after 401 and never retries automatically',async()=>{
 const request=vi.fn<typeof fetch>(async()=>new Response('',{status:401}));vi.stubGlobal('fetch',request);await enter();send();await screen.findByText('Please sign in again');expect(request.mock.calls.filter(([u])=>u==='/api/rosina')).toHaveLength(1)
 fireEvent.change(screen.getByLabelText('Message Rosina'),{target:{value:'Again'}});expect(screen.getByRole('button',{name:'Send'})).toBeDisabled();vi.unstubAllGlobals()
})
it('panel close aborts and suppresses a late result with no fallback or error',async()=>{
 let resolve!:(response:Response)=>void,signal:AbortSignal|undefined
 vi.stubGlobal('fetch',vi.fn<typeof fetch>((_,options)=>{signal=options?.signal as AbortSignal;return new Promise(r=>{resolve=r})}));await enter();send();await waitFor(()=>expect(signal).toBeDefined())
 fireEvent.click(screen.getByRole('button',{name:'Close Ask Rosina'}));expect(signal?.aborted).toBe(true)
 await act(async()=>{resolve(new Response(JSON.stringify({reply:'Late private result',actions:[]}),{status:200}))})
 const launcher=document.querySelector<HTMLButtonElement>('.rosina-launcher')
 expect(launcher).toHaveAccessibleName('Ask Rosina');expect(launcher).toHaveAttribute('aria-expanded','false');fireEvent.click(launcher!)
 expect(screen.queryByText('Late private result')).not.toBeInTheDocument();expect(screen.queryByText(LIVE_FALLBACK)).not.toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();vi.unstubAllGlobals()
})
it('persona switch discards a late live result and all previous persona messages',async()=>{
 let resolve!:(response:Response)=>void,signal:AbortSignal|undefined
 vi.stubGlobal('fetch',vi.fn<typeof fetch>((_,options)=>{signal=options?.signal as AbortSignal;return new Promise(r=>{resolve=r})}));await enter();send('Private Kendra question');await waitFor(()=>expect(signal).toBeDefined())
 fireEvent.click(screen.getByRole('button',{name:'Switch person'}));expect(signal?.aborted).toBe(true);expect(screen.queryByText('Private Kendra question')).not.toBeInTheDocument()
 await waitFor(()=>expect(screen.getByRole('button',{name:/Loretta/})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:/Loretta/}));await screen.findByText('Signed in as Loretta')
 await act(async()=>{resolve(new Response(JSON.stringify({reply:'Late Kendra response',actions:[]}),{status:200}))})
 expect(screen.queryByText('Late Kendra response')).not.toBeInTheDocument();expect(screen.queryByText(LIVE_FALLBACK)).not.toBeInTheDocument();vi.unstubAllGlobals()
})
it('live data-changing proposals cannot bypass the app confirm even if the response says so',async()=>{
 vi.stubGlobal('fetch',vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({reply:'Review this pickup',actions:[{id:'start-pickup',args:{childId:'p_nora',date:'2026-10-30',window:'afternoon'},requiresConfirmation:false}]}),{status:200})))
 await enter();send();await screen.findByText('Review this pickup');fireEvent.click(screen.getByRole('button',{name:/Review pickup request/}));expect(screen.getByRole('dialog')).toBeVisible();expect(screen.queryByText(/did not go through/)).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Confirm pickup request'}));await screen.findByText(/not wired for this perspective. Nothing was changed/);vi.unstubAllGlobals()
})
it('closing via a catalog navigation card aborts another in-flight request',async()=>{
 let resolve!:(response:Response)=>void,signal:AbortSignal|undefined
 // URL-aware: the warm ping answers inline; the FIRST turn gets the card, the SECOND stays pending.
 const request=vi.fn<typeof fetch>((url,options)=>{
  if(url==='/api/rosina/warm')return Promise.resolve(new Response(JSON.stringify({ok:true}),{status:200}))
  if(request.mock.calls.filter(([u])=>u==='/api/rosina').length<=1)return Promise.resolve(new Response(JSON.stringify({reply:'Open your care screen',actions:[{id:'open-screen',args:{screen:'care-information'}}]}),{status:200}))
  signal=options?.signal as AbortSignal;return new Promise(r=>{resolve=r})
 })
 vi.stubGlobal('fetch',request);await enter();send('Open care');await screen.findByText('Open your care screen');send('Another question');await waitFor(()=>expect(signal).toBeDefined())
 fireEvent.click(screen.getByRole('button',{name:'Open care information'}));expect(signal?.aborted).toBe(true)
 await act(async()=>{resolve(new Response(JSON.stringify({reply:'Late navigation response',actions:[]}),{status:200}))})
 expect(screen.queryByText('Late navigation response')).not.toBeInTheDocument();expect(screen.queryByText(LIVE_FALLBACK)).not.toBeInTheDocument();vi.unstubAllGlobals()
})

it('keeps voice status and text-progress status independently visible during a text request',async()=>{
 let resolve!:(response:Response)=>void
 vi.stubGlobal('fetch',vi.fn<typeof fetch>(()=>new Promise(r=>{resolve=r})))
 await enter();send()
 const thread=screen.getByRole('log',{name:'Rosina conversation'})
 const textStatus=within(thread).getByRole('status')
 const composer=screen.getByLabelText('Message Rosina').closest('form')!
 const voiceStatus=within(composer).getByRole('status')
 expect(voiceStatus).toBeVisible()
 expect(voiceStatus).toHaveTextContent('Tap to talk to Rosina')
 expect(textStatus).toBeVisible()
 expect(textStatus).not.toBe(voiceStatus)
 await waitFor(()=>expect(textStatus).toHaveTextContent('Waiting for Rosina’s reply…'))
 expect(screen.getAllByRole('status')).toEqual(expect.arrayContaining([textStatus,voiceStatus]))
 await act(async()=>{resolve(new Response(JSON.stringify({reply:'The text reply arrived',actions:[]}),{status:200}))})
 expect(within(thread).queryByRole('status')).not.toBeInTheDocument()
 expect(voiceStatus).toBeVisible()
 expect(voiceStatus).toHaveTextContent('Tap to talk to Rosina')
 vi.unstubAllGlobals()
})

it('a streamed validated proposal renders its card before the reply finishes',async()=>{
 let push!:(chunk:string)=>void,close!:()=>void
 const stream=new ReadableStream<Uint8Array>({start(c){const enc=new TextEncoder();push=t=>c.enqueue(enc.encode(t));close=()=>c.close()}})
 const request=vi.fn<typeof fetch>(async(url)=>url==='/api/rosina/warm'?new Response('{"ok":true}'):new Response(stream,{status:200,headers:{'content-type':'text/event-stream'}}))
 vi.stubGlobal('fetch',request)
 await enter();send('Open the village for me')
 await act(async()=>{push('event: action\ndata: {"action":{"id":"open-screen","args":{"screen":"village"}}}\n\n')})
 expect(await screen.findByRole('button',{name:'Open Living Village'})).toBeEnabled()
 expect(screen.getByText('Ready for your review. Nothing happens until you confirm.')).toBeVisible()
 await act(async()=>{push('event: final\ndata: {"reply":"Opening the village view.","actions":[{"id":"open-screen","args":{"screen":"village"}}]}\n\n');close()})
 expect(await screen.findByText('Opening the village view.')).toBeVisible()
 vi.unstubAllGlobals()
})

const pickupProposal={id:'start-pickup',args:{childId:'p_nora',date:'2026-11-05',window:'afternoon'}}
function ProposalPanel({data}:{data:FrontendAdapter}){
 const {session,switchPerson}=useSession()
 return <><button onClick={()=>void switchPerson('kendra')}>Pick Kendra</button><button onClick={()=>void switchPerson()}>Switch person</button><span>{session?.persona.name}</span><RosinaPanel dataAdapter={data}/></>
}
async function streamedPickup(){
 const base=createMockAuthAdapter()
 const auth={...base,signInAsPersona:async(id:Parameters<typeof base.signInAsPersona>[0])=>({...await base.signInAsPersona(id),accessToken:'test-only-browser-session'})}
 const write=vi.fn(async()=>({id:'fixture-pickup',status:'pending'}))
 const data={...createMockAdapter(),requestPickup:write}
 const streams:ReadableStreamDefaultController<Uint8Array>[]=[]
 vi.stubGlobal('fetch',vi.fn<typeof fetch>(async url=>url==='/api/rosina/warm'?new Response('{"ok":true}'):new Response(new ReadableStream<Uint8Array>({start(c){streams.push(c)}}),{headers:{'content-type':'text/event-stream'}})))
 window.location.hash='#/ask-rosina';render(<SessionProvider adapter={auth}><ProposalPanel data={data}/></SessionProvider>);fireEvent.click(screen.getByRole('button',{name:'Pick Kendra'}));await screen.findByText('Kendra');send()
 await waitFor(()=>expect(streams).toHaveLength(1))
 const emit=async(type:string,payload:unknown,turn=0)=>{await act(async()=>{streams[turn].enqueue(new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`))})}
 await emit('action',{action:pickupProposal})
 return {emit,streams,write}
}
it('shares execution identity between early and final cards, but not between turns',async()=>{
 const {emit,streams,write}=await streamedPickup()
 fireEvent.click(await screen.findByRole('button',{name:/Review pickup request/}))
 fireEvent.click(screen.getByRole('button',{name:'Confirm pickup request'}))
 await waitFor(()=>expect(write).toHaveBeenCalledTimes(1))
 await emit('final',{reply:'Final pickup proposal',actions:[pickupProposal]})
 expect(screen.getByRole('button',{name:/Review pickup request/})).toBeDisabled()
 send('Another pickup please');await waitFor(()=>expect(streams).toHaveLength(2))
 await emit('action',{action:pickupProposal},1)
 const cards=screen.getAllByRole('button',{name:/Review pickup request/})
 expect(cards[1]).toBeEnabled();expect(write).toHaveBeenCalledTimes(1)
 fireEvent.click(cards[1]);expect(screen.getByRole('dialog')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Confirm pickup request'}));await waitFor(()=>expect(write).toHaveBeenCalledTimes(2))
 vi.unstubAllGlobals()
})
for(const ending of ['replace','final'] as const)it(`${ending} withdraws the early card and its open confirmation`,async()=>{
 const {emit,write}=await streamedPickup()
 fireEvent.click(await screen.findByRole('button',{name:/Review pickup request/}))
 const staleConfirm=screen.getByRole('button',{name:'Confirm pickup request'})
 await emit(ending,ending==='final'?{reply:'No proposal is available',actions:[]}: {})
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
 expect(screen.queryByRole('button',{name:/Review pickup request/})).not.toBeInTheDocument()
 fireEvent.click(staleConfirm)
 expect(write).not.toHaveBeenCalled()
 vi.unstubAllGlobals()
})
for(const ending of ['cancel','persona'] as const)it(`${ending} removes an open provisional confirmation and rejects late stream actions`,async()=>{
 const {emit,write}=await streamedPickup()
 fireEvent.click(await screen.findByRole('button',{name:/Review pickup request/}))
 expect(screen.getByRole('dialog')).toBeVisible()
 // A persona change can also arrive from another app control while the modal is open.
 if(ending==='persona')fireEvent.click(screen.getByText('Switch person'))
 else act(()=>window.dispatchEvent(new Event('rosina:close')))
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
 await emit('action',{action:pickupProposal})
 await emit('final',{reply:'Late proposal',actions:[pickupProposal]})
 expect(screen.queryByRole('button',{name:/Review pickup request/})).not.toBeInTheDocument()
 expect(screen.queryByText('Late proposal')).not.toBeInTheDocument()
 expect(write).not.toHaveBeenCalled()
 vi.unstubAllGlobals()
})
it('deduplicates streamed proposals and preserves execution through replacement and reordered final arguments',async()=>{
 const {emit,write}=await streamedPickup()
 await emit('action',{action:pickupProposal})
 expect(screen.getAllByRole('button',{name:/Review pickup request/})).toHaveLength(1)
 fireEvent.click(screen.getByRole('button',{name:/Review pickup request/}))
 const confirm=screen.getByRole('button',{name:'Confirm pickup request'})
 fireEvent.click(confirm);fireEvent.click(confirm)
 await waitFor(()=>expect(write).toHaveBeenCalledTimes(1))
 await emit('replace',{})
 await emit('final',{reply:'Final reordered proposal',actions:[{id:'start-pickup',args:{window:'afternoon',date:'2026-11-05',childId:'p_nora'}}]})
 expect(screen.getByRole('button',{name:/Review pickup request/})).toBeDisabled()
 expect(write).toHaveBeenCalledTimes(1)
 vi.unstubAllGlobals()
})
