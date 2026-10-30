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
import { CatalogCards } from '@/features/rosina/CatalogCards'
import { RosinaPanel } from '@/features/rosina/RosinaPanel'
import { localDay } from '@/features/calendar/time'
import { FamilyCalendar } from '@/features/calendar/FamilyCalendar'
import { createMockCalendarAdapter } from '@/features/calendar/mockAdapter'
import { CareInformation } from '@/features/personas/careInformation'
import { PersonaAccessState } from '@/features/personas/PersonaAccessState'
const LivingVillage = lazy(() => import('@/features/village').then(module => ({ default: module.LivingVillage })))
function SharingBoundary({ surface }: { surface: 'pickup' | 'village' }) {
  const { session } = useSession()
  const actions = [
    ...(session ? [{ id: 'open-calendar', args: { day: localDay(Date.now()), childId: session.scope.childId } }] : []),
    ...(session && (session.persona.parent || session.persona.grants.includes('careplan.read')) ? [{ id: 'open-screen', args: { screen: 'care-information' } }] : []),
    { id: 'open-screen', args: { screen: 'ask-rosina' } },
  ]
  return <PersonaAccessState surface={surface} actions={<CatalogCards actions={actions} />} />
}
function SignedInVillage() {
  const { session, switching } = useSession()
  const adapter = useMemo(() => session ? createPersonaDataAdapter(session) : null, [session])
  const calendar = useMemo(() => session ? createMockCalendarAdapter(session.persona.personId) : null, [session])
  if (switching) return <><PersonaPicker key="switching" /><RosinaPanel key="switching-rosina" /></>
  if (!session || !adapter) return <><PersonaPicker key="picker" /><RosinaPanel key="entry-rosina" /></>
  return <div key={session.generation} data-state="unavailable" data-mode="mock">
    <SessionChip />
    <DataProvider adapter={adapter} scope={session.scope}>
      <ApolloSessionCleanup clearAdapter={adapter.clearStore} />
      <Shell slots={{
        'mission-control': <><p className="persona-mock">Demo village · sample information</p><MissionControl accessDenied={<SharingBoundary surface="pickup" />} /></>,
        'ask-rosina': <section className="route-slot"><h2>Talk with Rosina</h2><p>Ask about what is shared with you. Every change needs your confirmation.</p></section>,
        'care-information': <CareInformation />,
        calendar: calendar ? <FamilyCalendar adapter={calendar} /> : null,
        village: <Suspense fallback={<p className="village-route-loading" role="status">Loading the village…</p>}><section className="village-route" aria-label="Living Village workspace"><LivingVillage accessDenied={<SharingBoundary surface="village" />} /></section></Suspense>,
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
