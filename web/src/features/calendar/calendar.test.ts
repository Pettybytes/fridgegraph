import { describe, expect, it } from 'vitest'
import { createMockCalendarAdapter } from './mockAdapter'
import { careBand, dayItems } from './model'
import { addDays, dayHours, formatTime, localDay, midnight, segmentLabel, weekStart } from './time'
const range = { from: '2026-10-26', to: '2026-11-01' }
describe('Detroit calendar time', () => {
  it('uses civil dates and a 25-hour Sunday in a week spanning DST', () => {
    expect(weekStart('2026-11-01')).toBe('2026-10-26')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(new Date(midnight('2026-11-01')).toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(new Date(midnight('2026-11-02')).toISOString()).toBe('2026-11-02T05:00:00.000Z')
    expect(dayHours('2026-10-31')).toBe(24)
    expect(dayHours('2026-11-01')).toBe(25)
    expect(dayHours('2026-11-02')).toBe(24)
    expect(formatTime('2026-10-30T16:00:00Z')).toBe('12:00 EDT')
    expect(formatTime('2026-11-02T17:00:00Z')).toBe('12:00 EST')
  })
  it('distinguishes both occurrences of 01:15 without dropping or duplicating source events', async () => {
    const data = await createMockCalendarAdapter('p_dwayne').readCalendar({ childId: 'p_malik', ...range })
    const sunday = dayItems(data, '2026-11-01').events
    expect(sunday.map(e => e.id)).toEqual(['cal-dst-first', 'cal-dst-second'])
    expect(sunday.map(e => formatTime(e.start))).toEqual(['01:15 EDT', '01:15 EST'])
    expect(new Set(sunday.map(e => e.id)).size).toBe(2)
  })
  it('splits Dwayne overnight shifts at Detroit midnight, including the extra DST hour', async () => {
    const data = await createMockCalendarAdapter('p_dwayne').readCalendar({ childId: 'p_malik', ...range })
    const regular = data.busy.find(e => e.id === 'cal-shift-regular')!
    const dst = data.busy.find(e => e.id === 'cal-shift-dst')!
    expect((Date.parse(regular.end) - Date.parse(regular.start)) / 3600000).toBe(8)
    expect((Date.parse(dst.end) - Date.parse(dst.start)) / 3600000).toBe(9)
    expect(dayItems(data, '2026-10-29').busy.map(e => e.id)).toContain(regular.id)
    expect(dayItems(data, '2026-10-30').busy.map(e => e.id)).toContain(regular.id)
    expect(segmentLabel(dst.start, dst.end, '2026-10-31')).toBe('22:00 EDT – continues next day')
    expect(segmentLabel(dst.start, dst.end, '2026-11-01')).toBe('Continues – 06:00 EST')
    expect(localDay(dst.end)).toBe('2026-11-01')
  })
})
describe('calendar scope and source fidelity', () => {
  it.each([
    ['p_mom', ['p_nora']], ['p_priya', ['p_nora', 'p_malik']], ['p_dana', ['p_jax']], ['p_rosa', ['p_emma']],
  ])('%s receives only the children allowed by their own authority or scoped grants', async (person, allowed) => {
    const adapter = createMockCalendarAdapter(person as string)
    expect((await adapter.listChildren()).map(child => child.id)).toEqual(allowed)
    for (const child of await adapter.listChildren()) {
      const data = await adapter.readCalendar({ childId: child.id, ...range })
      expect(data.events.every(e => e.child.id === child.id)).toBe(true)
      expect(data.weeklySchedule.every(e => e.childId === child.id)).toBe(true)
    }
    const foreign = person === 'p_rosa' ? 'p_nora' : 'p_emma'
    await expect(adapter.readCalendar({ childId: foreign, ...range })).rejects.toThrow('UNAUTHORIZED')
    await expect(adapter.readEvent(person === 'p_rosa' ? 'cal-nora-practice' : 'cal-emma-recital')).rejects.toThrow('UNAUTHORIZED')
  })
  it('uses guardian authority without requiring a parent account for Emma', async () => {
    const adapter = createMockCalendarAdapter('p_rosa')
    expect(await adapter.listChildren()).toEqual([{ id: 'p_emma', displayName: 'Emma', authority: 'guardian' }])
    const data = await adapter.readCalendar({ childId: 'p_emma', ...range })
    expect(careBand(data, '2026-10-28').label).toBe('Scheduled with Rosa & Tomás')
    expect(data.events.map(e => e.title)).toContain('Autumn music recital')
    expect(JSON.stringify(data)).not.toMatch(/p_nora|p_jax|p_malik/)
  })
  it('never returns busy reasons, kind, employer or linked-family data, even to the owner', async () => {
    for (const person of ['p_mom', 'p_priya', 'p_dwayne', 'p_rosa']) {
      const adapter = createMockCalendarAdapter(person)
      for (const child of await adapter.listChildren()) {
        const data = await adapter.readCalendar({ childId: child.id, ...range })
        expect(JSON.stringify(data.busy)).not.toMatch(/PRIVATE|employer|kind|detail|linkedChild|linkedHousehold/)
        for (const row of data.busy) expect(Object.keys(row).sort()).toEqual(['end', 'id', 'person', 'start'])
      }
    }
  })
  it('distinguishes known, missing and hidden detail without fabricating a confirmer', async () => {
    const parent = createMockCalendarAdapter('p_mom'), sitter = createMockCalendarAdapter('p_priya')
    expect((await parent.readEvent('cal-nora-practice')).confirmedBy).toMatchObject({ state: 'visible', value: { displayName: 'Kendra Ellison' } })
    expect((await parent.readEvent('cal-nora-overnight')).confirmedBy).toEqual({ state: 'missing' })
    expect((await parent.readEvent('cal-nora-party')).confirmedBy).toEqual({ state: 'missing' })
    expect((await parent.readEvent('cal-nora-trip')).linkedRecords.state).toBe('visible')
    const limited = await sitter.readEvent('cal-nora-trip')
    expect(limited.linkedRecords).toEqual({ state: 'hidden' })
    expect(limited.attention).not.toContain('Consent pending')
    expect(JSON.stringify(limited)).not.toMatch(/cal-pickup-trip|cal-consent-trip|cal-school-trip|signed permission slip/)
  })
  it('keeps cancelled records within child scope and preserves unresolved facts', async () => {
    const nora = await createMockCalendarAdapter('p_mom').readCalendar({ childId: 'p_nora', from: '2026-10-26', to: '2026-11-10' })
    expect(nora.events.find(e => e.id === 'cal-nora-cancelled')?.status).toBe('CANCELLED')
    expect(nora.events.some(e => e.id === 'cal-emma-cancelled')).toBe(false)
    expect(nora.events.find(e => e.id === 'cal-nora-party')?.attention).toEqual(['Unconfirmed'])
    expect(nora.events.find(e => e.id === 'cal-nora-trip')?.attention).toContain('Consent pending')
    expect(nora.events.find(e => e.id === 'cal-nora-closure')?.attention).toContain('Needs coverage')
  })
})
describe('holiday precedence and day boundaries', () => {
  it('applies the approved Thanksgiving range before the weekly plan, never a proposal', async () => {
    const data = await createMockCalendarAdapter('p_mom').readCalendar({ childId: 'p_nora', from: '2026-11-23', to: '2026-11-29' })
    expect(careBand(data, '2026-11-24').label).toBe('Scheduled with Kendra')
    expect(careBand(data, '2026-11-25').state).toBe('holiday')
    expect(careBand(data, '2026-11-26').label).toBe('Holiday arrangement: scheduled with Kendra')
    expect(careBand(data, '2026-11-27').state).toBe('holiday')
    expect(careBand(data, '2026-11-28').label).toBe('Scheduled with Andre')
    expect(dayItems(data, '2026-11-26').arrangements[0].status).toBe('PROPOSED')
    const before = dayItems(data, '2026-11-25').events.find(e => e.id === 'cal-thanksgiving')!
    const after = dayItems(data, '2026-11-26').events.find(e => e.id === before.id)!
    expect(after.id).toBe(before.id)
    expect(segmentLabel(before.start, before.end, '2026-11-25')).toContain('continues next day')
    expect(segmentLabel(after.start, after.end, '2026-11-26')).toBe('Continues – 01:30 EST')
    expect(dayItems(data, '2026-11-27').events.some(e => e.id === before.id)).toBe(false)
  })
  it('surfaces overlapping approved arrangements and missing weekly records rather than guessing', async () => {
    const data = await createMockCalendarAdapter('p_mom').readCalendar({ childId: 'p_nora', from: '2026-11-23', to: '2026-11-29' })
    data.holidayArrangements[1].status = 'APPROVED'
    expect(careBand(data, '2026-11-26')).toMatchObject({ state: 'conflict', label: 'Schedule needs review' })
    data.weeklySchedule = []
    expect(careBand(data, '2026-11-24')).toMatchObject({ state: 'missing', label: 'Schedule not recorded' })
  })
})
