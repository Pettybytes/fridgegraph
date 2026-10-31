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
import {LiveFamilyCalendar} from '@/features/calendar/LiveFamilyCalendar'
import {createLiveCalendarAdapter} from '@/features/calendar/liveAdapter'
import {LiveCalendarContext} from '@/features/calendar/runtime'
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
  const connection = useMemo(() => {
    if(!session)return null
    if(session.accessToken&&authMode==='live'){
      const client=createGraphClient(async()=>getCurrentSession()?.accessToken??null,undefined,getSessionGeneration)
      const calendar=createLiveCalendarAdapter(client,{generation:session.generation,persona:session.persona,scope:session.scope,marks:session.marks},runRead,getSessionGeneration)
      const adapter=createDeliveredAdapter(client,runRead),clear=adapter.clearStore
      adapter.clearStore=async()=>{calendar.clear();await clear?.()}
      return {adapter,calendar,mockCalendar:null}
    }
    return {adapter:createPersonaDataAdapter(session),calendar:null,mockCalendar:createMockCalendarAdapter(session.persona.personId)}
  },[session?.generation,authMode,getCurrentSession,getSessionGeneration,runRead])
  const adapter=connection?.adapter
  if (switching) return <><PersonaPicker key="switching" /><RosinaPanel key="switching-rosina" /></>
  if (!session || !adapter) return <><PersonaPicker key="picker" /><RosinaPanel key="entry-rosina" /></>
  return <div key={session.generation} data-state={adapter.mode==='mock'?'unavailable':'derived'} data-mode={adapter.mode}>
    <SessionChip />
    <LiveCalendarContext.Provider value={connection?.calendar??null}><DataProvider adapter={adapter} scope={session.scope}>
      <ApolloSessionCleanup clearAdapter={adapter.clearStore} />
      <Shell slots={{
        'mission-control': session.accessToken&&authMode==='live'?<LiveMissionControl accessDenied={<SharingBoundary surface="pickup"/>}/>:<><p className="persona-mock">Sample scenario · fictional replay</p><MissionControl accessDenied={<SharingBoundary surface="pickup" />} /></>,
        'ask-rosina': <section className="route-slot"><h2>Talk with Rosina</h2><p>Ask about what is shared with you. Every change needs your confirmation.</p></section>,
        'care-information': <><p className="persona-mock">Sample data</p><CareInformation /></>,
        calendar: connection?.calendar?<LiveFamilyCalendar adapter={connection.calendar}/>:connection?.mockCalendar?<><p className="persona-mock">Sample data</p><FamilyCalendar adapter={connection.mockCalendar}/></>:null,
        village: <Suspense fallback={<p className="village-route-loading" role="status">Loading the village…</p>}><section className="village-route" aria-label="Living Village workspace"><p className="persona-mock">Sample data</p><LivingVillage /></section></Suspense>,
      }} />
      <RosinaPanel dataAdapter={adapter} />
    </DataProvider></LiveCalendarContext.Provider>
  </div>
}
export default function App({authAdapter}:{authAdapter?:AuthAdapter}={}) {
  const auth = useMemo(() => authAdapter ?? (import.meta.env.DEV && import.meta.env.VITE_DEV_MOCK_AUTH==='true'?createMockAuthAdapter():createLiveAuthAdapter()), [authAdapter])
  return <SessionProvider adapter={auth}><SandboxBanner /><SignedInVillage /></SessionProvider>
}
