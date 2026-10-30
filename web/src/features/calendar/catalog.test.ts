import { describe, expect, it } from 'vitest'
import { actionAllowed, actionRoute, catalog, validateActions } from '@/features/rosina/catalog'
import { createMockCalendarAdapter } from './mockAdapter'
describe('calendar catalog entries', () => {
  it('validates dates, child and event IDs and constructs its own routes', () => {
    const [calendar] = validateActions([{ id: 'open-calendar', args: { day: '2026-11-01', childId: 'p_emma' }, route: 'https://untrusted.example' }])
    expect(actionRoute(calendar)).toBe('#/calendar?day=2026-11-01&childId=p_emma&view=day')
    const [event] = validateActions([{ id: 'open-event', args: { id: 'cal-emma-recital' } }])
    expect(actionRoute(event)).toBe('#/calendar?event=cal-emma-recital')
    expect(catalog['open-calendar'].implemented).toBe(true)
    expect(catalog['open-event'].changesData).toBe(false)
    expect(validateActions([
      { id: 'open-calendar', args: { day: '2026-02-30', childId: 'p_nora' } },
      { id: 'open-calendar', args: { day: '2026-11-01', childId: 'p_nora', url: 'https://untrusted.example' } },
      { id: 'open-event', args: { id: '../../private' } },
    ])).toEqual([])
  })
  it('checks allowed calendar and event IDs independently of valid argument shape', async () => {
    const adapter = createMockCalendarAdapter('p_rosa')
    const data = await adapter.readCalendar({ childId: 'p_emma', from: '2026-10-26', to: '2026-11-01' })
    const context = { childId: 'p_emma', parent: false, visiblePeople: new Set<string>(), calendarChildIds: new Set(['p_emma']), calendarEventIds: new Set(data.events.map(e => e.id)) }
    expect(actionAllowed({ id: 'open-calendar', args: { day: '2026-11-01', childId: 'p_emma' } }, context)).toBe(true)
    expect(actionAllowed({ id: 'open-calendar', args: { day: '2026-11-01', childId: 'p_nora' } }, context)).toBe(false)
    expect(actionAllowed({ id: 'open-event', args: { id: 'cal-emma-recital' } }, context)).toBe(true)
    expect(actionAllowed({ id: 'open-event', args: { id: 'cal-nora-practice' } }, context)).toBe(false)
  })
})
