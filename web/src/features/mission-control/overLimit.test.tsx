import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import lifecycle from '../../../../docs/mocks/pickup-job-lifecycle.json'
import { DataProvider } from '@/lib/frontendData/provider'
import { demoScope } from '@/lib/frontendData/mockAdapter'
import type { FrontendAdapter, MissionControlData } from '@/lib/frontendData/types'
import { MissionControl } from './MissionControl'
const alternative = lifecycle.overLimitPath
function projection(): MissionControlData {
  return {
    candidates: [{ id: alternative.overLimitCandidate.id, name: alternative.overLimitCandidate.displayName, channel: 'CALL', reasonCode: 'OVER_POLICY', estimatedRideCostUsd: alternative.estimatedRideCostUsd, distanceMiles: alternative.distanceMiles, costBasis: alternative.costBasis }],
    events: [],
    coordinationJobs: [{ id: 'backend-job', status: alternative.jobStatus, version: 3, idempotencyKey: 'pickup:p_nora:2026-10-28:evening', overLimitCandidate: alternative.overLimitCandidate }],
    confirmations: [],
  }
}
function adapterFor(read: () => Promise<MissionControlData>, approve: NonNullable<FrontendAdapter['approvePickup']>): FrontendAdapter {
  return { mode: 'graphql', readMissionControl: read, readVillage: async () => ({ nodes: [], edges: [] }), readParentChat: async () => ({ messages: [] }), approvePickup: approve }
}
describe('backend-supplied over-limit alternative', () => {
  it('uses only the supplied candidate and requires separate explicit acceptance', async () => {
    const data = projection()
    const approve = vi.fn(async () => ({ id: 'backend-job', status: 'confirmed', version: 4 }))
    render(<DataProvider adapter={adapterFor(async () => data, approve)} scope={demoScope}><MissionControl /></DataProvider>)
    expect(await screen.findByRole('heading', { name: "Nora's evening pickup" })).toBeVisible()
    expect(screen.getAllByRole('button', { name: /^Select / })).toHaveLength(1)
    expect(screen.queryByText('Tasha Ellison')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: "Rosina's recommendation" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review over-limit option' }))
    const dialog = screen.getByRole('dialog', { name: 'Review Loretta Brooks' })
    expect(within(dialog).getByText(alternative.costBasis)).toBeVisible()
    const accept = within(dialog).getByRole('button', { name: 'Accept over-limit option' })
    expect(accept).toBeDisabled()
    expect(approve).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'I accept this option above my travel limit' }))
    expect(accept).toBeEnabled()
    fireEvent.click(accept)
    await waitFor(() => expect(approve).toHaveBeenCalledWith(demoScope, { jobId: 'backend-job', version: 3, decision: 'APPROVED', acceptOverLimit: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Even a mutation response saying confirmed cannot substitute for the authorized read's evidence.
    expect(screen.getByRole('status')).toHaveTextContent('Awaiting parent approval')
    expect(screen.queryByText('Over-limit option explicitly accepted.')).not.toBeInTheDocument()
  })
  it('shows exception acceptance only when the returned Confirmation says so', async () => {
    const data = projection()
    data.coordinationJobs![0].status = 'confirmed'
    data.confirmations = [{ id: 'backend-confirmation', job: { id: 'backend-job' }, receivedAt: '2026-10-28T15:14:00Z', candidate: alternative.overLimitCandidate, approvedBy: { id: 'p_mom', displayName: 'Kendra Ellison' }, overLimitApproved: true }]
    render(<DataProvider adapter={adapterFor(async () => data, vi.fn())} scope={demoScope}><MissionControl /></DataProvider>)
    expect(await screen.findByText('Over-limit option explicitly accepted.')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Parent approval recorded')
    expect(screen.queryByRole('button', { name: 'Review over-limit option' })).not.toBeInTheDocument()
  })
})
