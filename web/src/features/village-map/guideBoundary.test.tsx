import {render,screen,cleanup} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {VillageMapProvider,useVillageMap,useMapState} from './runtime'
const {readWorld,client,session,runRead,getCurrentSession}=vi.hoisted(()=>{
 const session={generation:1,accessToken:'test-session',marks:{demoGuide:true},persona:{id:'demo-guide',name:'Demo guide'},scope:{childId:'p_nora'}}
 return {readWorld:vi.fn(),client:{},session,runRead:<T,>(read:()=>Promise<T>)=>read(),getCurrentSession:()=>session}
})
vi.mock('@/features/personas/Session',()=>({useSession:()=>({session,getCurrentSession,registerPrivateCleanup:()=>()=>{},runRead})}))
vi.mock('@/features/personas/childContext',()=>({useChildAccess:()=>({client,selectedChildId:'p_jax'})}))
vi.mock('./worldReader',()=>({createVillageWorldReader:()=>readWorld}))
function Probe(){const controller=useVillageMap()!;const state=useMapState(controller);return <p>{state.world?`${state.world.childId}: read-only ${!state.world.canApprove}`:'Loading'}</p>}
beforeEach(()=>{
 vi.stubEnv('VITE_VILLAGE_MAP_LIVE','true')
 readWorld.mockResolvedValue({childId:'p_jax',state:'live',people:[],places:[],events:[],days:[],canApprove:false,canReadCost:false})
})
afterEach(()=>{cleanup();vi.unstubAllEnvs()})
it('reads the focused family through the live reader and grants no approval action',async()=>{
 render(<VillageMapProvider><Probe/></VillageMapProvider>)
 expect(await screen.findByText('p_jax: read-only true')).toBeVisible()
 expect(readWorld).toHaveBeenCalled()
})

it('uses authorized live records for a guide when the optional map flag is off',async()=>{
 vi.stubEnv('VITE_VILLAGE_MAP_LIVE','false')
 render(<VillageMapProvider><Probe/></VillageMapProvider>)
 expect(await screen.findByText('p_jax: read-only true')).toBeVisible()
 expect(readWorld).toHaveBeenCalled()
})
