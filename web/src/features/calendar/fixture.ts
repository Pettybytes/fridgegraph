import type { EventCategory, EventStatus, HolidayArrangement, LinkedRecord, PersonRef, WeeklySchedule } from './types'
// SYNTHETIC_SCENARIO only: a small v2-shaped frontend fixture, not deployed seed rows or live facts.
export const people = {
  nora: { id: 'p_nora', displayName: 'Nora Ellison' }, jax: { id: 'p_jax', displayName: 'Jax Coleman' }, emma: { id: 'p_emma', displayName: 'Emma' }, malik: { id: 'p_malik', displayName: 'Malik' },
  kendra: { id: 'p_mom', displayName: 'Kendra Ellison' }, andre: { id: 'p_dad', displayName: 'Andre Ellison' }, dana: { id: 'p_dana', displayName: 'Dana Coleman' }, ray: { id: 'p_ray', displayName: 'Ray Coleman' },
  rosa: { id: 'p_rosa', displayName: 'Rosa Castellano' }, tomas: { id: 'p_tomas', displayName: 'Tomás Castellano' }, dwayne: { id: 'p_dwayne', displayName: 'Dwayne Ferris' }, priya: { id: 'p_priya', displayName: 'Priya Nair' }, cassandra: { id: 'p_cassandra', displayName: 'Cassandra Ferris' },
} satisfies Record<string, PersonRef>
export type RawEvent = { id: string; child: PersonRef; title: string; category: EventCategory; status: EventStatus; start: string; end: string; participants: PersonRef[]; location: string | null; confirmedBy?: PersonRef; confirmedAt?: string; links?: LinkedRecord[]; needsCoverage?: boolean; consentPending?: boolean }
function event(id: string, child: PersonRef, title: string, category: EventCategory, start: string, end: string, status: EventStatus = 'CONFIRMED', extra: Partial<RawEvent> = {}): RawEvent {
  return { id, child, title, category, start, end, status, participants: [child], location: 'School activity hall', ...extra }
}
export const fixtureEvents: RawEvent[] = [
  event('cal-nora-practice', people.nora, 'Tigers soccer practice', 'PRACTICE', '2026-10-27T16:30:00-04:00', '2026-10-27T17:30:00-04:00', 'CONFIRMED', { confirmedBy: people.kendra, confirmedAt: '2026-10-20T10:00:00-04:00', location: 'Field 3' }),
  event('cal-nora-cancelled', people.nora, 'Cancelled soccer practice', 'PRACTICE', '2026-10-28T16:30:00-04:00', '2026-10-28T17:30:00-04:00', 'CANCELLED'),
  event('cal-nora-party', people.nora, 'Birthday invitation', 'PARTY', '2026-10-30T17:00:00-04:00', '2026-10-30T19:00:00-04:00', 'PROPOSED', { location: null }),
  event('cal-nora-overnight', people.nora, 'Family sleepover', 'SLEEPOVER', '2026-10-31T20:00:00-04:00', '2026-11-01T08:00:00-05:00', 'CONFIRMED', { location: 'Family home' }),
  event('cal-jax-game', people.jax, 'Tigers weekend game', 'GAME', '2026-10-31T10:00:00-04:00', '2026-10-31T11:00:00-04:00', 'CONFIRMED', { confirmedBy: people.dana }),
  event('cal-emma-recital', people.emma, 'Autumn music recital', 'RECITAL', '2026-10-28T17:00:00-04:00', '2026-10-28T18:00:00-04:00', 'CONFIRMED', { confirmedBy: people.rosa, participants: [people.emma, people.rosa, people.tomas] }),
  event('cal-emma-camp', people.emma, 'Holiday camp invitation', 'HOLIDAY_CAMP', '2026-10-30T09:00:00-04:00', '2026-10-30T15:00:00-04:00', 'PROPOSED'),
  event('cal-emma-cancelled', people.emma, 'Cancelled music rehearsal', 'PRACTICE', '2026-10-29T16:00:00-04:00', '2026-10-29T17:00:00-04:00', 'CANCELLED'),
  event('cal-malik-gym', people.malik, 'Gymnastics practice', 'PRACTICE', '2026-10-29T18:00:00-04:00', '2026-10-29T19:00:00-04:00', 'CONFIRMED', { needsCoverage: true }),
  event('cal-dst-first', people.malik, 'First overnight care check-in', 'SLEEPOVER', '2026-11-01T01:15:00-04:00', '2026-11-01T01:30:00-04:00', 'CONFIRMED', { participants: [people.malik, people.cassandra], confirmedBy: people.dwayne }),
  event('cal-dst-second', people.malik, 'Second overnight care check-in', 'SLEEPOVER', '2026-11-01T01:15:00-05:00', '2026-11-01T01:30:00-05:00', 'CONFIRMED', { participants: [people.malik, people.cassandra] }),
  event('cal-nora-trip', people.nora, 'Science museum field trip', 'FIELD_TRIP', '2026-11-05T09:00:00-05:00', '2026-11-05T15:00:00-05:00', 'CONFIRMED', { consentPending: true, confirmedBy: people.kendra, location: 'Science museum', links: [
    { id: 'cal-pickup-trip', childId: 'p_nora', kind: 'pickup', title: 'Field-trip pickup plan', text: 'Coverage still needs a caregiver response. No completed pickup is recorded.' },
    { id: 'cal-consent-trip', childId: 'p_nora', kind: 'consent', title: 'Field-trip consent', text: 'Consent pending. No parent decision is recorded.' },
    { id: 'cal-school-trip', childId: 'p_nora', kind: 'school', title: 'School trip note', text: 'Bring the signed permission slip for the field trip.' },
  ] }),
  event('cal-nora-closure', people.nora, 'School closed', 'SCHOOL_CLOSURE', '2026-11-09T08:00:00-05:00', '2026-11-09T15:00:00-05:00', 'CONFIRMED', { needsCoverage: true, location: null }),
  event('cal-emma-closure', people.emma, 'School closed · care plan needed', 'SCHOOL_CLOSURE', '2026-11-09T08:00:00-05:00', '2026-11-09T15:00:00-05:00', 'CONFIRMED', { needsCoverage: true, location: null }),
  event('cal-thanksgiving', people.nora, 'Thanksgiving overnight gathering', 'HOLIDAY', '2026-11-25T23:30:00-05:00', '2026-11-26T01:30:00-05:00', 'CONFIRMED', { confirmedBy: people.kendra, location: 'Family gathering' }),
  event('cal-emma-thanksgiving', people.emma, 'Thanksgiving family dinner', 'HOLIDAY', '2026-11-26T16:00:00-05:00', '2026-11-26T19:00:00-05:00', 'CONFIRMED', { confirmedBy: people.tomas }),
]
// UPCOMING routine samples, separate from the connected story examples above; not a full seed.
for (const [day, offset] of [['2026-11-03', '-05:00'], ['2026-11-10', '-05:00'], ['2026-11-17', '-05:00'], ['2026-11-24', '-05:00']] as const) {
  fixtureEvents.push(event(`cal-nora-${day}`, people.nora, 'Tigers soccer practice', 'PRACTICE', `${day}T16:30:00${offset}`, `${day}T17:30:00${offset}`))
  fixtureEvents.push(event(`cal-emma-${day}`, people.emma, 'Music rehearsal', 'PRACTICE', `${day}T16:00:00${offset}`, `${day}T17:00:00${offset}`))
  fixtureEvents.push(event(`cal-malik-${day}`, people.malik, 'Gymnastics practice', 'PRACTICE', `${day}T18:00:00${offset}`, `${day}T19:00:00${offset}`))
  fixtureEvents.push(event(`cal-jax-${day}`, people.jax, 'Tigers soccer practice', 'PRACTICE', `${day}T16:30:00${offset}`, `${day}T17:30:00${offset}`))
}
export const weeklySchedule: WeeklySchedule[] = [
  { childId: 'p_nora', parent: people.kendra, weekdays: [1, 2, 3], householdId: 'h_a' }, { childId: 'p_nora', parent: people.andre, weekdays: [0, 4, 5, 6], householdId: 'h_b' },
  { childId: 'p_jax', parent: people.dana, weekdays: [1, 2, 3, 4], householdId: 'h_c' }, { childId: 'p_jax', parent: people.ray, weekdays: [0, 5, 6], householdId: 'h_d' },
  { childId: 'p_emma', parent: people.rosa, weekdays: [0, 1, 2, 3, 4, 5, 6], householdId: 'h_e' }, { childId: 'p_emma', parent: people.tomas, weekdays: [0, 1, 2, 3, 4, 5, 6], householdId: 'h_e' },
  { childId: 'p_malik', parent: people.dwayne, weekdays: [0, 1, 2, 3, 4, 5, 6], householdId: 'h_h' },
]
export const arrangements: HolidayArrangement[] = [
  { id: 'cal-holiday-approved', childId: 'p_nora', holidayName: 'Thanksgiving', dateStart: '2026-11-25', dateEnd: '2026-11-27', assignedParent: people.kendra, status: 'APPROVED', proposedBy: people.kendra, approvalId: 'cal-holiday-approval' },
  { id: 'cal-holiday-proposed', childId: 'p_nora', holidayName: 'Thanksgiving', dateStart: '2026-11-26', dateEnd: '2026-11-27', assignedParent: people.andre, status: 'PROPOSED', proposedBy: people.andre, approvalId: null },
]
export const busySlots = [
  { id: 'cal-shift-regular', person: people.dwayne, start: '2026-10-29T22:00:00-04:00', end: '2026-10-30T06:00:00-04:00', detail: 'PRIVATE employer and shift reason', kind: 'WORK_SHIFT', linkedChild: null },
  { id: 'cal-shift-dst', person: people.dwayne, start: '2026-10-31T22:00:00-04:00', end: '2026-11-01T06:00:00-05:00', detail: 'PRIVATE employer and night-shift reason', kind: 'WORK_SHIFT', linkedChild: null },
  { id: 'cal-priya-booking', person: people.priya, start: '2026-10-28T18:00:00-04:00', end: '2026-10-28T21:00:00-04:00', detail: 'PRIVATE booking household and child', kind: 'SITTING_SESSION', linkedChild: people.malik },
  { id: 'cal-rosa-busy', person: people.rosa, start: '2026-10-29T10:00:00-04:00', end: '2026-10-29T11:00:00-04:00', detail: 'PRIVATE appointment reason', kind: 'APPOINTMENT', linkedChild: null },
]
