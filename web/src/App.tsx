import { lazy, Suspense, useMemo } from 'react'
import { Shell } from '@/app/Shell'
import { DataProvider } from '@/lib/frontendData/provider'
import { MissionControl } from '@/features/mission-control'
import { createMockAuthAdapter } from '@/features/personas/auth'
import { SessionProvider, useSession } from '@/features/personas/Session'
import { PersonaPicker, SandboxBanner, SessionChip } from '@/features/personas/PersonaPicker'
import { ApolloSessionCleanup } from '@/features/personas/ApolloSessionCleanup'
import { createPersonaDataAdapter } from '@/features/personas/personaData'
import '@/app/village-route.css'
const LivingVillage = lazy(() => import('@/features/village').then(module => ({ default: module.LivingVillage })))
function SignedInVillage() {
  const { session, switching } = useSession()
  const adapter = useMemo(() => session ? createPersonaDataAdapter(session) : null, [session])
  if (switching) return <PersonaPicker key="switching" />
  if (!session || !adapter) return <PersonaPicker key="picker" />
  return <div key={session.generation} data-state="unavailable" data-mode="mock">
    <SessionChip />
    <DataProvider adapter={adapter} scope={session.scope}>
      <ApolloSessionCleanup clearAdapter={adapter.clearStore} />
      <Shell slots={{
        'mission-control': <><p className="persona-mock">Mock village · services are not connected</p>{session.persona.grants.includes('careplan.read') && <section aria-label="Care information"><h2>Care information for Nora</h2><p>Peanut allergy. Epi-pen in right backpack pocket.</p><p>Source: Nora's care plan · demo fixture</p></section>}<MissionControl /></>,
        village: <Suspense fallback={<p className="village-route-loading" role="status">Loading the village…</p>}><section className="village-route" aria-label="Living Village workspace"><LivingVillage /></section></Suspense>,
      }} />
    </DataProvider>
  </div>
}
export default function App() {
  const auth = useMemo(() => createMockAuthAdapter(), [])
  if (import.meta.env.VITE_DATA_MODE && import.meta.env.VITE_DATA_MODE !== 'mock') return <><SandboxBanner /><main className="persona-entry"><h1>Demo sign-in unavailable</h1><p>The server demo-login service is required for connected mode. Mock identities cannot sign into the live graph.</p></main></>
  return <SessionProvider adapter={auth}><SandboxBanner /><SignedInVillage /></SessionProvider>
}
