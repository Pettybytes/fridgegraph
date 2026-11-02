import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataProvider } from '@/lib/frontendData/provider'
import { demoScope } from '@/lib/frontendData/mockAdapter'
import type { FrontendAdapter } from '@/lib/frontendData/types'
import { MissionControl } from './MissionControl'
import { createPickupDemoAdapter } from './demoAdapter'
import lifecycle from '../../../../docs/mocks/pickup-job-lifecycle.json'
function show(adapter: FrontendAdapter = createPickupDemoAdapter()) {
  render(<DataProvider adapter={adapter} scope={demoScope}><MissionControl /></DataProvider>)
}
describe('Mission Control UI', () => {
  it('renders recorded rows, Rosina recommendation and both timelines without claiming approval', async () => {
    show()
    expect(await screen.findByRole('heading', { name: "Nora's afternoon pickup" })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Awaiting parent approval')
    expect(screen.getAllByRole('button', { name: /^Select / })).toHaveLength(4)
    expect(screen.getByRole('heading', { name: "Rosina's recommendation" })).toBeVisible()
    expect(screen.getByRole('heading', { name: "Rosina's activity trace" })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Job timeline' })).toBeVisible()
    expect(screen.queryByText('Approval recorded at 15:14 UTC', { exact: false })).not.toBeInTheDocument()
  })
  it('reviews an over-limit alternative on a no-driver night', async () => {
    const base = createPickupDemoAdapter()
    const data = await base.readMissionControl(demoScope)
    const noDriverNight = lifecycle.overLimitPath
    data.candidates = [{ id: noDriverNight.overLimitCandidate.id, name: noDriverNight.overLimitCandidate.displayName, channel: 'CALL', reasonCode: 'OVER_POLICY', distanceMiles: noDriverNight.distanceMiles, estimatedRideCostUsd: noDriverNight.estimatedRideCostUsd, costBasis: noDriverNight.costBasis }]
    show({ ...base, readMissionControl: async () => data })
    fireEvent.click(await screen.findByRole('button', { name: 'Select Loretta Brooks' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Review Loretta Brooks' })).toBeVisible()
    expect(within(dialog).getByText(/Rideshare to school/)).toBeVisible()
    expect(within(dialog).getByText(/Est. \$12.40/)).toBeVisible()
    expect(within(dialog).getByText('Straight-line approximation — may understate road cost')).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: 'Replay recorded approval' })).not.toBeInTheDocument()
  })
  it('omits all paid-ride labels and bases on a normal night', async () => {
    show()
    await screen.findByRole('heading', { name: "Nora's afternoon pickup" })
    expect(screen.queryByText(/Rideshare to school/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Recorded basis:/)).not.toBeInTheDocument()
  })
  it('displays a real zero estimate with its basis on a no-driver night', async () => {
    const base = createPickupDemoAdapter()
    const data = await base.readMissionControl(demoScope)
    const option = lifecycle.overLimitPath
    data.candidates = [{ id: 'p_gma', name: 'Loretta Brooks', channel: 'CALL', reasonCode: 'AVAILABLE_NO_TRANSPORT', distanceMiles: 0, estimatedRideCostUsd: 0, costBasis: option.costBasis }]
    show({ ...base, readMissionControl: async () => data })
    expect(await screen.findByText(/Est. \$0.00/)).toBeVisible()
    expect(screen.getByText(`Recorded basis: ${option.costBasis}`)).toBeVisible()
  })
  it('requires the explicit simulated approval action before displaying confirmation evidence', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve pickup' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Simulated demo/)).toHaveTextContent('Simulated demo')
    expect(within(dialog).getByText(/Awaiting parent approval/)).toHaveTextContent('Awaiting parent approval')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replay recorded approval' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Parent approval recorded')
    expect(screen.getByText('Approval recorded at 15:14 UTC', { exact: false })).toBeVisible()
    expect(screen.getByText('Approval is recorded. Pickup completion has not been recorded.')).toBeVisible()
  })
  it('does not accept job status or trace words as a Confirmation row', async () => {
    const base = createPickupDemoAdapter()
    const data = await base.readMissionControl(demoScope)
    const adapter = { ...base, readMissionControl: async () => ({ ...data, coordinationJobs: [{ id: 'job_01HXYZ', status: 'confirmed', version: 4 }], confirmations: [] }) }
    show(adapter)
    expect(await screen.findByRole('status')).toHaveTextContent('Loading')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Awaiting approval evidence'))
    expect(screen.getByRole('button', { name: 'Approve pickup' })).toBeDisabled()
  })
  it('renders PENDING as Waiting for reply without a recommendation or approval action', async () => {
    const base = createPickupDemoAdapter()
    const data = await base.readMissionControl(demoScope)
    for (const candidate of data.candidates) if (candidate.id === 'p_tasha') candidate.reasonCode = 'PENDING'
    show({ ...base, readMissionControl: async () => data })
    expect(await screen.findByText('Waiting for reply')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Approve pickup' })).not.toBeInTheDocument()
  })
  it('shows action failure without displaying a confirmation', async () => {
    show({ ...createPickupDemoAdapter(), approvePickup: async () => { throw new Error('This pickup changed. Refresh and review it again.') } })
    fireEvent.click(await screen.findByRole('button', { name: 'Approve pickup' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replay recorded approval' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This pickup changed')
    expect(within(dialog).getByText(/Awaiting parent approval/)).toHaveTextContent('Awaiting parent approval')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close review' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Awaiting parent approval')
  })
  it.each([
    ['Approve pickup', 'Escape'], ['Approve pickup', 'Close'],
    ['Review', 'Escape'], ['Review', 'Close'],
  ])('restores focus to %s after %s and keeps background inaccessible while open', async (openerName, dismissal) => {
    show()
    await screen.findByRole('heading', { name: "Nora's afternoon pickup" })
    const opener = screen.getByRole('button', { name: openerName })
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Review Tasha Ellison' })
    expect(dialog).toHaveAccessibleName('Review Tasha Ellison')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: openerName })).not.toBeInTheDocument()
    if (dismissal === 'Escape') fireEvent.keyDown(document, { key: 'Escape' })
    else fireEvent.click(within(dialog).getByRole('button', { name: 'Close review' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
    expect(screen.getByRole('status')).toHaveTextContent('Awaiting parent approval')
  })
  it('shows empty and access-error states without inventing a job', async () => {
    const base = createPickupDemoAdapter()
    show({ ...base, readMissionControl: async () => ({ candidates: [], events: [] }) })
    expect(await screen.findByText('No pickup job has been recorded.')).toBeVisible()
    expect(screen.queryByText('Request acknowledged')).not.toBeInTheDocument()
  })
})
