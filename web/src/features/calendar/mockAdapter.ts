import { arrangements, busySlots, fixtureEvents, people, weeklySchedule } from './fixture'
import type { RawEvent } from './fixture'
import type { CalendarAdapter, CalendarChild, CalendarEvent, LinkedRecord, Shared } from './types'
import { addDays, intersects, midnight, validDay } from './time'
// Mock server boundary only. Live data must be scoped/redacted by Bentley's resolvers, not this map.
const access: Record<string, Record<string, CalendarChild['authority']>> = {
  p_mom: { p_nora: 'parent' }, p_dad: { p_nora: 'parent' }, p_gma: { p_nora: 'schedule.read' },
  p_priya: { p_nora: 'schedule.read', p_malik: 'schedule.read' },
  p_dana: { p_jax: 'parent' }, p_ray: { p_jax: 'parent' }, p_rosa: { p_emma: 'guardian' }, p_dwayne: { p_malik: 'parent' },
}
const children = [people.nora, people.jax, people.emma, people.malik]
const adultsByChild: Record<string, string[]> = { p_nora: ['p_mom', 'p_dad', 'p_priya'], p_jax: ['p_dana', 'p_ray'], p_emma: ['p_rosa', 'p_tomas'], p_malik: ['p_dwayne', 'p_priya', 'p_cassandra'] }
const missing = { state: 'missing' } as const
const visible = <T,>(value: T): Shared<T> => ({ state: 'visible', value })
export function createMockCalendarAdapter(personId: string): CalendarAdapter {
  function scope(childId: string): CalendarChild {
    const authority = access[personId]?.[childId], child = children.find(child => child.id === childId)
    if (!authority || !child) throw new Error('UNAUTHORIZED')
    return { ...child, authority }
  }
  function canReadLinked(link: LinkedRecord): boolean {
    const authority = access[personId]?.[link.childId]
    // §9.5: a schedule grant is not a pickup-job/consent/school grant.
    return authority === 'parent' || authority === 'guardian'
  }
  function project(event: RawEvent): CalendarEvent {
    const childScope = scope(event.child.id)
    const canReadCoordination = childScope.authority === 'parent' || childScope.authority === 'guardian'
    return {
      id: event.id, child: { ...event.child }, title: event.title, category: event.category, status: event.status,
      start: event.start, end: event.end, participants: event.participants.map(p => ({ ...p })),
      location: event.location === null ? missing : visible(event.location),
      confirmedBy: event.confirmedBy ? visible({ ...event.confirmedBy }) : missing,
      confirmedAt: event.confirmedAt ? visible(event.confirmedAt) : missing,
      linkedRecords: !canReadCoordination && (event.needsCoverage || event.consentPending) ? { state: 'hidden' } : !event.links?.length ? missing : event.links.every(canReadLinked) ? visible(structuredClone(event.links)) : { state: 'hidden' },
      attention: [...(event.needsCoverage && canReadCoordination ? ['Needs coverage' as const] : []), ...(event.consentPending && canReadCoordination ? ['Consent pending' as const] : []), ...(event.status === 'PROPOSED' ? ['Unconfirmed' as const] : [])],
    }
  }
  return {
    mode: 'mock',
    async listChildren() { return children.filter(child => access[personId]?.[child.id]).map(child => scope(child.id)) },
    async readCalendar({ childId, from, to }) {
      const child = scope(childId)
      if (!validDay(from) || !validDay(to) || from > to || midnight(addDays(to, 1)) - midnight(from) > 42 * 25 * 3600000) throw new Error('Invalid calendar range')
      const start = midnight(from), end = midnight(addDays(to, 1))
      return {
        state: 'mock', child,
        events: fixtureEvents.filter(e => e.child.id === childId && intersects(e.start, e.end, start, end)).map(project).sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id)),
        weeklySchedule: structuredClone(weeklySchedule.filter(row => row.childId === childId)),
        holidayArrangements: structuredClone(arrangements.filter(row => row.childId === childId && row.dateStart <= to && row.dateEnd >= from)),
        busy: busySlots.filter(slot => adultsByChild[childId]?.includes(slot.person.id) && intersects(slot.start, slot.end, start, end)).map(slot => ({ id: slot.id, person: { ...slot.person }, start: slot.start, end: slot.end })),
      }
    },
    async readEvent(id) {
      // Unknown and unauthorized IDs have the same outcome; no foreign event metadata escapes.
      const event = fixtureEvents.find(event => event.id === id && access[personId]?.[event.child.id])
      if (!event) throw new Error('UNAUTHORIZED')
      return project(event)
    },
  }
}
