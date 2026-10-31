import { lazy, Suspense, useMemo } from 'react'
import { Shell } from '@/app/Shell'
import { DataProvider } from '@/lib/frontendData/provider'
import { MissionControlV2 as MissionControl } from '@/features/mission-control/v2/MissionControlV2'
import type { AuthAdapter } from '@/features/personas/auth'
import {createLiveAuthAdapter} from '@/features/personas/liveAuth'
import {createGraphClient} from '@/lib/frontendData/graphqlAdapter'
import {createDeliveredAdapter} from '@/lib/frontendData/deliveredAdapter'
import {LiveMissionControl} from '@/features/mission-control/LiveMissionControl'
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
  const { session, switching, getCurrentSession, getSessionGeneration, runRead, authMode } = useSession()
  const adapter = useMemo(() => session ? session.accessToken && authMode==='live' ? createDeliveredAdapter(createGraphClient(async()=>getCurrentSession()?.accessToken??null,undefined,getSessionGeneration),runRead) : createPersonaDataAdapter(session) : null, [session?.generation,authMode,getCurrentSession,getSessionGeneration,runRead])
  const calendar = useMemo(() => session ? createMockCalendarAdapter(session.persona.personId) : null, [session?.generation])
  if (switching) return <><PersonaPicker key="switching" /><RosinaPanel key="switching-rosina" /></>
  if (!session || !adapter) return <><PersonaPicker key="picker" /><RosinaPanel key="entry-rosina" /></>
  return <div key={session.generation} data-state={adapter.mode==='mock'?'unavailable':'derived'} data-mode={adapter.mode}>
    <SessionChip />
    <DataProvider adapter={adapter} scope={session.scope}>
      <ApolloSessionCleanup clearAdapter={adapter.clearStore} />
      <Shell slots={{
        'mission-control': session.accessToken&&authMode==='live'?<LiveMissionControl accessDenied={<SharingBoundary surface="pickup"/>}/>:<><p className="persona-mock">Sample scenario · fictional replay</p><MissionControl accessDenied={<SharingBoundary surface="pickup" />} /></>,
        'ask-rosina': <section className="route-slot"><h2>Talk with Rosina</h2><p>Ask about what is shared with you. Every change needs your confirmation.</p></section>,
        'care-information': <><p className="persona-mock">Sample data · live care read pending</p><CareInformation /></>,
        calendar: calendar ? <><p className="persona-mock">Sample data · live calendar read pending</p><FamilyCalendar adapter={calendar} /></> : null,
        village: <Suspense fallback={<p className="village-route-loading" role="status">Loading the village…</p>}><section className="village-route" aria-label="Living Village workspace"><p className="persona-mock">Sample data · live Village v2 read pending</p><LivingVillage /></section></Suspense>,
      }} />
      <RosinaPanel dataAdapter={adapter} />
    </DataProvider>
  </div>
}
export default function App({authAdapter}:{authAdapter?:AuthAdapter}={}) {
  const auth = useMemo(() => authAdapter ?? (import.meta.env.DEV && import.meta.env.VITE_DEV_MOCK_AUTH==='true'?createMockAuthAdapter():createLiveAuthAdapter()), [authAdapter])
  return <SessionProvider adapter={auth}><SandboxBanner /><SignedInVillage /></SessionProvider>
}
