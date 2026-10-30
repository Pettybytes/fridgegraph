import type { CalendarSnapshot, HolidayArrangement, PersonRef } from './types'
import { addDays, intersects, midnight, weekday } from './time'
export type CareBand = { state: 'weekly' | 'holiday' | 'missing' | 'conflict'; label: string; caregivers: PersonRef[]; arrangement?: HolidayArrangement }
export function careBand(data: CalendarSnapshot, day: string): CareBand {
  // Mock date ranges are inclusive local calendar dates; confirm wire semantics before live integration.
  const overrides = data.holidayArrangements.filter(row => row.status === 'APPROVED' && row.dateStart <= day && row.dateEnd >= day)
  if (overrides.length > 1) return { state: 'conflict', label: 'Schedule needs review', caregivers: [] }
  if (overrides.length === 1) {
    const arrangement = overrides[0]
    return { state: 'holiday', label: `Holiday arrangement: scheduled with ${arrangement.assignedParent.displayName.split(' ')[0]}`, caregivers: [arrangement.assignedParent], arrangement }
  }
  const rows = data.weeklySchedule.filter(row => row.weekdays.includes(weekday(day)))
  if (!rows.length) return { state: 'missing', label: 'Schedule not recorded', caregivers: [] }
  if (new Set(rows.map(row => row.householdId)).size > 1) return { state: 'conflict', label: 'Schedule needs review', caregivers: [] }
  const caregivers = rows.map(row => row.parent)
  return { state: 'weekly', label: `Scheduled with ${caregivers.map(person => person.displayName.split(' ')[0]).join(' & ')}`, caregivers }
}
export function dayItems(data: CalendarSnapshot, day: string) {
  const from = midnight(day), to = midnight(addDays(day, 1))
  return {
    events: data.events.filter(event => intersects(event.start, event.end, from, to)),
    busy: data.busy.filter(slot => intersects(slot.start, slot.end, from, to)),
    arrangements: data.holidayArrangements.filter(row => row.status !== 'APPROVED' && row.dateStart <= day && row.dateEnd >= day),
  }
}
