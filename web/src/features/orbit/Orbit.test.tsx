import {StrictMode} from 'react'
import type {ReactNode} from 'react'
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {createMockAuthAdapter} from '@/features/personas/auth'
import {SessionProvider,useSession} from '@/features/personas/Session'
import {RosinaPanel} from '@/features/rosina/RosinaPanel'
import {catalog} from '@/features/rosina/catalog'
import {OrbitController} from './controller'
import {OrbitProvider,useOrbitPhoto} from './runtime'
import {OrbitView} from './Orbit'
import type {OrbitAdapter} from './adapter'
const guidance='If there is an emergency, call 911.'
function fixture(){
 const adapter:OrbitAdapter={check:vi.fn(async()=>({recorded:false,label:'4:00 check-in',text:'check-in not recorded',dueAt:'2026-10-30T20:00:00Z',guidance})),vocabulary:vi.fn(async()=>[{kind:'WEAR_COLOR',value:'red',version:1}]),status:vi.fn(async()=>({alertId:null,status:null,audienceCount:0,notifiedCount:0,latestResponses:[],guidance})),alert:vi.fn(async()=>null),draft:vi.fn(async()=>({draftId:'oa_test',draftVersion:1,status:'PENDING_ACTIVATION',guidance})),preview:vi.fn(async()=>({draftId:'oa_test',draftVersion:1,message:'Exact returned message.\nNo changes.',messageHash:'test-binding',audienceSize:3,guidance})),activate:vi.fn(),respond:vi.fn(),close:vi.fn(),upload:vi.fn(async()=>'ph_test'),photo:vi.fn(async()=>new Blob(['test']))}
 const controller=new OrbitController(adapter,{childId:'p_nora',personId:'p_mom',parent:true,readOnly:false,generation:1},()=>1)
 return {adapter,controller}
}
function Login(){const {switchPerson,session}=useSession();return <button onClick={()=>{void switchPerson(session?undefined:'kendra')}}>{session?'Leave test perspective':'Enter test perspective'}</button>}
function SignedInTest({controller,children}:{controller:OrbitController;children:ReactNode}){const {session}=useSession();return session?<OrbitProvider controller={controller}>{children}</OrbitProvider>:null}
function SessionReady({children}:{children:ReactNode}){return useSession().session?<>{children}</>:null}
function Wrapper({controller,children}:{controller:OrbitController;children:ReactNode}){return <SessionProvider adapter={createMockAuthAdapter()}><Login/><SignedInTest controller={controller}>{children}</SignedInTest></SessionProvider>}
const initialImplemented=catalog.prepareOrbitAlert.implemented
afterEach(()=>{catalog.prepareOrbitAlert.implemented=initialImplemented;vi.unstubAllGlobals();vi.restoreAllMocks()})
it('card receipt/rendering never mutates; only its click prepares, and activation still needs confirmation',async()=>{
 catalog.prepareOrbitAlert.implemented=true
 const {adapter,controller}=fixture(),service={mode:'live' as const,send:vi.fn(async()=>({reply:'Review your Orbit message.',actions:[{id:'prepareOrbitAlert',args:{childId:'p_nora',wearColor:'red'}}]}))}
 render(<Wrapper controller={controller}><RosinaPanel service={service}/><OrbitView controller={controller}/></Wrapper>);fireEvent.click(screen.getByText('Enter test perspective'));await waitFor(()=>expect(controller.canPrepare()).toBe(true))
 fireEvent.change(screen.getByLabelText('Message Rosina'),{target:{value:'Prepare an Orbit message'}});fireEvent.submit(screen.getByLabelText('Message Rosina').closest('form')!);await screen.findByText('I can prepare an Orbit message for you to review. Nothing has been activated.')
 expect(adapter.draft).not.toHaveBeenCalled();expect(adapter.preview).not.toHaveBeenCalled();const card=await screen.findByRole('button',{name:'Prepare Orbit alert'});fireEvent.click(card)
 await screen.findByText('Exact returned message. No changes.');expect(screen.getByRole('region',{name:'Message preview'}).querySelector('blockquote')?.textContent).toBe('Exact returned message.\nNo changes.');expect(adapter.draft).toHaveBeenCalledTimes(1);expect(adapter.preview).toHaveBeenCalledTimes(1);expect(adapter.activate).not.toHaveBeenCalled();expect(screen.getByText('Your approved village (3 people) will be notified.')).toBeVisible();expect(screen.getByText(guidance)).toBeVisible()
 fireEvent.change(screen.getByLabelText('Clothing color'),{target:{value:''}});expect(screen.getByRole('button',{name:'Confirm and activate Orbit'})).toBeDisabled();expect(adapter.preview).toHaveBeenCalledTimes(1);expect(adapter.activate).not.toHaveBeenCalled()
})
it('unimplemented metadata prevents usable preparation cards',async()=>{
 catalog.prepareOrbitAlert.implemented=false
 const {controller}=fixture(),service={mode:'live' as const,send:vi.fn(async()=>({reply:'Prepare.',actions:[{id:'prepareOrbitAlert',args:{childId:'p_nora'}}]}))}
 render(<Wrapper controller={controller}><RosinaPanel service={service}/></Wrapper>);fireEvent.click(screen.getByText('Enter test perspective'));await waitFor(()=>expect(controller.canPrepare()).toBe(true));fireEvent.change(screen.getByLabelText('Message Rosina'),{target:{value:'Prepare'}});fireEvent.submit(screen.getByLabelText('Message Rosina').closest('form')!);await screen.findByText('Prepare.');expect(screen.queryByRole('button',{name:'Prepare Orbit alert'})).not.toBeInTheDocument()
})
function Photo({controller,id}:{controller:OrbitController;id?:string}){const image=useOrbitPhoto(controller,id);return image.url?<img src={image.url} alt="Shared photo"/>:<p>No rendered photo</p>}
it('photo rendering revokes opaque handles on replacement and unmount, with no stale frame',async()=>{
 const {controller}=fixture();const create=vi.fn().mockReturnValueOnce('temporary-handle-one').mockReturnValueOnce('temporary-handle-two'),revoke=vi.fn();vi.stubGlobal('URL',class extends URL{static createObjectURL=create;static revokeObjectURL=revoke})
 const view=render(<Photo controller={controller} id="ph_one"/>);await screen.findByAltText('Shared photo');view.rerender(<Photo controller={controller} id="ph_two"/>);expect(screen.queryByAltText('Shared photo')).not.toBeInTheDocument();await waitFor(()=>expect(create).toHaveBeenCalledTimes(2));expect(revoke).toHaveBeenCalledWith('temporary-handle-one');view.unmount();expect(revoke).toHaveBeenCalledWith('temporary-handle-two')
})
it('a late photo after disposal/unmount creates no rendering handle',async()=>{
 const {controller,adapter}=fixture();let finish!:(blob:Blob)=>void;vi.mocked(adapter.photo).mockImplementation(()=>new Promise(r=>{finish=r}));const create=vi.fn(),revoke=vi.fn();vi.stubGlobal('URL',class extends URL{static createObjectURL=create;static revokeObjectURL=revoke});const view=render(<Photo controller={controller} id="ph_pending"/>);view.unmount();controller.dispose();await act(async()=>finish(new Blob(['late'])));expect(create).not.toHaveBeenCalled();expect(revoke).not.toHaveBeenCalled()
})

it('enabled metadata without a wired controller still cannot render a usable preparation card',async()=>{
 catalog.prepareOrbitAlert.implemented=true
 const service={mode:'live' as const,send:vi.fn(async()=>({reply:'Prepare.',actions:[{id:'prepareOrbitAlert',args:{childId:'p_nora'}}]}))}
 render(<SessionProvider adapter={createMockAuthAdapter()}><Login/><SessionReady><RosinaPanel service={service}/></SessionReady></SessionProvider>);fireEvent.click(screen.getByText('Enter test perspective'));await screen.findByLabelText('Message Rosina');fireEvent.change(screen.getByLabelText('Message Rosina'),{target:{value:'Prepare'}});fireEvent.submit(screen.getByLabelText('Message Rosina').closest('form')!);await screen.findByText('Prepare.');expect(screen.queryByRole('button',{name:'Prepare Orbit alert'})).not.toBeInTheDocument()
})
it('Strict Mode effect replay keeps the read controller usable; real unmount disposes it',async()=>{
 const {controller}=fixture();const view=render(<StrictMode><Wrapper controller={controller}><p>Orbit lifecycle</p></Wrapper></StrictMode>);fireEvent.click(screen.getByText('Enter test perspective'));await waitFor(()=>expect(controller.canPrepare()).toBe(true));view.unmount();await act(async()=>{await Promise.resolve()});expect(controller.canPrepare()).toBe(false)
})

it('leaving a perspective clears and revokes its rendered photo',async()=>{
 const {controller}=fixture();const revoke=vi.fn();vi.stubGlobal('URL',class extends URL{static createObjectURL=()=> 'temporary-private-handle';static revokeObjectURL=revoke})
 render(<Wrapper controller={controller}><Photo controller={controller} id="ph_test"/></Wrapper>);fireEvent.click(screen.getByText('Enter test perspective'));await screen.findByAltText('Shared photo');fireEvent.click(screen.getByText('Leave test perspective'));expect(screen.queryByAltText('Shared photo')).not.toBeInTheDocument();expect(revoke).toHaveBeenCalledWith('temporary-private-handle');expect(controller.getSnapshot().photoId).toBeUndefined()
})

it('confirmed reset preserves the perspective while clearing Rosina and disposing private Orbit state (#239)',async()=>{
 const {controller}=fixture(),revoke=vi.fn();vi.stubGlobal('URL',class extends URL{static createObjectURL=()=> 'temporary-reset-private-handle';static revokeObjectURL=revoke})
 const {ResetDemoControl}=await import('@/features/personas/ResetDemoControl')
 const service={mode:'mock' as const,send:vi.fn(async()=>({reply:'Private reset test answer',actions:[]}))}
 function ResetPage(){const {session}=useSession();return <><Login/>{session&&<OrbitProvider key={session.generation} controller={controller}><p>Perspective: {session.persona.name}</p><Photo controller={controller} id="ph_reset"/><RosinaPanel service={service}/><ResetDemoControl/></OrbitProvider>}</>}
 render(<SessionProvider adapter={createMockAuthAdapter()}><ResetPage/></SessionProvider>);fireEvent.click(screen.getByText('Enter test perspective'));await screen.findByAltText('Shared photo')
 fireEvent.change(screen.getByLabelText('Message Rosina'),{target:{value:'Private reset question'}});fireEvent.submit(screen.getByLabelText('Message Rosina').closest('form')!);await screen.findByText('Private reset test answer')
 fireEvent.click(screen.getByRole('button',{name:'Reset demo'}));expect(revoke).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Reset demo for everyone'}));await screen.findByText('Demo reset.');expect(screen.getByText('Perspective: Kendra')).toBeVisible()
 expect(screen.queryByAltText('Shared photo')).not.toBeInTheDocument();expect(screen.queryByText('Private reset test answer')).not.toBeInTheDocument();expect(screen.queryByText('Private reset question')).not.toBeInTheDocument();expect(revoke).toHaveBeenCalledWith('temporary-reset-private-handle');expect(controller.current()).toBe(false)
})

it('retains an early preparation card disabled until authority and vocabulary finish, without trusting model preview claims',async()=>{
 catalog.prepareOrbitAlert.implemented=true
 const {adapter,controller}=fixture();let finish!:Awaited<ReturnType<OrbitAdapter['vocabulary']>> extends infer V?(v:V)=>void:never
 vi.mocked(adapter.vocabulary).mockImplementation(()=>new Promise(r=>{finish=r}))
 const service={mode:'live' as const,send:vi.fn(async()=>({reply:"Here's the exact preview. I've prepared it already.",actions:[{id:'prepareOrbitAlert',args:{childId:'p_nora',wearColor:'red'}}]}))}
 render(<Wrapper controller={controller}><RosinaPanel service={service}/><OrbitView controller={controller}/></Wrapper>);fireEvent.click(screen.getByText('Enter test perspective'))
 fireEvent.change(await screen.findByLabelText('Message Rosina'),{target:{value:'Prepare'}});fireEvent.submit(screen.getByLabelText('Message Rosina').closest('form')!)
 const card=await screen.findByRole('button',{name:'Prepare Orbit alert'});expect(card).toBeDisabled();expect(screen.getByText('Loading shared Orbit records…')).toBeVisible();expect(screen.queryByText(/prepared it already/)).not.toBeInTheDocument();fireEvent.click(card);expect(adapter.draft).not.toHaveBeenCalled()
 await act(async()=>finish([{kind:'WEAR_COLOR',value:'red',version:1}]));await waitFor(()=>expect(card).toBeEnabled());expect(adapter.draft).not.toHaveBeenCalled();fireEvent.click(card);await screen.findByText("Here's the exact preview");expect(adapter.activate).not.toHaveBeenCalled()
})
it('labels only a matching successful preview as exact; stale in-flight input cannot enable confirmation',async()=>{
 const {adapter,controller}=fixture();let finish!:(v:Awaited<ReturnType<OrbitAdapter['preview']>>)=>void
 vi.mocked(adapter.preview).mockImplementation(()=>new Promise(r=>{finish=r}))
 render(<Wrapper controller={controller}><OrbitView controller={controller}/></Wrapper>);fireEvent.click(screen.getByText('Enter test perspective'));await waitFor(()=>expect(controller.canPrepare()).toBe(true))
 let pending!:Promise<void>;act(()=>{pending=controller.prepare({childId:'p_nora',wearColor:'red'})});await waitFor(()=>expect(adapter.preview).toHaveBeenCalledTimes(1));expect(screen.getByText('Preparing…')).toBeVisible();expect(screen.queryByText("Here's the exact preview")).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Confirm and activate Orbit'})).toBeDisabled()
 act(()=>controller.edit('wearColor',''));await act(async()=>{finish({draftId:'oa_test',draftVersion:1,message:'Late old input',messageHash:'old-binding',audienceSize:3,guidance});await pending});expect(screen.queryByText('Late old input')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Confirm and activate Orbit'})).toBeDisabled();expect(adapter.activate).not.toHaveBeenCalled()
 vi.mocked(adapter.preview).mockResolvedValue({draftId:'oa_test',draftVersion:1,message:'Current exact text',messageHash:'current-binding',audienceSize:3,guidance});await act(async()=>controller.review());expect(screen.getByText("Here's the exact preview")).toBeVisible();expect(screen.getByRole('button',{name:'Confirm and activate Orbit'})).toBeEnabled();expect(adapter.activate).not.toHaveBeenCalled();act(()=>controller.edit('wearColor','red'));expect(screen.queryByText("Here's the exact preview")).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Confirm and activate Orbit'})).toBeDisabled()
})
it('rejects a preview returned for a different draft version even without a local edit',async()=>{
 const {adapter,controller}=fixture();vi.mocked(adapter.preview).mockResolvedValue({draftId:'oa_test',draftVersion:2,message:'Mismatched preview',messageHash:'wrong-version-binding',audienceSize:3,guidance})
 render(<Wrapper controller={controller}><OrbitView controller={controller}/></Wrapper>);fireEvent.click(screen.getByText('Enter test perspective'));await waitFor(()=>expect(controller.canPrepare()).toBe(true));await act(async()=>controller.prepare({childId:'p_nora'}));expect(screen.getByRole('alert')).toBeVisible();expect(screen.queryByText('Mismatched preview')).not.toBeInTheDocument();expect(screen.queryByText("Here's the exact preview")).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Confirm and activate Orbit'})).toBeDisabled();expect(adapter.activate).not.toHaveBeenCalled()
})

it('names the closer only after this perspective receives a successful close result',async()=>{
 const {controller,adapter}=fixture()
 const alert={id:'oa_closed_test',status:'ACTIVE',child:{id:'p_nora'},message:'Recorded message',share:{photoId:null},activatedAt:null,closedAt:null,audience:[],responses:[],latestResponses:[],guidance}
 vi.mocked(adapter.status).mockResolvedValue({alertId:alert.id,status:'ACTIVE',audienceCount:0,notifiedCount:0,latestResponses:[],guidance})
 vi.mocked(adapter.alert).mockResolvedValue(alert)
 vi.mocked(adapter.close).mockResolvedValue({...alert,status:'CLOSED',closedAt:'2026-10-31T20:00:00Z'})
 render(<Wrapper controller={controller}><OrbitView controller={controller}/></Wrapper>);fireEvent.click(screen.getByText('Enter test perspective'))
 await screen.findByRole('button',{name:'Found safe'});expect(screen.queryByText(/Closed by/)).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Found safe'}));fireEvent.click(screen.getByRole('button',{name:'Confirm found safe'}))
 await screen.findByRole('heading',{name:'Closed by Kendra'});expect(adapter.close).toHaveBeenCalledTimes(1)
})
