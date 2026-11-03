import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FamilyCalendar } from './FamilyCalendar'
import { createMockCalendarAdapter } from './mockAdapter'
// The event grid is now @ilamy/calendar: events render as our CalendarEventPill
// (`.cal-pill[data-event-title]`, with is-proposed/is-cancelled and the type
// color), not as <button name=title>. These tests target that DOM and the
// unchanged privacy-aware detail sheet, care list and busy/free chrome. The
// care schedule stays a list of per-day buttons named by the care label, so
// those assertions are unchanged.
function show(person = 'p_mom', route = '#/calendar?day=2026-10-28&childId=p_nora') {
  window.history.replaceState(null, '', route)
  return render(<FamilyCalendar adapter={createMockCalendarAdapter(person)} />)
}
function pill(title: string) { return document.querySelector(`.cal-pill[data-event-title="${title}"]`) as HTMLElement | null }
async function findPill(title: string) { await waitFor(() => expect(pill(title)).not.toBeNull()); return pill(title)! }
// Clicking the pill bubbles to ilamy's event wrapper, which runs onEventClick.
async function openEvent(title: string) { fireEvent.click(await findPill(title)) }
describe('Family Calendar', () => {
  it('shows readable states on the event pills and opens every event to real detail', async () => {
    const { container } = show()
    expect(await findPill('Birthday invitation')).toHaveClass('is-proposed')
    expect(pill('Birthday invitation')).toHaveTextContent('Proposed')
    expect(pill('Cancelled soccer practice')).toHaveClass('is-cancelled')
    expect(pill('Tigers soccer practice')).toHaveClass('is-confirmed')
    // The week window is loaded (seven care-schedule days), the default view.
    expect(container.querySelectorAll('.cal-care')).toHaveLength(7)
    await openEvent('Tigers soccer practice')
    const sheet = screen.getByRole('dialog', { name: 'Tigers soccer practice' })
    expect(within(sheet).getByText('Kendra Ellison')).toBeVisible()
    expect(within(sheet).getByText(/Field 3/)).toBeVisible()
    expect(within(sheet).getByText('Tuesday, Oct 27, 4:30 PM')).toBeVisible()
    expect(within(sheet).getByText('Tuesday, Oct 27, 5:30 PM')).toBeVisible()
  })
  it('shows missing confirmation honestly and renders a day-view route without error', async () => {
    show()
    await openEvent('Birthday invitation')
    expect(within(screen.getByRole('dialog')).getByText('Not confirmed yet')).toBeVisible()
    expect(within(screen.getByRole('dialog')).getByText('Location not provided')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    // Day view is driven by the route; the grid renders it without error.
    show('p_mom', '#/calendar?day=2026-10-28&childId=p_nora&view=day')
    expect(await findPill('Birthday invitation')).toBeInTheDocument()
  })
  it('shows both repeated-hour events in the DST week and only Busy for an adult', async () => {
    show('p_dwayne', '#/calendar?day=2026-11-01&childId=p_malik')
    // Pill time is formatted from the recorded instant in Detroit, so the repeated
    // 1:15 AM hour reads EDT on one check-in and EST on the other.
    expect(await findPill('First overnight care check-in')).toHaveTextContent('1:15 AM EDT')
    expect(pill('Second overnight care check-in')).toHaveTextContent('1:15 AM EST')
    expect(screen.queryByText(/employer|WORK_SHIFT|PRIVATE/)).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /Dwayne Ferris · Busy/ })[0])
    expect(screen.getByRole('dialog', { name: 'Busy' })).toHaveTextContent('Dwayne Ferris')
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/shift|employer|PRIVATE/)
  })
  it('opens authorized linked records, preserves pending consent and coverage, and hides restricted links', async () => {
    show('p_priya', '#/calendar?day=2026-11-05&childId=p_nora')
    await openEvent('Science museum field trip')
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Consent pending')
    expect(screen.getByRole('dialog')).toHaveTextContent('Details not shared with you')
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /Field-trip consent/ })).not.toBeInTheDocument()
  })
  it('opens actual parent-visible linked records and keeps source gaps explicit', async () => {
    show('p_mom', '#/calendar?day=2026-11-05&childId=p_nora')
    await openEvent('Science museum field trip')
    expect(screen.getByRole('dialog')).toHaveTextContent('Consent pending')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Field-trip consent' }))
    expect(screen.getByRole('dialog', { name: 'Field-trip consent' })).toHaveTextContent('No parent decision is recorded')
    fireEvent.click(screen.getByRole('button', { name: 'Back to event' }))
    expect(screen.getByRole('dialog', { name: 'Science museum field trip' })).toBeVisible()
  })
  it('does not invent a confirmer for a confirmed event without that source field', async () => {
    show('p_mom', '#/calendar?day=2026-11-01&childId=p_nora&view=day')
    await openEvent('Family sleepover')
    const sheet = screen.getByRole('dialog')
    expect(sheet).toHaveTextContent('Confirmed')
    expect(sheet).toHaveTextContent('Confirmer not recorded')
    expect(within(sheet).queryByText('Andre Ellison')).not.toBeInTheDocument()
    expect(within(sheet).queryByText('Kendra Ellison')).not.toBeInTheDocument()
  })
  it('honors redacted source fields instead of filling them from the signed-in person', async () => {
    window.location.hash = '#/calendar?day=2026-10-28&childId=p_nora'
    const base = createMockCalendarAdapter('p_mom')
    render(<FamilyCalendar adapter={{ ...base, readCalendar: async input => {
      const data = await base.readCalendar(input)
      const event = data.events.find(event => event.id === 'cal-nora-practice')!
      event.confirmedBy = { state: 'hidden' }; event.location = { state: 'hidden' }
      return data
    } }} />)
    await openEvent('Tigers soccer practice')
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText('Confirmed by').nextElementSibling).toHaveTextContent('Details not shared with you')
    expect(within(sheet).getByText('Where').nextElementSibling).toHaveTextContent('Details not shared with you')
    expect(within(sheet).queryByText('Kendra Ellison')).not.toBeInTheDocument()
    expect(within(sheet).queryByText('Field 3')).not.toBeInTheDocument()
  })
  it('renders Rosa with guardian care bands and blocks an unauthorized deep link', async () => {
    show('p_rosa', '#/calendar?day=2026-10-28&childId=p_emma')
    await findPill('Autumn music recital')
    expect(screen.getByText('Guardian view')).toBeVisible()
    expect(screen.getAllByRole('button', { name: 'Scheduled with Rosa & Tomás' })).toHaveLength(7)
    window.location.hash = '#/calendar?day=2026-10-28&childId=p_nora&event=cal-nora-practice'
    fireEvent(window, new HashChangeEvent('hashchange'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Details not shared with you'))
    expect(screen.queryByText('Tigers soccer practice')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
