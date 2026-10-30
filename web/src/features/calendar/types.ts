// Frontend projections of coordination-v2 Areas A/B and §6. Not GraphQL SDL or a live API claim.
export type PersonRef = { id: string; displayName: string }
export type EventCategory = 'PRACTICE' | 'GAME' | 'RECITAL' | 'PARTY' | 'FIELD_TRIP' | 'SLEEPOVER' | 'SCHOOL_CLOSURE' | 'HOLIDAY' | 'PARENTING_HANDOFF' | 'HOLIDAY_CAMP'
export type EventStatus = 'PROPOSED' | 'CONFIRMED' | 'CANCELLED'
export type Shared<T> = { state: 'visible'; value: T } | { state: 'missing' } | { state: 'hidden' }
export type LinkedRecord = { id: string; childId: string; kind: 'pickup' | 'consent' | 'school'; title: string; text: string }
export type CalendarEvent = {
  id: string; child: PersonRef; title: string; category: EventCategory; status: EventStatus
  start: string; end: string; participants: PersonRef[]; location: Shared<string>
  confirmedBy: Shared<PersonRef>; confirmedAt: Shared<string>; linkedRecords: Shared<LinkedRecord[]>
  // Client composition from recorded coordination/consent facts; not proposed Event SDL fields.
  attention: ('Needs coverage' | 'Consent pending' | 'Unconfirmed')[]
}
export type WeeklySchedule = { childId: string; parent: PersonRef; weekdays: number[]; householdId: string }
export type HolidayArrangement = { id: string; childId: string; holidayName: string | null; dateStart: string; dateEnd: string; assignedParent: PersonRef; status: 'PROPOSED' | 'APPROVED' | 'DECLINED'; proposedBy: PersonRef | null; approvalId: string | null }
export type BusyWindow = { id: string; person: PersonRef; start: string; end: string }
export type CalendarChild = PersonRef & { authority: 'parent' | 'guardian' | 'schedule.read' }
export type CalendarSnapshot = { state: 'mock' | 'live'; child: CalendarChild; events: CalendarEvent[]; weeklySchedule: WeeklySchedule[]; holidayArrangements: HolidayArrangement[]; busy: BusyWindow[] }
export interface CalendarAdapter {
  readonly mode: 'mock' | 'live'
  listChildren(): Promise<CalendarChild[]>
  readCalendar(input: { childId: string; from: string; to: string }): Promise<CalendarSnapshot>
  readEvent(id: string): Promise<CalendarEvent>
}
export const categoryLabel: Record<EventCategory, string> = { PRACTICE: 'Practice', GAME: 'Game', RECITAL: 'Recital', PARTY: 'Party', FIELD_TRIP: 'Field trip', SLEEPOVER: 'Overnight care', SCHOOL_CLOSURE: 'School closure', HOLIDAY: 'Holiday', PARENTING_HANDOFF: 'Care handoff', HOLIDAY_CAMP: 'Holiday camp' }
export const statusLabel: Record<EventStatus, string> = { PROPOSED: 'Proposed', CONFIRMED: 'Confirmed', CANCELLED: 'Cancelled' }
