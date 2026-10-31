import {describe,it,expect,vi} from 'vitest'
import {OrbitController,overdue} from './controller'
import type {OrbitAdapter,Alert,Preview,ResponseEntry} from './adapter'
const guidance='If there is an emergency, call 911.'
const preview:Preview={draftId:'oa_test',draftVersion:1,message:'Exact recorded preview.',messageHash:'recorded-hash',audienceSize:3,guidance}
const response:ResponseEntry={person:{id:'p_gma',displayName:'Loretta'},respondedAt:'2026-10-30T20:05:00Z',response:'WITH_ME'}
const alert:Alert={id:'oa_test',child:{id:'p_nora'},status:'ACTIVE',message:preview.message,share:{photoId:null},activatedAt:'2026-10-30T20:00:00Z',closedAt:null,audience:[{person:{id:'p_gma'},eligible:true}],responses:[],latestResponses:[],guidance}
function fixture(){
 const adapter={check:vi.fn<OrbitAdapter['check']>(async()=>({recorded:false,label:'4:00 check-in',text:'check-in not recorded',dueAt:'2026-10-30T20:00:00Z',guidance})),vocabulary:vi.fn<OrbitAdapter['vocabulary']>(async()=>[{kind:'WEAR_COLOR',value:'red',version:1}]),status:vi.fn<OrbitAdapter['status']>(async()=>({alertId:null,status:null,audienceCount:0,notifiedCount:0,latestResponses:[],guidance})),alert:vi.fn<OrbitAdapter['alert']>(async()=>alert),draft:vi.fn<OrbitAdapter['draft']>(async()=>({draftId:preview.draftId,draftVersion:1,status:'PENDING_ACTIVATION',guidance})),preview:vi.fn<OrbitAdapter['preview']>(async()=>preview),activate:vi.fn<OrbitAdapter['activate']>(async()=>alert),respond:vi.fn<OrbitAdapter['respond']>(async()=>{}),close:vi.fn<OrbitAdapter['close']>(async()=>({...alert,status:'CLOSED',closedAt:'2026-10-30T20:10:00Z',responses:[response]})),upload:vi.fn<OrbitAdapter['upload']>(async()=>'ph_test'),photo:vi.fn<OrbitAdapter['photo']>(async()=>new Blob())} satisfies OrbitAdapter
 let generation=1
 const controller=new OrbitController(adapter,{childId:'p_nora',personId:'p_mom',parent:true,readOnly:false,generation:1},()=>generation)
 return {adapter,controller,switchGeneration:()=>{generation++}}
}
describe('Orbit state machine',()=>{
 it('loads recorded state without a draft/preview mutation and derives overdue only from valid elapsed dueAt',async()=>{
  const {adapter,controller}=fixture();await controller.load();expect(adapter.draft).not.toHaveBeenCalled();expect(adapter.preview).not.toHaveBeenCalled()
  const check=controller.getSnapshot().check!;expect(overdue(check,Date.parse('2026-10-30T21:00:00Z'))).toBe(true)
  expect(overdue({...check,dueAt:null})).toBe(false);expect(overdue({...check,recorded:true})).toBe(false);expect(overdue(check,Date.parse('2026-10-30T19:00:00Z'))).toBe(false)
 })
 it('explicit preparation calls draft then mutation preview once; activation uses the exact returned binding',async()=>{
  const {adapter,controller}=fixture();await controller.load();await controller.prepare({childId:'p_nora',wearColor:'red'});expect(controller.getSnapshot().phase).toBe('preview');expect(adapter.draft).toHaveBeenCalledExactlyOnceWith('p_nora',{wearColor:'red'},undefined);expect(adapter.preview).toHaveBeenCalledExactlyOnceWith('oa_test');expect(adapter.activate).not.toHaveBeenCalled()
  // A committed activation is returned by the subsequent recorded-state read.
  adapter.status.mockResolvedValue({alertId:'oa_test',status:'ACTIVE',audienceCount:3,notifiedCount:3,latestResponses:[],guidance})
  await controller.activate();expect(adapter.activate).toHaveBeenCalledExactlyOnceWith(preview);expect(controller.getSnapshot().phase).toBe('active')
 })
 it('descriptor changes invalidate the preview and cannot activate until explicit re-preview',async()=>{
  const {adapter,controller}=fixture();await controller.load();await controller.prepare({childId:'p_nora',wearColor:'red'});controller.edit('wearColor','');expect(controller.confirmable()).toBe(false);expect(controller.getSnapshot().preview).toBeNull();await controller.activate();expect(adapter.activate).not.toHaveBeenCalled();expect(adapter.preview).toHaveBeenCalledTimes(1)
  await controller.review();expect(adapter.preview).toHaveBeenCalledTimes(2);expect(controller.confirmable()).toBe(true)
 })
 it.each(['ORBIT_DRAFT_STALE','ORBIT_PREVIEW_MISMATCH'])('activation %s requires fresh preview and confirmation, never replay',async code=>{
  const {adapter,controller}=fixture();adapter.activate.mockRejectedValueOnce(Error(code));await controller.load();await controller.prepare({childId:'p_nora'});await controller.activate();expect(controller.getSnapshot().error).toBe('The draft changed. Review it again.');expect(controller.confirmable()).toBe(false);expect(adapter.preview).toHaveBeenCalledTimes(1);await controller.activate();expect(adapter.activate).toHaveBeenCalledTimes(1);await controller.review();expect(adapter.preview).toHaveBeenCalledTimes(2);expect(adapter.activate).toHaveBeenCalledTimes(1)
 })
 it('preview failure is not retried, even if authentication failed',async()=>{
  const {adapter,controller}=fixture();adapter.preview.mockRejectedValueOnce(Error('UNAUTHENTICATED'));await controller.load();await controller.prepare({childId:'p_nora'});expect(adapter.preview).toHaveBeenCalledTimes(1);expect(controller.confirmable()).toBe(false)
 })
 it('edits during preview discard its late binding; no extra mutation is manufactured',async()=>{
  const {adapter,controller}=fixture();let resolve!:(value:Preview)=>void;adapter.preview.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));await controller.load();const pending=controller.prepare({childId:'p_nora'});await vi.waitFor(()=>expect(adapter.preview).toHaveBeenCalledTimes(1));controller.edit('wearColor','red');resolve(preview);await pending;expect(controller.confirmable()).toBe(false);expect(controller.getSnapshot().phase).toBe('editing');expect(adapter.draft).toHaveBeenCalledTimes(1)
 })
 it('a perspective switch discards a late committed activation; returning refetches actual state without activating again',async()=>{
  const {adapter,controller,switchGeneration}=fixture();let resolve!:(value:Alert)=>void;adapter.activate.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));await controller.load();await controller.prepare({childId:'p_nora'});const pending=controller.activate();switchGeneration();controller.dispose();resolve(alert);await pending;expect(controller.getSnapshot().alert).toBeNull();expect(controller.getSnapshot().photoId).toBeUndefined();expect(adapter.activate).toHaveBeenCalledTimes(1)
  const returned=new OrbitController({...adapter,status:vi.fn<OrbitAdapter['status']>(async()=>({alertId:'oa_test',status:'ACTIVE',audienceCount:3,notifiedCount:3,latestResponses:[],guidance}))},{...controller.scope,generation:2},()=>2);await returned.load();expect(returned.getSnapshot().alert?.status).toBe('ACTIVE');expect(adapter.activate).toHaveBeenCalledTimes(1)
 })
 it('an audience WITH_ME remains an active response; close requires a separate parent confirm',async()=>{
  const {adapter}=fixture();adapter.status.mockResolvedValue({alertId:'oa_test',status:'ACTIVE',audienceCount:1,notifiedCount:1,latestResponses:[response],guidance:''});adapter.alert.mockResolvedValue({...alert,responses:[response],latestResponses:[response],guidance:''})
  const audience=new OrbitController(adapter,{childId:'p_nora',personId:'p_gma',parent:false,readOnly:false,generation:1},()=>1);await audience.load();await audience.respond('WITH_ME');expect(adapter.respond).toHaveBeenCalledExactlyOnceWith('oa_test','WITH_ME');expect(audience.getSnapshot().alert?.status).toBe('ACTIVE');audience.requestClose();await audience.close();expect(adapter.close).not.toHaveBeenCalled()
  const parent=new OrbitController(adapter,{...audience.scope,parent:true,personId:'p_mom'},()=>1);await parent.load();await parent.close();expect(adapter.close).not.toHaveBeenCalled();parent.requestClose();await parent.close();expect(adapter.close).toHaveBeenCalledTimes(1);expect(parent.getSnapshot().alert?.responses).toEqual([response])
 })
 it('guide, foreign child and values outside actual vocabulary cannot prepare',async()=>{
  const {adapter,controller}=fixture();await controller.load();await controller.prepare({childId:'p_jax'});await controller.prepare({childId:'p_nora',wearColor:'invented'});const guide=new OrbitController(adapter,{...controller.scope,readOnly:true},()=>1);await guide.load();await guide.prepare({childId:'p_nora'});await guide.respond('ON_WAY');expect(adapter.draft).not.toHaveBeenCalled();expect(adapter.respond).not.toHaveBeenCalled()
 })
 it('upload invalidates first and never automatically previews; disposal aborts in-flight media',async()=>{
  const {adapter,controller}=fixture();await controller.load();await controller.prepare({childId:'p_nora'});await controller.upload(new File(['x'],'fictional.png',{type:'image/png'}));expect(controller.confirmable()).toBe(false);expect(adapter.preview).toHaveBeenCalledTimes(1);expect(controller.getSnapshot().photoId).toBe('ph_test');const signal=adapter.upload.mock.calls[0]?.[2] as AbortSignal;controller.dispose();expect(signal.aborted).toBe(true);expect(controller.getSnapshot().photoId).toBeUndefined()
 })
 it('a poll begun before explicit preparation cannot overwrite the new preview',async()=>{
  const {adapter,controller}=fixture();await controller.load();let finish!:(value:Awaited<ReturnType<OrbitAdapter['status']>>)=>void
  adapter.status.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));const poll=controller.refresh()
  await controller.prepare({childId:'p_nora'});expect(controller.confirmable()).toBe(true)
  finish({alertId:null,status:null,audienceCount:0,notifiedCount:0,latestResponses:[],guidance});await poll
  expect(controller.confirmable()).toBe(true);expect(adapter.preview).toHaveBeenCalledTimes(1)
 })

 it('keeps returned emergency guidance visible when another read fails, without permitting preparation',async()=>{
  const {adapter,controller}=fixture();adapter.vocabulary.mockRejectedValueOnce(Error('READ_UNAVAILABLE'));await controller.load();expect(controller.getSnapshot().guidance).toBe(guidance);expect(controller.getSnapshot().phase).toBe('unavailable');expect(controller.canPrepare()).toBe(false);await controller.prepare({childId:'p_nora'});expect(adapter.draft).not.toHaveBeenCalled()
 })

})
