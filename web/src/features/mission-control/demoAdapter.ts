import { createMockAdapter } from '@/lib/frontendData/mockAdapter'
import type { Confirmation, FrontendAdapter, MissionControlData } from '@/lib/frontendData/types'

// Replay only the approval fact recorded in pickup-job-lifecycle.json. No network or outreach.
export function createPickupDemoAdapter(): FrontendAdapter {
  const base = createMockAdapter()
  let approved = false
  const confirmation: Confirmation = {
    id: 'conf_0003', job: { id: 'job_01HXYZ' }, receivedAt: '2026-10-28T15:14:00Z',
    candidate: { id: 'p_tasha', displayName: 'Tasha Ellison' },
    approvedBy: { id: 'p_mom', displayName: 'Kendra Ellison' }, overLimitApproved: false,
  }
  async function snapshot(scope: Parameters<FrontendAdapter['readMissionControl']>[0]): Promise<MissionControlData> {
    const data = await base.readMissionControl(scope)
    const events = data.events.filter(event => approved || event.job.version <= 3)
    const job = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]?.job
    return { ...data, events, coordinationJobs: job ? [{ id: job.id, status: job.status, version: job.version }] : [], confirmations: approved ? [structuredClone(confirmation)] : [] }
  }
  return {
    ...base,
    readMissionControl: snapshot,
    async approvePickup(scope, input) {
      const data = await snapshot(scope)
      const job = data.coordinationJobs?.find(job => job.id === input.jobId)
      if (!job || job.version !== input.version) throw new Error('This pickup changed. Refresh and review it again.')
      if (input.decision !== 'APPROVED' || job.status !== 'awaiting_approval') throw new Error('This recorded scenario only contains the approved decision.')
      approved = true
      return { id: job.id, status: 'confirmed', version: 4 }
    },
  }
}
