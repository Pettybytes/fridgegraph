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
    expect(dataErrorMessage(new Error('UNAUTHENTICATED'))).toBe('Sign in again to continue.')
    expect(dataErrorMessage(new Error('UNAUTHORIZED'))).toBe("You don't have access to this.")
    expect(dataErrorMessage(new Error('network'))).toBe('Unable to load updates. Try again.')
  })
  it('uses synthetic estimated travel cost for every caregiver', async () => {
    const { candidates } = await createMockAdapter().readMissionControl(demoScope)
    expect(TRAVEL_COST_LABEL).toBe('Estimated travel cost')
    expect(reasonLabel('OVER_POLICY')).toBe('Over your travel limit')
    for (const candidate of candidates) {
      expect(candidate.estimatedRideCostUsd).toBeCloseTo(candidate.distanceMiles * 1.40, 2)
      expect(candidate.costBasis).toBe('Synthetic estimated travel cost: straight-line distance × $1.40/mile for every caregiver, including drivers')
      expect(candidate).not.toHaveProperty('estimatedTravelCostUsd')
    }
    expect(JSON.stringify(await createMockAdapter().readParentChat(demoScope))).not.toMatch(/ride.cost|ride fare|Uber|spend/i)
  })
  it('polls within the approved demo interval', () => { expect(POLL_INTERVAL_MS).toBe(2500) })
})
