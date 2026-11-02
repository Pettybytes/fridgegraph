import { addDays, localDay } from '@/features/calendar/time'
import type { StoredRun } from '@/lib/frontendData/deliveredAdapter'

export type PulseWindow = { from: string; through: string }
export function pulseWindow(now: number): PulseWindow {
  const through = localDay(now)
  return { from: addDays(through, -29), through }
}

export function jobCreatedAt(run: StoredRun): string | null {
  const moment = run.timeline.find(entry => entry.kind === 'JOB_CREATED' && Number.isFinite(Date.parse(entry.at)))
  return moment?.at ?? null
}

export function pulseCohort(runs: StoredRun[], window: PulseWindow) {
  const unique = new Map<string, StoredRun>()
  for (const run of runs) {
    if (run.job.type !== 'PICKUP') continue
    const createdAt = jobCreatedAt(run)
    if (!createdAt) continue
    const day = localDay(createdAt)
    if (day >= window.from && day <= window.through && !unique.has(run.job.id)) unique.set(run.job.id, run)
  }
  const jobs = [...unique.values()].sort((a, b) => Date.parse(jobCreatedAt(b)!) - Date.parse(jobCreatedAt(a)!))
  return {
    jobs,
    requests: jobs.length,
    withOutreach: jobs.filter(run => run.attempts.some(attempt => Number.isFinite(Date.parse(attempt.at)))).length,
    withParentApproval: jobs.filter(run => Boolean(run.job.confirmation?.id)).length,
    undated: new Set(runs.filter(run => run.job.type === 'PICKUP' && !jobCreatedAt(run)).map(run => run.job.id)).size,
  }
}

export function recordedJobStatus(status: string): string {
  return ({
    pending: 'Request recorded',
    discovering: 'Outreach in progress',
    awaiting_approval: 'Waiting for parent approval',
    confirmed: 'Parent approval recorded',
    failed: 'Coordination ended',
  } as Record<string, string>)[status] ?? 'Recorded status not recognized'
}
