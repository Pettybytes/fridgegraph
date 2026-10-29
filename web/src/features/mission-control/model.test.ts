import { describe, expect, it } from 'vitest'
import { createMockAdapter, demoScope } from '@/lib/frontendData/mockAdapter'
import { buildMissionControlView } from './model'
describe('recorded Mission Control view', () => {
  it('orders recorded events by timestamp and preserves all caregiver alternatives', async () => {
    const data = await createMockAdapter().readMissionControl(demoScope)
    const view = buildMissionControlView(data)
    expect(view.timeline.map(event => event.id)).toEqual(['mc_0001', 'mc_0002', 'mc_0003', 'mc_0005', 'mc_0004', 'mc_0006', 'mc_0007', 'mc_0008'])
    expect(view.candidates).toHaveLength(4)
    expect(view.candidates.find(person => person.id === 'p_gma')).toMatchObject({ reasonCode: 'OVER_POLICY', statusLabel: 'Over your travel limit', estimatedRideCostUsd: 12.4 })
    expect(data.events[3].id).toBe('mc_0004')
  })
  it('keeps the recorded recommendation distinct from parent approval', async () => {
    const view = buildMissionControlView(await createMockAdapter().readMissionControl(demoScope))
    expect(view.recommendation).toMatchObject({ id: 'p_tasha', reasonCode: 'APPROVAL_PENDING', statusLabel: 'Awaiting parent approval' })
    expect(view.activityTrace.map(event => event.kind)).not.toContain('simulated_tracking')
  })
  it('does not recommend a caregiver whose outreach is still pending', async () => {
    const data = await createMockAdapter().readMissionControl(demoScope)
    const tasha = data.candidates.find(person => person.id === 'p_tasha')!
    tasha.reasonCode = 'PENDING'
    const view = buildMissionControlView(data)
    expect(view.recommendation).toBeNull()
    expect(view.candidates.find(person => person.id === 'p_tasha')?.statusLabel).toBe('Waiting for reply')
  })
})
