import {MapCalendarBridge} from '@/features/village-map/calendar'
import {VillageMapProvider,MapRosinaContext} from '@/features/village-map/runtime'
import {VillageMapMini} from '@/features/village-map/VillageMapMini'
import {VillageMap} from '@/features/village-map/VillageMap'
import {ResetSeededReads} from '@/features/personas/ResetSeededReads'
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
import {Orbit,OrbitCheckInCard} from '@/features/orbit/Orbit'
import {OrbitProvider} from '@/features/orbit/runtime'
import {OrbitController} from '@/features/orbit/controller'
import {createOrbitAdapter} from '@/features/orbit/adapter'
import { localDay } from '@/features/calendar/time'
import {LiveFamilyCalendar} from '@/features/calendar/LiveFamilyCalendar'
import {createLiveCalendarAdapter} from '@/features/calendar/liveAdapter'
import {LiveCalendarContext} from '@/features/calendar/runtime'
import { FamilyCalendar } from '@/features/calendar/FamilyCalendar'
import { createMockCalendarAdapter } from '@/features/calendar/mockAdapter'
import { CareInformation } from '@/features/personas/careInformation'
import { PersonaAccessState } from '@/features/personas/PersonaAccessState'
import { Today } from '@/features/today/Today'
import { ChildAccessProvider } from '@/features/personas/childContext'
import { SignatureVillageRoute } from '@/components/signature'
import { Activity } from '@/features/activity/Activity'
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
function SignedInVillage({orbitNow}:{orbitNow:()=>number}) {
  const { session, switching, getCurrentSession, getSessionGeneration, runRead, authMode } = useSession()
  const connection = useMemo(() => {
    if(!session)return null
    if(session.accessToken&&authMode==='live'){
      const client=createGraphClient(async()=>getCurrentSession()?.accessToken??null,undefined,getSessionGeneration)
      const calendar=createLiveCalendarAdapter(client,{generation:session.generation,persona:session.persona,scope:session.scope,marks:session.marks},runRead,getSessionGeneration)
      const orbit=new OrbitController(createOrbitAdapter(client,runRead,()=>getCurrentSession()?.accessToken),{childId:session.scope.childId,personId:session.persona.personId,parent:session.persona.parent||session.persona.guardian===true,readOnly:session.marks?.demoGuide===true,generation:session.generation},getSessionGeneration,orbitNow)
      const adapter=createDeliveredAdapter(client,runRead),clear=adapter.clearStore
      adapter.clearStore=async()=>{orbit.dispose();calendar.clear();await clear?.()}
      return {adapter,calendar,mockCalendar:null,orbit,client}
    }
    return {adapter:createPersonaDataAdapter(session),calendar:null,mockCalendar:createMockCalendarAdapter(session.persona.personId),orbit:null,client:null}
  },[session?.generation,authMode,getCurrentSession,getSessionGeneration,runRead,orbitNow])
  const adapter=connection?.adapter
  if (switching) return <PersonaPicker key="switching" />
  if (!session || !adapter) return <PersonaPicker key="picker" />
  return <div key={session.generation} data-state={adapter.mode==='mock'?'unavailable':'derived'} data-mode={adapter.mode}>
    <SessionChip />
    {connection?.client&&<ResetSeededReads client={connection.client}/>}
    <OrbitProvider controller={connection?.orbit??null}><LiveCalendarContext.Provider value={connection?.calendar??null}><DataProvider adapter={adapter} scope={session.scope}>
      <ChildAccessProvider client={connection?.client ?? null} selectedChildId={session.scope.childId} selectedChildName={session.scope.childName} runRead={runRead} generation={session.generation}>
      <ApolloSessionCleanup clearAdapter={adapter.clearStore} />
      <Shell slots={{
        map: <VillageMap/>,
        today: <><Today attention={session.accessToken&&authMode==='live'?<OrbitCheckInCard/>:null} now={orbitNow} /><VillageMapMini/></>,
        'mission-control': session.accessToken&&authMode==='live'?<><OrbitCheckInCard/><LiveMissionControl accessDenied={<SharingBoundary surface="pickup"/>}/><VillageMapMini/></>:<><p className="persona-mock">Sample scenario · fictional replay</p><MissionControl accessDenied={<SharingBoundary surface="pickup" />} /><VillageMapMini/></>,
        orbit:<Orbit/>,
        activity:<Activity client={connection?.client??null} adapter={adapter}/>,
        'ask-rosina': <div id="rosina-route-slot" className="rosina-route-page" />,
        'care-information': <>{authMode !== 'live' && <p className="persona-mock">Sample data</p>}<CareInformation /></>,
        calendar: <MapCalendarBridge>{connection?.calendar?<LiveFamilyCalendar adapter={connection.calendar}/>:connection?.mockCalendar?<><p className="persona-mock">Sample data</p><FamilyCalendar adapter={connection.mockCalendar}/></>:null}</MapCalendarBridge>,
        village: authMode === 'live'
          ? <section className="village-route" aria-label="Living Village workspace"><SignatureVillageRoute client={connection?.client ?? null} /></section>
          : <Suspense fallback={<p className="village-route-loading" role="status">Loading the village…</p>}><section className="village-route" aria-label="Living Village workspace"><p className="persona-mock">Sample data</p><LivingVillage /></section></Suspense>,
      }} />
      <RosinaPanel dataAdapter={adapter} contextCard={<MapRosinaContext/>} />
      </ChildAccessProvider>
    </DataProvider></LiveCalendarContext.Provider></OrbitProvider>
  </div>
}
export default function App({authAdapter,orbitNow=Date.now}:{authAdapter?:AuthAdapter;orbitNow?:()=>number}={}) {
  const auth = useMemo(() => authAdapter ?? (import.meta.env.DEV && import.meta.env.VITE_DEV_MOCK_AUTH==='true'?createMockAuthAdapter():createLiveAuthAdapter()), [authAdapter])
  return <SessionProvider adapter={auth}><SandboxBanner /><VillageMapProvider><SignedInVillage orbitNow={orbitNow} /></VillageMapProvider></SessionProvider>
}
