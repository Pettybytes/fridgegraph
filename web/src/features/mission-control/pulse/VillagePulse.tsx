import { useEffect, useState } from 'react'
import { useSession } from '@/features/personas/Session'
import { useOrbit, useOrbitState } from '@/features/orbit/runtime'
import type { OrbitController } from '@/features/orbit/controller'
import type { StoredMissionControl, StoredRun } from '@/lib/frontendData/deliveredAdapter'
import { formatDay, localDay } from '@/features/calendar/time'
import { Icon, Surface } from '@/components/fg/primitives'
import { jobCreatedAt, pulseCohort, pulseWindow, recordedJobStatus } from './model'
import { orbitPulseRead } from './orbitPulseRead'
import './village-pulse.css'

export type PulseRead<T> = { kind: 'loading' } | { kind: 'ready'; value: T } | { kind: 'refused' } | { kind: 'failed' }
export type PulseOrbit = { alertId: string | null; status: string | null }
type PulseProps = { jobs: PulseRead<StoredRun[]>; orbit: PulseRead<PulseOrbit>; now: number; sourceLabel?: string }

function ReadBoundary({ state, subject }: { state: PulseRead<unknown>; subject: string }) {
  if (state.kind === 'loading') return <p role="status">Loading {subject}…</p>
  if (state.kind === 'refused') return <p role="alert">Access to {subject} is refused for this perspective.</p>
  if (state.kind === 'failed') return <p role="alert">Couldn’t load {subject}. Try again later.</p>
  return null
}

function CalculationHelp() {
  return <details className="vp-help">
    <summary><Icon.info /><span>How this is calculated</span></summary>
    <div className="vp-help-content" role="note">
      <p><strong>Recent requests.</strong> Only visible pickup jobs with a recorded creation time in the last 30 America/Detroit calendar dates enter the dated list. Undated jobs are counted separately. These reads do not link care requirements to explicit outcomes, so they cannot classify coverage.</p>
      <p><strong>Recorded counts.</strong> Each bar counts distinct jobs from that same cohort. A job counts once if it has a recorded contact attempt, and once if it has a parent approval confirmation. Attempt time does not prove delivery or response; approval does not confirm pickup.</p>
      <p><strong>Response time.</strong> No matching caregiver response timestamp is exposed. Attempt endings, timeouts and parent approval times cannot supply one, so no duration or sample is calculated.</p>
      <p><strong>Open items.</strong> Pending approvals use current visible pickup job status. Orbit shows only the latest visible alert’s status. A failed or refused read has no current count, even when an older status remains cached.</p>
    </div>
  </details>
}

/** All quantities come from caller-visible, recorded rows. This view makes no read or mutation. */
export function VillagePulseView({ jobs, orbit, now, sourceLabel = 'Stored demo records visible to this perspective' }: PulseProps) {
  const window = pulseWindow(now)
  const label = `${formatDay(window.from)} ${window.from.slice(0, 4)} – ${formatDay(window.through)} ${window.through.slice(0, 4)}`
  const cohort = jobs.kind === 'ready' ? pulseCohort(jobs.value, window) : null
  const pending = jobs.kind === 'ready' ? jobs.value.filter(run => run.job.type === 'PICKUP' && run.job.status === 'awaiting_approval') : []
  const activeOrbit = orbit.kind === 'ready' && orbit.value.status === 'ACTIVE'
  const counts = cohort ? [
    { label: 'Requests recorded', value: cohort.requests },
    { label: 'Jobs with contact attempts recorded', value: cohort.withContactAttempts },
    { label: 'Jobs with parent approval recorded', value: cohort.withParentApproval },
  ] : []
  return <section className="vp" aria-label="Village pulse">
    <header className="vp-heading"><div><h2>Village pulse</h2><p>{sourceLabel}. Pickup requests created {label} (America/Detroit).</p></div><CalculationHelp /></header>
    <div className="vp-grid">
      <Surface className="vp-panel" role="region" aria-label="Recent pickup requests"><h3>Recent pickup requests</h3>
        <ReadBoundary state={jobs} subject="request records" />
        {jobs.kind === 'ready' && <>
          <p>Recorded creation dates and current request statuses.</p>
          {!cohort?.jobs.length ? <p className="vp-empty">No dated pickup requests are available in this window.</p> : <>
            <ul className="vp-requests">{cohort.jobs.slice(0, 5).map(run => <li key={run.job.id}><time dateTime={jobCreatedAt(run)!}>{formatDay(localDay(jobCreatedAt(run)!))}</time><span>{recordedJobStatus(run.job.status)}</span></li>)}</ul>
            {cohort.jobs.length > 5 && <p>{cohort.jobs.length - 5} more dated {cohort.jobs.length - 5 === 1 ? 'request' : 'requests'} in this window.</p>}
            <a href="#/mission-control">Open Mission Control</a>
          </>}
          {!!cohort?.undated && <p>{cohort.undated} visible pickup {cohort.undated === 1 ? 'request has' : 'requests have'} no recorded creation time and cannot enter this dated list.</p>}
        </>}
      </Surface>

      <Surface className="vp-panel" role="region" aria-label="Recorded request counts"><h3>Recorded request counts</h3>
        <ReadBoundary state={jobs} subject="request records" />
        {jobs.kind === 'ready' && (cohort?.jobs.length ? <>
          <p>Independent counts of distinct pickup jobs in this window.</p>
          <dl className="vp-counts">{counts.map(metric => <div key={metric.label}><div className="vp-count-head"><dt>{metric.label}</dt><dd>{metric.value}</dd></div><svg viewBox="0 0 100 9" preserveAspectRatio="none" role="img" aria-label={`${metric.label}: ${metric.value} of ${cohort.requests} jobs`}><rect className="vp-bar-track" x="0" y="0" width="100" height="9" rx="4.5"/><rect className="vp-bar-fill" x="0" y="0" width={metric.value / cohort.requests * 100} height="9" rx="4.5"/></svg></div>)}</dl>
          <p>Attempts do not prove delivery or response; approval does not confirm pickup.</p>
        </> : <p className="vp-empty">No dated pickup requests are available in this window.</p>)}
      </Surface>

      <Surface className="vp-panel vp-panel-open" role="region" aria-label="Open items"><h3>Open items</h3>
        <p>Current pending approvals; Orbit covers the latest visible alert only.</p>
        <div className="vp-tiles"><div className="vp-tile"><span>Pending parent approvals</span><ReadBoundary state={jobs} subject="approval records" />{jobs.kind === 'ready' && <><strong>{pending.length}</strong><a href="#/mission-control">Mission Control</a></>}</div>
          <div className="vp-tile"><span>Latest visible active Orbit alert</span><ReadBoundary state={orbit} subject="Orbit status" />{orbit.kind === 'ready' && <><strong>{activeOrbit ? 1 : 0}</strong><a href="#/orbit">Orbit</a></>}</div></div>
        {jobs.kind === 'ready' && !pending.length && orbit.kind === 'ready' && !activeOrbit && <p className="vp-empty">No current open item is available in these reads.</p>}
      </Surface>
    </div>
  </section>
}

function OrbitPulse({ controller, jobs, now }: { controller: OrbitController; jobs: PulseRead<StoredRun[]>; now: number }) {
  const state = useOrbitState(controller)
  return <VillagePulseView jobs={jobs} orbit={orbitPulseRead(state)} now={now} />
}

export function VillagePulse({ result }: { result: { loading: boolean; error?: { message: string }; data?: { frontendSnapshot: StoredMissionControl } } }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer) }, [])
  const { session } = useSession()
  const controller = useOrbit()
  const parent = Boolean(session && (session.persona.parent || session.persona.guardian) && !session.marks?.demoGuide)
  const jobs: PulseRead<StoredRun[]> = !parent ? { kind: 'refused' }
    : result.loading && !result.data ? { kind: 'loading' }
      : result.error ? { kind: /UNAUTHORIZED|UNAUTHENTICATED|AUTH_ERROR/.test(result.error.message) ? 'refused' : 'failed' }
        : result.data ? { kind: 'ready', value: result.data.frontendSnapshot.recordedRuns } : { kind: 'failed' }
  if (!parent) return <VillagePulseView jobs={jobs} orbit={{ kind: 'refused' }} now={now} />
  if (!controller) return <VillagePulseView jobs={jobs} orbit={{ kind: 'failed' }} now={now} />
  return <OrbitPulse controller={controller} jobs={jobs} now={now} />
}
