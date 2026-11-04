// Map calendar records without changing their recorded instants or authority.
// Colors are shared by the custom pill and built-in event renderers.
import type { CalendarEvent as IlamyEvent, Resource } from '@ilamy/calendar'
import type { CalendarEvent, CalendarSnapshot, EventCategory, HolidayArrangement } from './types'
import type { EffectiveCare, LiveEvent, ReadOutcome } from './liveAdapter'
import type { CareBand } from './model'
import { careBand } from './model'
import { addDays } from './time'
import { EVENT_COLORS, eventTone, eventInk } from './eventColors'

// Design-v2 type colors (the vibrant --type-* palette): pickup/transport = amber,
// school = blue, activity = green, care = teal, celebration = violet-pink. Live
// events carry no category. CalendarEventPill uses a title-based display hint
// without claiming a recorded category.
export type CalType = 'amber' | 'blue' | 'green' | 'teal' | 'violet' | 'neutral'

export const categoryType: Record<EventCategory, CalType> = {
  PARENTING_HANDOFF: 'amber', // a care handoff is the pickup/transport moment
  PRACTICE: 'green', // sports / activity
  GAME: 'green',
  FIELD_TRIP: 'blue',
  SCHOOL_CLOSURE: 'blue',
  RECITAL: 'violet',
  PARTY: 'violet',
  SLEEPOVER: 'teal', // recorded as overnight care
  HOLIDAY: 'teal',
  HOLIDAY_CAMP: 'teal',
}

export function calTypeOf(category?: EventCategory | null): CalType {
  return category ? categoryType[category] : 'neutral'
}

// The subset of @ilamy/calendar's event input we produce. ilamy accepts ISO
// strings for start/end (README Quick Start); we pass the recorded instants
// verbatim and let the `timezone` prop render them in Detroit - never shifting a
// recorded time ourselves.
export type IlamyInputEvent = {
  id: string
  title: string
  start: string
  end: string
  allDay?: boolean
  editable?: boolean
  backgroundColor: string
  color: string
  data: {
    kind: 'mock' | 'live'
    type: CalType
    category: EventCategory | null
    color?: string // a parent-chosen CSS colour; overrides the type hue in the pill
    status: string // normalized lowercase: proposed | confirmed | cancelled
    original: CalendarEvent | LiveEvent
  }
}

function normalizeStatus(status: string): string {
  return status.toLowerCase()
}

// Only a parent may drag; a cancelled event is never draggable even for a
// parent. Each host owns its persistence and confirmation behavior.
function eventEditable(canEdit: boolean, status: string): boolean {
  return canEdit && normalizeStatus(status) !== 'cancelled'
}

export function mockToIlamy(event: CalendarEvent, canEdit: boolean): IlamyInputEvent {
  const fill = EVENT_COLORS[eventTone(event.title, event.category)].color
  return {
    backgroundColor: fill, color: eventInk(fill),
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    editable: eventEditable(canEdit, event.status),
    data: {
      kind: 'mock',
      type: calTypeOf(event.category),
      category: event.category,
      status: normalizeStatus(event.status),
      original: event,
    },
  }
}

export function liveToIlamy(event: LiveEvent, canEdit: boolean): IlamyInputEvent {
  const fill = event.color || EVENT_COLORS[eventTone(event.title)].color
  return {
    backgroundColor: fill, color: eventInk(fill),
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    editable: eventEditable(canEdit, event.status),
    data: {
      kind: 'live',
      type: calTypeOf(null),
      category: null,
      color: event.color ?? undefined, // a parent-chosen colour overrides the display hint
      status: normalizeStatus(event.status),
      original: event,
    },
  }
}

// ── Caregiver resource-lane data ──────────────────────────────────────────
// A lane event is an all-day block on one caregiver's row. The caller opens its
// own care/arrangement detail from data.kind, so the privacy copy stays ours.
export type LaneEvent = Omit<IlamyEvent, 'start' | 'end'> & { start: string; end: string }
export type LaneData = { resources: Resource[]; events: LaneEvent[] }
export type MockLaneClick = { kind: 'care'; band: CareBand; careDay: string } | { kind: 'arrangement'; record: HolidayArrangement }
export type LiveLaneClick = { kind: 'care'; day: string; care: ReadOutcome<EffectiveCare> }

export function mockLaneData(snapshot: CalendarSnapshot, from: string): LaneData {
  const childName = snapshot.child.displayName.split(' ')[0]
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i))
  const caregivers = new Map<string, string>()
  const events: LaneEvent[] = []
  for (const day of days) {
    const band = careBand(snapshot, day)
    if (band.state !== 'weekly' && band.state !== 'holiday') continue
    for (const caregiver of band.caregivers) {
      caregivers.set(caregiver.id, caregiver.displayName)
      events.push({ id: `care-${caregiver.id}-${day}`, title: childName, start: day, end: day, allDay: true, resourceId: caregiver.id, data: { kind: 'care', band, careDay: day, type: band.state === 'holiday' ? 'amber' : 'teal', status: 'confirmed' } })
    }
  }
  const arrangements = new Map<string, HolidayArrangement>()
  for (const day of days) for (const arrangement of snapshot.holidayArrangements) if (arrangement.status !== 'APPROVED' && arrangement.dateStart <= day && arrangement.dateEnd >= day) arrangements.set(arrangement.id, arrangement)
  for (const arrangement of arrangements.values()) {
    caregivers.set(arrangement.assignedParent.id, arrangement.assignedParent.displayName)
    events.push({ id: `arr-${arrangement.id}`, title: `${arrangement.status === 'DECLINED' ? 'Declined' : 'Proposed'}: ${arrangement.holidayName ?? 'arrangement'}`, start: arrangement.dateStart, end: arrangement.dateEnd, allDay: true, resourceId: arrangement.assignedParent.id, data: { kind: 'arrangement', record: arrangement, type: 'violet', status: 'proposed' } })
  }
  return { resources: [...caregivers].map(([id, title]) => ({ id, title })), events }
}

export function liveLaneData(days: string[], care: Record<string, ReadOutcome<EffectiveCare>>, childName: string): LaneData {
  const caregivers = new Map<string, string>()
  const events: LaneEvent[] = []
  for (const day of days) {
    const outcome = care[day]
    if (outcome?.state !== 'ready' || !outcome.value.parent) continue
    const parent = outcome.value.parent
    caregivers.set(parent.id, parent.displayName)
    events.push({ id: `care-${parent.id}-${day}`, title: childName, start: day, end: day, allDay: true, resourceId: parent.id, data: { kind: 'care', day, care: outcome, type: outcome.value.source === 'ARRANGEMENT' ? 'amber' : 'teal', status: 'confirmed' } })
  }
  return { resources: [...caregivers].map(([id, title]) => ({ id, title })), events }
}
