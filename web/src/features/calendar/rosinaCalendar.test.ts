import { expect, it } from 'vitest'
import { createMockAuthAdapter } from '@/features/personas/auth'
import { createMockRosinaAdapter } from '@/features/rosina/adapter'
async function rosina(person: 'rosa' | 'priya' | 'dwayne') {
  const session = await createMockAuthAdapter().signInAsPersona(person)
  return createMockRosinaAdapter({ ...session, generation: 1 })
}
it('opens Malik through Priya’s separate schedule grant, not Nora’s session default', async () => {
  const response = await (await rosina('priya')).send({ message: "Open Malik's calendar on 2026-11-01", currentRoute: '#/calendar?childId=p_nora', history: [] })
  expect(response.actions).toEqual([{ id: 'open-calendar', args: { day: '2026-11-01', childId: 'p_malik' } }])
})
it('does not offer a foreign child’s calendar to Rosa', async () => {
  const response = await (await rosina('rosa')).send({ message: "Open Nora's calendar", currentRoute: '#/calendar?childId=p_emma', history: [] })
  expect(response.actions).toEqual([])
  expect(response.reply).toContain('not shared with you')
})
it('opens a source event by id and asks rather than picking between repeated-hour check-ins', async () => {
  const recital = await (await rosina('rosa')).send({ message: 'Show the music recital', currentRoute: '#/calendar?childId=p_emma', history: [] })
  expect(recital.actions).toEqual([{ id: 'open-event', args: { id: 'cal-emma-recital' } }])
  const ambiguous = await (await rosina('dwayne')).send({ message: 'Show the check-in', currentRoute: '#/calendar?childId=p_malik', history: [] })
  expect(ambiguous.actions).toEqual([])
  expect(ambiguous.reply).toContain('Which event')
})
it('never carries Nora’s care information into Malik’s calendar or deep-linked event context', async () => {
  for (const currentRoute of ['#/calendar?childId=p_malik', '#/calendar?event=cal-malik-gym']) {
    const response = await (await rosina('priya')).send({ message: 'Can this child have a peanut-butter snack?', currentRoute, history: [] })
    expect(response.reply).toContain("I can't confirm that yet")
    expect(response.reply).not.toContain('Peanut allergy')
    expect(response.actions).toEqual([])
  }
})
