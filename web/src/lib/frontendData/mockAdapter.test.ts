import { describe, expect, it } from 'vitest'
import { createMockAdapter, demoScope } from './mockAdapter'
import { reasonLabel, TRAVEL_COST_LABEL } from './types'
import { dataErrorMessage, POLL_INTERVAL_MS } from './provider'
describe('shared adapter', () => {
  it('reads all four real-seed caregivers', async () => {
    const data = await createMockAdapter().readMissionControl(demoScope)
    expect(data.candidates.map(person => person.name)).toEqual(['Loretta Brooks', 'Bryan Brooks', 'Tasha Ellison', 'Monique Davis'])
  })
  it('does not expose coordinates, addresses, or contact values', async () => {
    const data = JSON.stringify(await createMockAdapter().readMissionControl(demoScope))
    expect(data).not.toMatch(/"(?:lat|lng|origin|address|contactMethods)"/)
  })
  it('rejects a different child scope', async () => {
    await expect(createMockAdapter().readParentChat({ ...demoScope, childId: 'other' })).rejects.toThrow('UNAUTHORIZED')
  })
  it('returns isolated snapshots', async () => {
    const adapter = createMockAdapter()
    const first = await adapter.readMissionControl(demoScope)
    first.events.pop()
    expect((await adapter.readMissionControl(demoScope)).events).toHaveLength(8)
  })
  it('orders the chat by recorded timestamps', async () => {
    const data = await createMockAdapter().readParentChat(demoScope)
    expect(data.messages.map(message => message.id)).toEqual(['msg_0001', 'msg_0002', 'msg_0005', 'msg_0003', 'msg_0004', 'msg_0006', 'msg_0007'])
  })
  it('keeps waiting for outreach distinct from approval', () => {
    expect(reasonLabel('PENDING')).toBe('Waiting for reply')
    expect(reasonLabel('APPROVAL_PENDING')).toBe('Awaiting parent approval')
  })
  it('distinguishes authentication, authorization and network errors', () => {
    expect(dataErrorMessage(new Error('UNAUTHENTICATED'))).toBe('Your perspective needs a fresh session. Please try again in a moment.')
    expect(dataErrorMessage(new Error('UNAUTHORIZED'))).toBe("You don't have access to this.")
    expect(dataErrorMessage(new Error('network'))).toBe('Unable to load updates. Try again.')
  })
  it('never costs a driver and costs only an explicit paid-ride path', async () => {
    // pickup-job.md §6a: no driver is ever costed; normal night has a driver.
    const { candidates } = await createMockAdapter().readMissionControl(demoScope)
    expect(TRAVEL_COST_LABEL).toBe('Estimated travel cost')
    for (const candidate of candidates) {
      expect(candidate.estimatedRideCostUsd).toBeNull()
      expect(candidate.costBasis).toBeNull()
    }
    expect(candidates.find(candidate => candidate.id === 'p_gma')?.reasonCode).toBe('AVAILABLE_NO_TRANSPORT')
  })
  it('polls within the approved demo interval', () => { expect(POLL_INTERVAL_MS).toBe(2500) })
})
