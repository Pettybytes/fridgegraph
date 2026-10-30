import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FamilyCalendar } from './FamilyCalendar'
import { createMockCalendarAdapter } from './mockAdapter'
function show(person = 'p_mom', route = '#/calendar?day=2026-10-28&childId=p_nora') {
  window.history.replaceState(null, '', route)
  return render(<FamilyCalendar adapter={createMockCalendarAdapter(person)} />)
}
describe('Family Calendar', () => {
  it('defaults to a week, shows readable states and opens every event to real detail', async () => {
    show()
    expect(await screen.findByRole('button', { name: /Birthday invitation/ })).toHaveTextContent('Proposed')
    expect(screen.getByRole('button', { name: /Cancelled soccer practice/ })).toHaveClass('is-cancelled')
    expect(screen.getByRole('button', { name: /Tigers soccer practice/ })).toHaveTextContent('Confirmed')
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Tigers soccer practice/ }))
    const sheet = screen.getByRole('dialog', { name: 'Tigers soccer practice' })
    expect(within(sheet).getByText('Kendra Ellison')).toBeVisible()
    expect(within(sheet).getByText(/Field 3/)).toBeVisible()
    expect(within(sheet).getByText('Tuesday, Oct 27, 16:30 EDT')).toBeVisible()
    expect(within(sheet).getByText('Tuesday, Oct 27, 17:30 EDT')).toBeVisible()
  })
  it('shows missing confirmation honestly and supports day view', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: /Birthday invitation/ }))
    expect(within(screen.getByRole('dialog')).getByText('Not confirmed yet')).toBeVisible()
    expect(within(screen.getByRole('dialog')).getByText('Location not provided')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Day' }))
    await waitFor(() => expect(screen.getAllByRole('region', { name: /day$/ })).toHaveLength(1))
  })
  it('shows both repeated-hour events in the DST week and only Busy for an adult', async () => {
    show('p_dwayne', '#/calendar?day=2026-11-01&childId=p_malik')
    expect(await screen.findByRole('button', { name: /First overnight care check-in/ })).toHaveTextContent('01:15 EDT')
    expect(screen.getByRole('button', { name: /Second overnight care check-in/ })).toHaveTextContent('01:15 EST')
    expect(screen.getByText('25-hour day · clocks change')).toBeVisible()
    expect(screen.queryByText(/employer|WORK_SHIFT|PRIVATE/)).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /Dwayne Ferris · Busy/ })[0])
    expect(screen.getByRole('dialog', { name: 'Busy' })).toHaveTextContent('Dwayne Ferris')
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/shift|employer|PRIVATE/)
  })
  it('opens authorized linked records, preserves pending consent and coverage, and hides restricted links', async () => {
    show('p_priya', '#/calendar?day=2026-11-05&childId=p_nora')
    fireEvent.click(await screen.findByRole('button', { name: /Science museum field trip/ }))
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Consent pending')
    expect(screen.getByRole('dialog')).toHaveTextContent('Details not shared with you')
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /Field-trip consent/ })).not.toBeInTheDocument()
  })
  it('opens actual parent-visible linked records and keeps source gaps explicit', async () => {
    show('p_mom', '#/calendar?day=2026-11-05&childId=p_nora')
    fireEvent.click(await screen.findByRole('button', { name: /Science museum field trip/ }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Consent pending')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Field-trip consent' }))
    expect(screen.getByRole('dialog', { name: 'Field-trip consent' })).toHaveTextContent('No parent decision is recorded')
    fireEvent.click(screen.getByRole('button', { name: 'Back to event' }))
    expect(screen.getByRole('dialog', { name: 'Science museum field trip' })).toBeVisible()
  })
  it('does not invent a confirmer for a confirmed event without that source field', async () => {
    show('p_mom', '#/calendar?day=2026-11-01&childId=p_nora&view=day')
    fireEvent.click(await screen.findByRole('button', { name: /Family sleepover/ }))
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
    fireEvent.click(await screen.findByRole('button', { name: /Tigers soccer practice/ }))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText('Confirmed by').nextElementSibling).toHaveTextContent('Details not shared with you')
    expect(within(sheet).getByText('Where').nextElementSibling).toHaveTextContent('Details not shared with you')
    expect(within(sheet).queryByText('Kendra Ellison')).not.toBeInTheDocument()
    expect(within(sheet).queryByText('Field 3')).not.toBeInTheDocument()
  })
  it('renders Rosa with guardian care bands and blocks an unauthorized deep link', async () => {
    show('p_rosa', '#/calendar?day=2026-10-28&childId=p_emma')
    expect(await screen.findByRole('button', { name: /Autumn music recital/ })).toBeVisible()
    expect(screen.getByText('Guardian view')).toBeVisible()
    expect(screen.getAllByRole('button', { name: 'Scheduled with Rosa & Tomás' })).toHaveLength(7)
    window.location.hash = '#/calendar?day=2026-10-28&childId=p_nora&event=cal-nora-practice'
    fireEvent(window, new HashChangeEvent('hashchange'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Details not shared with you'))
    expect(screen.queryByText('Tigers soccer practice')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
