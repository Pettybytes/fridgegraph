import { describe, expect, it } from 'vitest'
import { demoScope } from '@/lib/frontendData/mockAdapter'
import { createPickupDemoAdapter } from './demoAdapter'
describe('recorded pickup replay', () => {
  it('shows no approval fact before the parent reviews the recorded decision', async () => {
    const data = await createPickupDemoAdapter().readMissionControl(demoScope)
    expect(data.coordinationJobs).toEqual([{ id: 'job_01HXYZ', status: 'awaiting_approval', version: 3 }])
    expect(data.confirmations).toEqual([])
    expect(data.events.some(event => event.kind === 'confirmation')).toBe(false)
  })
  it('replays the exact recorded confirmation after the versioned approval action', async () => {
    const adapter = createPickupDemoAdapter()
    await adapter.approvePickup!(demoScope, { jobId: 'job_01HXYZ', version: 3, decision: 'APPROVED' })
    const data = await adapter.readMissionControl(demoScope)
    expect(data.confirmations?.[0]).toMatchObject({ id: 'conf_0003', candidate: { id: 'p_tasha' }, approvedBy: { id: 'p_mom' }, receivedAt: '2026-10-28T15:14:00Z' })
    expect(data.coordinationJobs?.[0]).toMatchObject({ status: 'confirmed', version: 4 })
    await expect(adapter.approvePickup!(demoScope, { jobId: 'job_01HXYZ', version: 3, decision: 'APPROVED' })).rejects.toThrow('changed')
  })
  it('does not treat a decline, a wrong scope or a stale version as approval', async () => {
    const adapter = createPickupDemoAdapter()
    await expect(adapter.approvePickup!(demoScope, { jobId: 'job_01HXYZ', version: 2, decision: 'APPROVED' })).rejects.toThrow('changed')
    await expect(adapter.approvePickup!(demoScope, { jobId: 'job_01HXYZ', version: 3, decision: 'DECLINED' })).rejects.toThrow('only contains')
    await expect(adapter.approvePickup!({ ...demoScope, childId: 'other' }, { jobId: 'job_01HXYZ', version: 3, decision: 'APPROVED' })).rejects.toThrow('UNAUTHORIZED')
    expect((await adapter.readMissionControl(demoScope)).confirmations).toEqual([])
  })
})
