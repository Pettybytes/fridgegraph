import { useCalendarActionScope } from '@/features/calendar/useCalendarActionScope'
import { useSession } from '@/features/personas/Session'
import { actionAllowed, actionLabel, actionRoute, validateActions } from './catalog'
// Read-only cards for sharing boundaries use the same schemas/implemented flags as chat cards.
export function CatalogCards({ actions }: { actions: unknown[] }) {
  const { session } = useSession()
  const calendarScope = useCalendarActionScope(session?.persona.personId)
  const context = { ...calendarScope, readOnly: (session?.marks?.demoGuide===true&&!session.marks.showcaseEditor), childId: session?.scope.childId ?? null, parent: session?.persona.parent ?? false, visiblePeople: new Set<string>(), canReadCare: !!session && (session.persona.parent || session.persona.grants.includes('careplan.read')) }
  return <div className="persona-access-actions">{validateActions(actions).filter(action => actionAllowed(action, context)).map((action, index) => {
    const route = actionRoute(action)
    return route ? <a key={index} className="persona-access-card" href={route}>{actionLabel(action)}</a> : null
  })}</div>
}
