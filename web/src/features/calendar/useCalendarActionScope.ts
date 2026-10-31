import { useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { createMockCalendarAdapter } from './mockAdapter'
import {LiveCalendarContext} from './runtime'
const empty = { calendarChildIds: new Set<string>(), calendarEventIds: new Set<string>() }
// Live scope comes from authenticated session grants and actual calendar reads; mock scope is dev/test only.
export function useCalendarActionScope(personId: string | undefined) {
  const live=useContext(LiveCalendarContext)
  const liveScope=useSyncExternalStore(live?.subscribe??(()=>()=>{}),live?.getActionScope??(()=>empty))
  const [state, setState] = useState<{ personId: string; scope: typeof empty } | null>(null)
  useEffect(() => {
    let active = true
    if (!personId||live) return
    const adapter = createMockCalendarAdapter(personId)
    void (async () => {
      try {
        const children = await adapter.listChildren()
        const snapshots = await Promise.all(children.map(child => adapter.readCalendar({ childId: child.id, from: '2026-10-26', to: '2026-11-29' })))
        if (active) setState({ personId, scope: { calendarChildIds: new Set(children.map(child => child.id)), calendarEventIds: new Set(snapshots.flatMap(data => data.events.map(event => event.id))) } })
      } catch { if (active) setState({ personId, scope: empty }) }
    })()
    return () => { active = false }
  }, [personId,live])
  if(live)return liveScope
  return state && state.personId === personId ? state.scope : empty
}
