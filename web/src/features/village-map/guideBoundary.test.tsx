import {render,screen,cleanup} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {VillageMapProvider,MapRosinaContext} from './runtime'
import {VillageMap} from './VillageMap'

vi.mock('@/features/personas/Session',()=>({useSession:()=>({
 session:{generation:1,accessToken:'test-session',marks:{demoGuide:true},persona:{id:'demo-guide'},scope:{childId:'p_nora'}},
 getCurrentSession:()=>null,registerPrivateCleanup:()=>()=>{},runRead:<T,>(read:()=>Promise<T>)=>read(),
})}))
vi.mock('@/features/personas/childContext',()=>({useChildAccess:()=>null}))

beforeEach(()=>vi.stubEnv('VITE_VILLAGE_MAP_LIVE','true'))
afterEach(()=>{cleanup();vi.unstubAllEnvs()})

it('refuses the guide a child-specific geographic map before a world can render',async()=>{
 location.hash='#/map'
 render(<VillageMapProvider><VillageMap/><MapRosinaContext/></VillageMapProvider>)
 expect(await screen.findByText("This isn't shared with you.")).toBeVisible()
 expect(screen.queryByText(/Nora Ellison|Recorded pickup ride estimates|Route estimate|Sample map context/)).not.toBeInTheDocument()
})
