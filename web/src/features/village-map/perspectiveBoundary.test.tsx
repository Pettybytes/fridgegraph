import {render,screen,cleanup} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {VillageMapProvider,useVillageMap,useMapState} from './runtime'
const fixture=vi.hoisted(()=>({
 session:{generation:1,accessToken:'test-session',marks:{demoGuide:false},persona:{id:'dana',name:'Dana',parent:true,guardian:false},scope:{childId:'p_jax'}},
 childId:'p_jax',client:{} as object|null,readWorld:vi.fn(),
}))
vi.mock('@/features/personas/Session',()=>({useSession:()=>({session:fixture.session,getCurrentSession:()=>fixture.session,registerPrivateCleanup:()=>()=>{},runRead:<T,>(read:()=>Promise<T>)=>read()})}))
vi.mock('@/features/personas/childContext',()=>({useChildAccess:()=>({client:fixture.client,selectedChildId:fixture.childId})}))
vi.mock('./worldReader',()=>({createVillageWorldReader:()=>fixture.readWorld}))
function Probe(){const controller=useVillageMap()!;const state=useMapState(controller);return <p>{state.error|| (state.world?`${controller.adapter.mode}:${state.world.childId}`:'Loading')}</p>}
beforeEach(()=>{
 vi.stubEnv('VITE_VILLAGE_MAP_LIVE','false');fixture.client={};fixture.readWorld.mockReset()
 fixture.session.accessToken='test-session'
 fixture.readWorld.mockImplementation(async(session)=>({childId:session.childId,state:'live',people:[],places:[],events:[],days:[],canApprove:false,canReadCost:false}))
})
afterEach(()=>{cleanup();vi.unstubAllEnvs()})
it.each([
 ['dana','p_jax',false],['dwayne','p_malik',false],['kendra','p_nora',false],['andre','p_nora',false],
 ['rosa','p_emma',true],['felicia','p_skye',false],['simone','p_avery',false],['demo-guide','p_jax',false],
 ['priya','p_nora',false],['loretta','p_nora',false],
])('uses server-scoped live records for %s with the optional flag off',async(id,childId,guardian)=>{
 fixture.session.persona={id,name:id,parent:!guardian&&!['priya','loretta','demo-guide'].includes(id),guardian}
 fixture.session.marks.demoGuide=id==='demo-guide';fixture.session.scope.childId=childId;fixture.childId=childId
 render(<VillageMapProvider><Probe/></VillageMapProvider>)
 expect(await screen.findByText(`live:${childId}`)).toBeVisible()
 expect(fixture.readWorld).toHaveBeenCalledWith(expect.objectContaining({childId,accessToken:'test-session'}),expect.any(AbortSignal))
})
it('uses the selected authorized child rather than the login default',async()=>{
 fixture.session.scope.childId='p_nora';fixture.childId='p_max'
 render(<VillageMapProvider><Probe/></VillageMapProvider>)
 expect(await screen.findByText('live:p_max')).toBeVisible()
})
it('preserves a server denial without substituting another family',async()=>{
 fixture.childId='p_jax';fixture.readWorld.mockRejectedValue(Error('UNAUTHORIZED'))
 render(<VillageMapProvider><Probe/></VillageMapProvider>)
 expect(await screen.findByText("This isn't shared with you.")).toBeVisible()
 expect(fixture.readWorld).toHaveBeenCalled()
 expect(screen.queryByText(/live:/)).not.toBeInTheDocument()
})
it('fails closed if a live session has no client',async()=>{
 fixture.client=null
 render(<VillageMapProvider><Probe/></VillageMapProvider>)
 expect(await screen.findByText("Couldn't load this just now.")).toBeVisible()
 expect(fixture.readWorld).not.toHaveBeenCalled()
})
