import { PrefetchRoutes } from './PrefetchRoutes'
import { Today, Activity, LiveMissionControl, LiveFamilyCalendar, CareInformation, SignatureVillageRoute, FridgeRoute, Orbit, VillageMap, InvitesPanel } from './routeModules'
import { RouteSkeleton } from './RouteSkeleton'
import {MapCalendarBridge} from '@/features/village-map/calendar'
import {VillageMapProvider,MapRosinaContext} from '@/features/village-map/runtime'
import {VillageMapMini} from '@/features/village-map/VillageMapMini'
import {ResetSeededReads} from '@/features/personas/ResetSeededReads'
import { lazy, Suspense, useMemo } from 'react'
import { Shell } from '@/app/Shell'
import { DataProvider } from '@/lib/frontendData/provider'
const MissionControl = lazy(() => import('@/features/mission-control/v2/MissionControlV2').then(m => ({ default: m.MissionControlV2 })))
import {createGraphClient} from '@/lib/frontendData/graphqlAdapter'
import {createDeliveredAdapter} from '@/lib/frontendData/deliveredAdapter'
import { useSession } from '@/features/personas/Session'
import { PersonaPicker, SessionChip } from '@/features/personas/PersonaPicker'
import { VoiceProvider } from '@/features/voice/VoiceProvider'
import { ApolloSessionCleanup } from '@/features/personas/ApolloSessionCleanup'
import { createPersonaDataAdapter } from '@/features/personas/personaData'
import '@/app/village-route.css'
import { CatalogCards } from '@/features/rosina/CatalogCards'
import { RosinaPanel } from '@/features/rosina/RosinaPanel'
import {OrbitCheckInCard} from '@/features/orbit/Orbit'
import {OrbitProvider} from '@/features/orbit/runtime'
import {OrbitController} from '@/features/orbit/controller'
import {createOrbitAdapter} from '@/features/orbit/adapter'
import { localDay } from '@/features/calendar/time'
import {createLiveCalendarAdapter} from '@/features/calendar/liveAdapter'
import {LiveCalendarContext} from '@/features/calendar/runtime'
const FamilyCalendar = lazy(() => import('@/features/calendar/FamilyCalendar').then(m => ({ default: m.FamilyCalendar })))
import { createMockCalendarAdapter } from '@/features/calendar/mockAdapter'
import { PersonaAccessState } from '@/features/personas/PersonaAccessState'
import { PageChildAccess } from '@/features/personas/GuideDirectory'
import { createLiveInvite } from '@/features/invites/liveInvite'
const ThreePhoneStory = lazy(() => import('@/features/story-replay/ThreePhoneStory').then(m => ({ default: m.ThreePhoneStory })))
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
export default function SignedInVillage({orbitNow}:{orbitNow:()=>number}) {
  const { session, switching, getCurrentSession, getSessionGeneration, runRead, authMode } = useSession()
  const connection = useMemo(() => {
    if(!session)return null
    if(session.accessToken&&authMode==='live'){
      const client=createGraphClient(async()=>getCurrentSession()?.accessToken??null,undefined,getSessionGeneration)
      const calendar=createLiveCalendarAdapter(client,{generation:session.generation,persona:session.persona,scope:session.scope,marks:session.marks},runRead,getSessionGeneration)
      const orbit=new OrbitController(createOrbitAdapter(client,runRead,()=>getCurrentSession()?.accessToken),{childId:session.scope.childId,personId:session.persona.personId,parent:session.persona.parent||session.persona.guardian===true,readOnly:session.marks?.demoGuide===true&&!session.marks.showcaseEditor,generation:session.generation},getSessionGeneration,orbitNow)
      const adapter=createDeliveredAdapter(client,runRead),clear=adapter.clearStore
      adapter.clearStore=async()=>{orbit.dispose();calendar.clear();await clear?.()}
      return {adapter,calendar,mockCalendar:null,orbit,client}
    }
    return {adapter:createPersonaDataAdapter(session),calendar:null,mockCalendar:createMockCalendarAdapter(session.persona.personId),orbit:null,client:null}
  },[session?.generation,authMode,getCurrentSession,getSessionGeneration,runRead,orbitNow])
  const adapter=connection?.adapter
  if (switching) return <PersonaPicker key="switching" />
  if (!session || !adapter) return <PersonaPicker key="picker" />
  // The Demo guide is the only perspective that sees the replay tab. marks.demoGuide is the
  // authoritative live signal; the persona id identifies the same read-only guide under mock auth.
  const isDemoGuide = session.marks?.demoGuide === true || session.persona.id === 'demo-guide'
  return <div key={session.generation} data-state={adapter.mode==='mock'?'unavailable':'derived'} data-mode={adapter.mode}>
    <VoiceProvider deps={{ stream: import.meta.env.VITE_VOICE_STREAM_LAB === '1' }} getAccessToken={() => getCurrentSession()?.accessToken ?? null} getSelectedChildId={() => getCurrentSession()?.scope.childId} resetKey={`${session.persona.personId}:${session.scope.childId}:${session.generation}`}>
    {connection?.client&&<ResetSeededReads client={connection.client}/>}
    <OrbitProvider controller={connection?.orbit??null}><LiveCalendarContext.Provider value={connection?.calendar??null}><DataProvider adapter={adapter} scope={session.scope} cache={connection?.client?.cache}>
      <PageChildAccess client={connection?.client ?? null} selectedChildId={session.scope.childId} selectedChildName={session.scope.childName} runRead={runRead} generation={session.generation}>
      <VillageMapProvider><PrefetchRoutes client={connection?.client??null} calendar={connection?.calendar??null}/><ApolloSessionCleanup clearAdapter={adapter.clearStore} />
      <Shell sessionChip={<SessionChip />} showDemoReplay={isDemoGuide} slots={{
        map: <VillageMap/>,
        fridge: <Suspense fallback={<RouteSkeleton />}><FridgeRoute /></Suspense>,
        today: <><Today attention={session.accessToken&&authMode==='live'?<OrbitCheckInCard/>:null} now={orbitNow} /><VillageMapMini/></>,
        'mission-control': <>{session.accessToken&&authMode==='live'?<><OrbitCheckInCard/><LiveMissionControl accessDenied={<SharingBoundary surface="pickup"/>}/><VillageMapMini/></>:<><p className="persona-mock">Sample scenario · fictional replay</p><MissionControl accessDenied={<SharingBoundary surface="pickup" />} /><VillageMapMini/></>}</>,
        ...(isDemoGuide ? { 'demo-replay': <Suspense fallback={<RouteSkeleton />}><ThreePhoneStory /></Suspense> } : {}),
        orbit:<Orbit/>,
        activity:<Activity client={connection?.client??null} adapter={adapter}/>,
        'ask-rosina': <div id="rosina-route-slot" className="rosina-route-page" />,
        'care-information': <>{authMode !== 'live' && <p className="persona-mock">Sample data</p>}<CareInformation /></>,
        calendar: <MapCalendarBridge>{connection?.calendar?<LiveFamilyCalendar adapter={connection.calendar}/>:connection?.mockCalendar?<><p className="persona-mock">Sample data</p><FamilyCalendar adapter={connection.mockCalendar}/></>:null}</MapCalendarBridge>,
        invitations: session.accessToken && authMode === 'live'
          ? <InvitesPanel mode="live" createInvite={createLiveInvite(() => getCurrentSession()?.accessToken ?? null)} />
          : <InvitesPanel />,
        village: authMode === 'live'
          ? <section className="village-route" aria-label="Living Village workspace"><SignatureVillageRoute client={connection?.client ?? null} /></section>
          : <Suspense fallback={<RouteSkeleton />}><section className="village-route" aria-label="Living Village workspace"><p className="persona-mock">Sample data</p><LivingVillage /></section></Suspense>,
      }} />
      <RosinaPanel dataAdapter={adapter} contextCard={<MapRosinaContext/>} />
      </VillageMapProvider>
      </PageChildAccess>
    </DataProvider></LiveCalendarContext.Provider></OrbitProvider>
    </VoiceProvider>
  </div>
}
