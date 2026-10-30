import { useEffect, useState } from 'react'
import { createMockCalendarAdapter } from './mockAdapter'
const empty = { calendarChildIds: new Set<string>(), calendarEventIds: new Set<string>() }
// Explicit MOCK catalog scope. Live integration must derive this from authenticated server reads.
export function useCalendarActionScope(personId: string | undefined) {
  const [state, setState] = useState<{ personId: string; scope: typeof empty } | null>(null)
  useEffect(() => {
    let active = true
    if (!personId) return
    const adapter = createMockCalendarAdapter(personId)
    void (async () => {
      try {
        const children = await adapter.listChildren()
        const snapshots = await Promise.all(children.map(child => adapter.readCalendar({ childId: child.id, from: '2026-10-26', to: '2026-11-29' })))
        if (active) setState({ personId, scope: { calendarChildIds: new Set(children.map(child => child.id)), calendarEventIds: new Set(snapshots.flatMap(data => data.events.map(event => event.id))) } })
      } catch { if (active) setState({ personId, scope: empty }) }
    })()
    return () => { active = false }
  }, [personId])
  return state && state.personId === personId ? state.scope : empty
}
