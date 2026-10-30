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
import { RosinaPanel } from '@/features/rosina/RosinaPanel'
import { CareInformation } from '@/features/personas/careInformation'
import { PersonaAccessState } from '@/features/personas/PersonaAccessState'
const LivingVillage = lazy(() => import('@/features/village').then(module => ({ default: module.LivingVillage })))
function SignedInVillage() {
  const { session, switching } = useSession()
  const adapter = useMemo(() => session ? createPersonaDataAdapter(session) : null, [session])
  if (switching) return <><PersonaPicker key="switching" /><RosinaPanel key="switching-rosina" /></>
  if (!session || !adapter) return <><PersonaPicker key="picker" /><RosinaPanel key="entry-rosina" /></>
  return <div key={session.generation} data-state="unavailable" data-mode="mock">
    <SessionChip />
    <DataProvider adapter={adapter} scope={session.scope}>
      <ApolloSessionCleanup clearAdapter={adapter.clearStore} />
      <Shell slots={{
        'mission-control': <><p className="persona-mock">Demo village · sample information</p><MissionControl accessDenied={<PersonaAccessState surface="pickup" />} /></>,
        'ask-rosina': <section className="route-slot"><h2>Talk with Rosina</h2><p>Ask about what is shared with you. Every change needs your confirmation.</p></section>,
        'care-information': <CareInformation />,
        village: <Suspense fallback={<p className="village-route-loading" role="status">Loading the village…</p>}><section className="village-route" aria-label="Living Village workspace"><LivingVillage accessDenied={<PersonaAccessState surface="village" />} /></section></Suspense>,
      }} />
      <RosinaPanel dataAdapter={adapter} />
    </DataProvider>
  </div>
}
export default function App() {
  const auth = useMemo(() => createMockAuthAdapter(), [])
  if (import.meta.env.VITE_DATA_MODE && import.meta.env.VITE_DATA_MODE !== 'mock') return <><SandboxBanner /><main className="persona-entry"><h1>Demo sign-in unavailable</h1><p>Demo sign-in isn’t connected yet. You’ll be able to choose a person when it’s ready.</p></main></>
  return <SessionProvider adapter={auth}><SandboxBanner /><SignedInVillage /></SessionProvider>
}
