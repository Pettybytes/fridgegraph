import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { StoredRun } from '@/lib/frontendData/deliveredAdapter'
import { localDay, weekday } from '@/features/calendar/time'
import { jobCreatedAt, recordedJobStatus } from './model'

export type PulseTarget = { kind: 'requests' | 'contact' | 'status' | 'weekday' | 'approval' | 'pending' | 'orbit' | 'open'; value?: string; from?: string; through?: string }
export type SelectPulse = (target: PulseTarget, label: string) => void
export function pulseAction(target: PulseTarget, label: string, select?: SelectPulse) {
  return {
    'data-pulse-action': JSON.stringify(target),
    'aria-label': `View ${label} records`,
    onClick: () => select?.(target, label),
    onKeyDown: (event: KeyboardEvent<SVGElement>) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select?.(target, label) }
    },
    role: 'button', tabIndex: 0,
  }
}
export function selectRuns(runs: StoredRun[], target: PulseTarget): StoredRun[] {
  const byId = new Map<string, StoredRun>()
  for (const run of runs) if (run.job.type === 'PICKUP' && !byId.has(run.job.id)) byId.set(run.job.id, run)
  const unique = [...byId.values()]
  return unique.filter(run => {
    const created = jobCreatedAt(run), day = created ? localDay(created) : null
    if ((target.from || target.through) && (!day || (target.from && day < target.from) || (target.through && day > target.through))) return false
    switch (target.kind) {
      case 'contact': return run.attempts.some(attempt => Number.isFinite(Date.parse(attempt.at))) === (target.value === 'recorded')
      case 'status': return recordedJobStatus(run.job.status, Boolean(run.job.confirmation?.id)) === target.value
      case 'weekday': return Boolean(day && (weekday(day) + 6) % 7 === Number(target.value))
      case 'approval': return target.value === 'approved' ? Boolean(run.job.confirmation?.id) : target.value === 'pending' ? run.job.status === 'awaiting_approval' && !run.job.confirmation?.id : Boolean(run.job.confirmation?.id) || run.job.status === 'awaiting_approval'
      case 'pending': case 'open': return run.job.status === 'awaiting_approval' && !run.job.confirmation?.id
      case 'orbit': return false
      default: return true
    }
  }).sort((a, b) => (Date.parse(jobCreatedAt(b) ?? '') || 0) - (Date.parse(jobCreatedAt(a) ?? '') || 0))
}
export type PulseSelection = { kind: PulseTarget['kind']; label: string; runs: StoredRun[]; orbit: { alertId: string; status: string } | null; from?: string; through?: string }
const momentLabel: Record<string, string> = { JOB_CREATED: 'Pickup request recorded', ATTEMPT_OPENED: 'Contact attempt recorded', ATTEMPT_CLOSED: 'Contact attempt ended', COST_CALCULATED: 'Travel estimate recorded', CONFIRMATION: 'Parent approval recorded' }
const timestamp = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Detroit', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Timestamp not recorded'
export function PulseRecords({ selection, back }: { selection: PulseSelection; back: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  const count = selection.runs.length + (selection.orbit ? 1 : 0)
  return <section className="vp-records" role="region" aria-label="Selected pulse records">
    <button className="vp-back" type="button" onClick={back}>Back to Village pulse</button>
    <h3 tabIndex={-1} ref={heading}>{selection.label}</h3>
    <p>{count} {count === 1 ? 'record' : 'records'} · America/Detroit · {selection.from ? `${selection.from} to ${selection.through}` : 'Current visible records'}</p>
    <p>Fictional demo records. Contact attempts do not prove delivery. Parent approval does not confirm pickup.</p>
    {!count && <p>No recorded item matches this selection.</p>}
    <div className="vp-record-list">{selection.runs.map(run => <details key={run.job.id} data-testid="pulse-record" data-pulse-record-id={run.job.id}>
      <summary><span>{run.job.id}</span><strong>{recordedJobStatus(run.job.status, Boolean(run.job.confirmation?.id))}</strong><span>{jobCreatedAt(run) ? timestamp(jobCreatedAt(run)!) : 'Creation time not recorded'}</span></summary>
      <section role="region" aria-label={`Timeline for ${run.job.id}`}>
        <p>{run.attempts.length} recorded contact {run.attempts.length === 1 ? 'attempt' : 'attempts'} · {run.job.confirmation?.id ? `Confirmation ${run.job.confirmation.id}` : 'No parent confirmation recorded'}</p>
        {run.timeline.length ? <ol>{[...run.timeline].sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0)).map((moment, index) => <li key={`${moment.at}-${index}`}><time>{timestamp(moment.at)}</time><strong data-pulse-moment-kind={moment.kind}>{momentLabel[moment.kind] ?? 'Recorded activity'}</strong>{moment.candidate && <span>{moment.candidate.displayName}</span>}{moment.detail && <span>{moment.detail}</span>}</li>)}</ol> : <p>No recorded timeline is available.</p>}
      </section>
    </details>)}
    {selection.orbit && <article data-testid="pulse-record" data-pulse-record-id={selection.orbit.alertId}><h4>Latest visible Orbit alert</h4><p>{selection.orbit.alertId}</p><p>{selection.orbit.status}</p><p>This read exposes the alert identifier and status. No alert timeline is included.</p></article>}
    </div>
  </section>
}
