import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { LiveFamilyCalendar } from './LiveFamilyCalendar'
import type { LiveCalendarAdapter, LiveWindow } from './liveAdapter'
import { localDay } from './time'

vi.mock('@ilamy/calendar', async importOriginal => ({
  ...await importOriginal<typeof import('@ilamy/calendar')>(),
  IlamyCalendar: ({ initialDate }: { initialDate: Date }) => <div data-testid="calendar-grid" data-day={localDay(initialDate.getTime())}>Calendar grid</div>,
}))

it.each([
  ['2026-11-03', '2026-10-26', '2026-12-06', '2026-11-02'],
  ['2027-01-04', '2026-12-28', '2027-02-07', '2027-01-04'],
])('reads every displayed month cell for %s and preserves the selected caregiver week', async (day, from, to, caregiverWeek) => {
  const readWindow = vi.fn(async ({ childId, from: start }: { childId: string; from: string; to: string }): Promise<LiveWindow> => ({
    childId, days: [start], events: { state: 'ready', value: [] },
    care: { [start]: { state: 'ready', value: { parent: { id: 'p_mom', displayName: 'Kendra Ellison' }, source: 'WEEKLY', arrangementId: null } } },
    conflicts: { state: 'ready', value: [] }, availability: { state: 'ready', value: [] },
  }))
  const adapter = { scope: { childId: 'p_nora', childName: 'Nora Ellison' }, parent: false, readWindow, knownEvent: () => undefined, knownChild: () => undefined } as unknown as LiveCalendarAdapter
  history.replaceState(null, '', `#/calendar?day=${day}&view=month`)
  const view = render(<LiveFamilyCalendar adapter={adapter} />)
  await waitFor(() => expect(readWindow).toHaveBeenCalledWith({ childId: 'p_nora', from, to, includeCancelled: false }))
  fireEvent.click(await screen.findByRole('button', { name: /^Caregivers$/ }))
  expect(screen.getByTestId('calendar-grid')).toHaveAttribute('data-day', caregiverWeek)
  view.unmount()
})
