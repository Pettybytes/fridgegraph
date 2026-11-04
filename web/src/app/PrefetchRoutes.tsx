import { useEffect } from 'react'
import { useApolloClient } from '@apollo/client/react'
import type { ApolloClient } from '@apollo/client'
import { useSession } from '@/features/personas/Session'
import { useDataContext, SNAPSHOT } from '@/lib/frontendData/provider'
import { refreshResource } from '@/lib/frontendData/resourceCache'
import type { LiveCalendarAdapter } from '@/features/calendar/liveAdapter'
import { addDays, localDay, weekStart } from '@/features/calendar/time'
import { preloadRoute } from './routeModules'

export function PrefetchRoutes({ client, calendar }: { client: ApolloClient | null; calendar: LiveCalendarAdapter | null }) {
  const surfaceClient = useApolloClient(), { adapter, scope } = useDataContext()
  const { session, runRead, getSessionGeneration } = useSession()
  useEffect(() => {
    if (!client || !session) return
    let cancelled = false
    const generation = session.generation, childId = scope.childId
    const current = () => !cancelled && generation === getSessionGeneration()
    const parent = session.marks?.demoGuide || session.persona.parent || session.persona.guardian
    const jobs: (() => Promise<unknown>)[] = [
      async () => { preloadRoute('today'); return surfaceClient.query({ query: SNAPSHOT, variables: { scope, surface: 'village' }, fetchPolicy: 'cache-first' }) },
      async () => { preloadRoute('mission-control'); return surfaceClient.query({ query: SNAPSHOT, variables: { scope, surface: 'mission-control' }, fetchPolicy: 'cache-first' }) },
      async () => { preloadRoute('activity'); if (parent) { const { loadActivity } = await import('@/features/activity/Activity'); if(current()) await refreshResource(client, `activity:${childId}`, () => loadActivity(client, adapter, scope, runRead)) } },
      async () => { preloadRoute('calendar'); const from = weekStart(localDay(Date.now())); if(calendar) await calendar.readWindow({ childId, from, to: addDays(from, 6), includeCancelled: false }) },
      async () => { preloadRoute('care-information'); const { readCareInformation } = await import('@/features/personas/careInformation'); if(current()) await refreshResource(client, `care:${childId}`, () => readCareInformation(client,childId,runRead)) },
      async () => { preloadRoute('village'); const { readSignatureVillage } = await import('@/components/signature/villageRead'); if(current()) await refreshResource(client, `village:${childId}`, () => readSignatureVillage(client, childId, runRead, new AbortController().signal)) },
      async () => { preloadRoute('fridge'); const { createPhase2Service } = await import('@/features/fridge/phase2Adapter'); if(current()) { const service=createPhase2Service(client,runRead,()=>false),signal=new AbortController().signal; await service.check(childId,signal); if(current()) await Promise.all([service.adapter.readGoals(childId,signal),service.adapter.readNotes(childId,signal)]) } },
    ]
    let next = 0
    async function worker() {
      while (current() && next < jobs.length) {
        const job = jobs[next++]
        try { await job() } catch { /* The destination performs its own authorized read and shows errors. */ }
      }
    }
    // Let the selected page start its foreground reads first. At most two route loaders run.
    const timer = window.setTimeout(() => { void worker(); void worker() }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [client, calendar, session?.generation, adapter, scope, surfaceClient, runRead, getSessionGeneration])
  return null
}
