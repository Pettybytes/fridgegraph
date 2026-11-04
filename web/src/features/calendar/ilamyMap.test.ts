import { describe, expect, it } from 'vitest'
import { calTypeOf, categoryType, mockToIlamy, liveToIlamy } from './ilamyMap'
import { formatTime } from './time'
import type { CalendarEvent, EventCategory } from './types'
import type { LiveEvent } from './liveAdapter'
function mockEvent(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: 'e1', child: { id: 'p_nora', displayName: 'Nora Ellison' }, title: 'Practice', category: 'PRACTICE', status: 'CONFIRMED', start: '2026-10-27T20:30:00Z', end: '2026-10-27T21:30:00Z', participants: [], location: { state: 'missing' }, confirmedBy: { state: 'missing' }, confirmedAt: { state: 'missing' }, linkedRecords: { state: 'missing' }, attention: [], ...over }
}
const liveEvent: LiveEvent = { id: 'L1', title: 'Confirmed commitment', start: '2026-11-26T18:00:00Z', end: '2026-11-26T19:00:00Z', location: null, status: 'confirmed', notes: null, color: null }
describe('design-v2 type-color mapping', () => {
  it('maps every category to its design-v2 type color (docs/design.md §2)', () => {
    const expected: Record<EventCategory, string> = {
      PARENTING_HANDOFF: 'amber', // pickup/transport
      PRACTICE: 'green', GAME: 'green', // sports / activity
      FIELD_TRIP: 'blue', SCHOOL_CLOSURE: 'blue', // school
      RECITAL: 'violet', PARTY: 'violet', // celebration
      SLEEPOVER: 'teal', HOLIDAY: 'teal', HOLIDAY_CAMP: 'teal', // care
    }
    for (const [category, color] of Object.entries(expected)) expect(categoryType[category as EventCategory]).toBe(color)
    // Every category is covered - no category falls through to neutral.
    expect(Object.keys(categoryType)).toHaveLength(Object.keys(expected).length)
  })
  it('reads live events (no recorded category) as neutral', () => {
    expect(calTypeOf(null)).toBe('neutral')
    expect(calTypeOf(undefined)).toBe('neutral')
    expect(liveToIlamy(liveEvent, true).data.type).toBe('neutral')
  })
})
describe('drag permission (editable) gating', () => {
  it('only a parent may drag; a caregiver or read-only persona gets no handles', () => {
    expect(mockToIlamy(mockEvent(), true).editable).toBe(true)   // parent
    expect(mockToIlamy(mockEvent(), false).editable).toBe(false) // caregiver / read-only
    expect(liveToIlamy(liveEvent, true).editable).toBe(true)
    expect(liveToIlamy(liveEvent, false).editable).toBe(false)
  })
  it('never lets a cancelled event be dragged, even by a parent', () => {
    expect(mockToIlamy(mockEvent({ status: 'CANCELLED' }), true).editable).toBe(false)
    expect(liveToIlamy({ ...liveEvent, status: 'cancelled' }, true).editable).toBe(false)
  })
})
describe('timezone: recorded instants are never shifted', () => {
  it('carries the recorded start/end through to ilamy unchanged', () => {
    const mapped = mockToIlamy(mockEvent(), true)
    expect(mapped.start).toBe('2026-10-27T20:30:00Z')
    expect(mapped.end).toBe('2026-10-27T21:30:00Z')
    expect(liveToIlamy(liveEvent, false).start).toBe('2026-11-26T18:00:00Z')
  })
  it('displays the recorded instant in America/Detroit (DST-aware)', () => {
    // 20:30Z on Oct 27 is 4:30 PM EDT in Detroit; the repeated-hour case keeps its zone.
    expect(formatTime('2026-10-27T20:30:00Z')).toBe('4:30 PM')
    expect(formatTime('2026-11-01T05:15:00Z')).toBe('1:15 AM EDT') // before fall-back
    expect(formatTime('2026-11-01T06:15:00Z')).toBe('1:15 AM EST') // after fall-back
  })
})
