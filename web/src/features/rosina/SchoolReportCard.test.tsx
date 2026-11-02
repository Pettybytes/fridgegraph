import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SchoolReportCard } from './SchoolReportCard'
import { createMockSchoolReportConfirm, parseSchoolReportProposal, schoolReportError, type SchoolReportProposal } from './schoolReport'

const proposal: SchoolReportProposal = { id: 'srp_sample', version: 2, childId: 'p_nora', kind: 'fever', text: 'Nora has a fever today.', createdAt: '2026-11-01T20:00:00Z', expiresAt: '2099-11-01T20:10:00Z' }
const report = { id: 'sr_once', child: { id: 'p_nora' }, kind: proposal.kind, text: proposal.text, at: '2026-11-01', reportedAt: '2026-11-01T20:03:00Z' }
function card(confirm = vi.fn().mockResolvedValue(report), options: Partial<Parameters<typeof SchoolReportCard>[0]> = {}) {
  render(<SchoolReportCard proposal={proposal} childName="Nora Ellison" canConfirm accessLoading={false} mode="live" confirm={confirm} {...options} />)
  return confirm
}

describe('teacher review card', () => {
  it('shows the exact proposal and does not file on render or rerender', async () => {
    const confirm = vi.fn().mockResolvedValue(report)
    const view = render(<SchoolReportCard proposal={proposal} childName="Nora Ellison" canConfirm accessLoading={false} mode="live" confirm={confirm} />)
    expect(screen.getByRole('region', { name: 'Review proposed school-day report' })).toHaveTextContent('Nora has a fever today.')
    view.rerender(<SchoolReportCard proposal={proposal} childName="Nora Ellison" canConfirm accessLoading={false} mode="live" confirm={confirm} />)
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm report' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(confirm.mock.calls[0][0]).toEqual(proposal)
    expect(await screen.findByText(/Report filed/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Confirm report' })).toBeDisabled()
  })
  it('never offers confirm without the child-scoped reporting grant', () => {
    const confirm = card(undefined, { canConfirm: false })
    expect(screen.queryByRole('button', { name: /Confirm report/ })).not.toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()
  })
  it.each([
    ['PROPOSAL_EXPIRED', /proposal expired/i],
    ['PROPOSAL_STALE', /proposal changed/i],
    ['UNAUTHORIZED', /not shared with your role/i],
    ['UNAUTHENTICATED', /session ended/i],
  ])('shows %s without success or an automatic retry', async (code, message) => {
    const confirm = card(vi.fn().mockRejectedValue({ errors: [{ extensions: { code } }] }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm report' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Report filed/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm report' })).toBeDisabled()
  })
  it('an uncertain retry sends the SAME proposal and can display the SAME returned report', async () => {
    const confirm = card(vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(report))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm report' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn’t confirm whether/)
    expect(confirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retry same report' }))
    expect(await screen.findByText(/Report filed/)).toBeVisible()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(confirm.mock.calls.map(call => call[0])).toEqual([proposal, proposal])
  })
  it('still allows an explicit idempotent retry after expiry when the first result was uncertain', async () => {
    const shortlyExpiring={...proposal,expiresAt:new Date(Date.now()+1000).toISOString()}
    const confirm=vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(report)
    const view=render(<SchoolReportCard proposal={shortlyExpiring} childName="Nora Ellison" canConfirm accessLoading={false} mode="live" confirm={confirm} />)
    fireEvent.click(screen.getByRole('button',{name:'Confirm report'}))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn’t confirm whether/)
    const clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse(shortlyExpiring.expiresAt)+1000)
    try{
      view.rerender(<SchoolReportCard proposal={shortlyExpiring} childName="Nora Ellison" canConfirm accessLoading={false} mode="live" confirm={confirm} />)
      expect(screen.getByRole('button',{name:'Retry same report'})).toBeEnabled()
      fireEvent.click(screen.getByRole('button',{name:'Retry same report'}))
      expect(await screen.findByText(/Report filed/)).toBeVisible()
      expect(confirm.mock.calls.map(call=>call[0])).toEqual([shortlyExpiring,shortlyExpiring])
    }finally{clock.mockRestore()}
  })
  it('labels mock confirmation and creates no real record', async () => {
    const confirm = createMockSchoolReportConfirm()
    render(<SchoolReportCard proposal={proposal} childName="Nora Ellison" canConfirm accessLoading={false} mode="mock" confirm={confirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm report' }))
    expect(await screen.findByText(/Sample reviewed. No school record was filed/)).toBeVisible()
    expect(await confirm(proposal)).toEqual(await confirm(proposal))
  })
  it('rejects malformed structured proposals and maps only documented errors', () => {
    expect(parseSchoolReportProposal({ ...proposal, version: '2' })).toBeNull()
    expect(parseSchoolReportProposal({ ...proposal, childId: '' })).toBeNull()
    expect(parseSchoolReportProposal(proposal)).toEqual(proposal)
    expect(schoolReportError({ errors: [{ message: 'PROPOSAL_EXPIRED' }] })).toBe('expired')
    expect(schoolReportError(new Error('network'))).toBe('uncertain')
  })
  it('aborts and discards a late confirm result when its persona or child view unmounts', async () => {
    let resolve!: (value: typeof report) => void
    let signal:AbortSignal|undefined
    const confirm = vi.fn((_proposal:SchoolReportProposal, received?:AbortSignal) => { signal=received;return new Promise<typeof report>(done => { resolve=done }) })
    const view = render(<SchoolReportCard proposal={proposal} childName="Nora Ellison" canConfirm accessLoading={false} mode="live" confirm={confirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm report' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => resolve(report))
    expect(screen.queryByText(/Report filed/)).not.toBeInTheDocument()
  })
})
