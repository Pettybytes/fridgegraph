import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AddVillagerReview, ReviewCard } from './AddVillagerReview'
import { addVillagerError, createLiveAddVillagerConfirm, createMockAddVillagerConfirm, parseAddVillagerProposal } from './addVillager'
import type { AddVillagerProposal, AddVillagerResult } from './addVillager'

const proposal: AddVillagerProposal = {
  id: 'vp_1', version: 2, childId: 'p_nora', personId: 'p_dana', personDisplayName: 'Dana Coleman',
  relationshipType: 'friend_parent', scopes: ['pickup.request'], validFrom: '2026-11-01', validUntil: '2026-12-31',
  createdAt: '2026-11-01T20:00:00Z', expiresAt: '2099-11-01T20:10:00Z',
}
const result: AddVillagerResult = {
  relationship: { id: 'r_1', from: { id: 'p_dana' }, to: { id: 'p_nora' }, type: 'friend_parent', status: 'ACTIVE' },
  grant: { id: 'g_1', actor: { id: 'p_dana' }, child: { id: 'p_nora' }, scopes: ['pickup.request'], validFrom: '2026-11-01', validUntil: '2026-12-31', grantedBy: { id: 'p_mom' } },
}

vi.mock('@/features/personas/Session', () => ({ useSession: () => ({
  session: currentSession, authMode: 'mock', getSessionGeneration: () => generation,
}) }))
vi.mock('@/features/personas/childContext', () => ({ useChildAccess: () => ({
  selectedChildId: selectedChild, selectedChildName: 'Nora Ellison', client: null,
}) }))
let generation = 1
let selectedChild = 'p_nora'
let currentSession: { generation: number; persona: { parent: boolean; personId: string }; scope: { childId: string; childName: string }; marks: { demoGuide: boolean } } | null =
  { generation: 1, persona: { parent: true, personId: 'p_mom' }, scope: { childId: 'p_nora', childName: 'Nora Ellison' }, marks: { demoGuide: false } }

describe('Add a Villager review', () => {
  it('shows exact scopes and window, keeps unknowns explicit, and sends nothing on render', async () => {
    const confirm = vi.fn().mockResolvedValue(result)
    render(<AddVillagerReview proposal={proposal} confirm={confirm} />)
    const card = screen.getByRole('region', { name: 'Review Add a Villager proposal' })
    expect(card).toHaveTextContent('Dana Coleman')
    expect(card).toHaveTextContent('friend_parent')
    expect(card).toHaveTextContent('pickup.request')
    expect(card).not.toHaveTextContent('schedule.read')
    expect(card).toHaveTextContent('2026-12-31')
    expect(card).toHaveTextContent('does not verify free time, acceptance, transport, or a completed pickup')
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Add a Villager' }))
    expect(await screen.findByText(/Sample reviewed/)).toBeVisible()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toEqual(proposal)
  })
  it('never reveals the proposal or confirm button to a non-parent or another child', () => {
    currentSession = { ...currentSession!, persona: { parent: false, personId: 'p_priya' } }
    const view = render(<AddVillagerReview proposal={proposal} />)
    expect(screen.getByRole('region', { name: 'Add a Villager unavailable' })).toBeVisible()
    expect(screen.queryByText('Dana Coleman')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    currentSession = { ...currentSession, persona: { parent: true, personId: 'p_dana' }, scope: { childId: 'p_jax', childName: 'Jax Coleman' } }
    view.rerender(<AddVillagerReview proposal={proposal} />)
    expect(screen.queryByText('Dana Coleman')).not.toBeInTheDocument()
    currentSession = { generation: 1, persona: { parent: true, personId: 'p_mom' }, scope: { childId: 'p_nora', childName: 'Nora Ellison' }, marks: { demoGuide: false } }
  })
  it.each([
    ['PROPOSAL_EXPIRED', /proposal expired/i], ['PROPOSAL_STALE', /proposal changed/i],
    ['UNAUTHORIZED', /cannot confirm/i], ['UNAUTHENTICATED', /session ended/i],
  ])('handles %s with no success', async (code, message) => {
    const confirm = vi.fn().mockRejectedValue({ errors: [{ extensions: { code } }] })
    render(<ReviewCard proposal={proposal} childName="Nora" canConfirm mode="live" confirm={confirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Add a Villager' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByText(/Villager added/)).not.toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(1)
  })
  it('retries the same version after an uncertain result and mock retries return the same object', async () => {
    const confirm = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(result)
    render(<ReviewCard proposal={proposal} childName="Nora" canConfirm mode="live" confirm={confirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Add a Villager' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Retry this same proposal')
    fireEvent.click(screen.getByRole('button', { name: 'Retry same proposal' }))
    expect(await screen.findByText(/Villager added/)).toBeVisible()
    expect(confirm.mock.calls.map(call => call[0])).toEqual([proposal, proposal])
    const mock = createMockAddVillagerConfirm()
    expect(await mock(proposal)).toBe(await mock(proposal))
  })
  it('discards a late response after persona or child switches', async () => {
    let resolve!: (value: AddVillagerResult) => void
    let signal: AbortSignal | undefined
    const confirm = vi.fn((_proposal: AddVillagerProposal, received?: AbortSignal) => {
      signal = received
      return new Promise<AddVillagerResult>(done => { resolve = done })
    })
    const view = render(<AddVillagerReview proposal={proposal} confirm={confirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Add a Villager' }))
    generation = 2
    selectedChild = 'p_jax'
    currentSession = { generation: 2, persona: { parent: false, personId: 'p_priya' }, scope: { childId: 'p_jax', childName: 'Jax Coleman' }, marks: { demoGuide: false } }
    view.rerender(<AddVillagerReview proposal={proposal} confirm={confirm} />)
    expect(signal?.aborted).toBe(true)
    await act(async () => resolve(result))
    expect(screen.queryByText(/Villager added|Sample reviewed/)).not.toBeInTheDocument()
    generation = 1
    selectedChild = 'p_nora'
    currentSession = { generation: 1, persona: { parent: true, personId: 'p_mom' }, scope: { childId: 'p_nora', childName: 'Nora Ellison' }, marks: { demoGuide: false } }
  })
  it('validates structured proposals and confirms through Apollo with only id and version', async () => {
    expect(parseAddVillagerProposal({ ...proposal, scopes: ['careplan.read'] })).toBeNull()
    expect(parseAddVillagerProposal(proposal)).toEqual(proposal)
    expect(addVillagerError({ errors: [{ extensions: { code: 'PROPOSAL_STALE' } }] })).toBe('stale')
    const mutate = vi.fn().mockResolvedValue({ data: { confirmAddVillager: result } })
    const confirm = createLiveAddVillagerConfirm({ mutate } as never)
    await expect(confirm(proposal)).resolves.toEqual(result)
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ variables: { proposalId: proposal.id, version: proposal.version }, fetchPolicy: 'no-cache' }))
    expect(mutate.mock.calls[0][0].mutation.definitions[0].name.value).toBe('WebConfirmAddVillager')
  })
})
