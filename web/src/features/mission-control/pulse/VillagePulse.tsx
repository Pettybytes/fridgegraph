import { useEffect, useState } from 'react'
import { useSession } from '@/features/personas/Session'
import { useOrbit, useOrbitState } from '@/features/orbit/runtime'
import type { OrbitController } from '@/features/orbit/controller'
import type { StoredMissionControl, StoredRun } from '@/lib/frontendData/deliveredAdapter'
import { formatDay, localDay } from '@/features/calendar/time'
import { Surface } from '@/components/fg/primitives'
import { jobCreatedAt, pulseCohort, pulseWindow, recordedJobStatus } from './model'
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

/** All quantities come from caller-visible, recorded rows. This view makes no read or mutation. */
export function VillagePulseView({ jobs, orbit, now, sourceLabel = 'Stored demo records visible to this perspective' }: PulseProps) {
  const window = pulseWindow(now)
  const label = `${formatDay(window.from)} ${window.from.slice(0, 4)} – ${formatDay(window.through)} ${window.through.slice(0, 4)}`
  const cohort = jobs.kind === 'ready' ? pulseCohort(jobs.value, window) : null
  const pending = jobs.kind === 'ready' ? jobs.value.filter(run => run.job.type === 'PICKUP' && run.job.status === 'awaiting_approval') : []
  const activeOrbit = orbit.kind === 'ready' && orbit.value.status === 'ACTIVE'
  return <section className="vp" aria-label="Village pulse">
    <header className="vp-heading"><h2>Village pulse</h2><p>{sourceLabel}. Requests created {label} (America/Detroit). Current open items are shown separately.</p></header>
    <div className="vp-grid">
      <Surface className="vp-panel" role="region" aria-label="Coverage"><h3>Coverage</h3>
        <ReadBoundary state={jobs} subject="request records" />
        {jobs.kind === 'ready' && <>
          <p>Coverage classification unavailable: these reads do not connect each care requirement to an explicit outcome. A calendar gap or an unanswered request remains unknown.</p>
          <h4>Requests recorded in this window</h4>
          {!cohort?.jobs.length ? <p className="vp-empty">No dated pickup requests are available in this window.</p> : <ul className="vp-requests">{cohort.jobs.map(run => <li key={run.job.id}><span><time dateTime={jobCreatedAt(run)!}>{formatDay(localDay(jobCreatedAt(run)!))}</time> · {recordedJobStatus(run.job.status)}</span><a href="#/mission-control">Open Mission Control</a></li>)}</ul>}
          {!!cohort?.undated && <p>{cohort.undated} visible request {cohort.undated === 1 ? 'has' : 'have'} no recorded creation time and cannot enter this dated view.</p>}
        </>}
      </Surface>

      <Surface className="vp-panel" role="region" aria-label="Request funnel"><h3>Request funnel</h3>
        <ReadBoundary state={jobs} subject="request records" />
        {jobs.kind === 'ready' && (cohort?.jobs.length ? <>
          <p>Distinct jobs created {label}. These counts describe recorded stages independently; they do not verify a completed pickup.</p>
          <dl className="vp-counts"><div><dt>Requests recorded</dt><dd>{cohort.requests}</dd></div><div><dt>Jobs with outreach recorded</dt><dd>{cohort.withOutreach}</dd></div><div><dt>Jobs with parent approval recorded</dt><dd>{cohort.withParentApproval}</dd></div></dl>
          <p>Outreach is counted once per job, regardless of attempts. Parent approval is a recorded decision, not a confirmed pickup.</p>
        </> : <p className="vp-empty">No dated pickup requests are available in this window.</p>)}
      </Surface>

      <Surface className="vp-panel" role="region" aria-label="Response time"><h3>Response time</h3>
        <ReadBoundary state={jobs} subject="request records" />
        {jobs.kind === 'ready' && (cohort?.jobs.length ? <><p>Response duration is unavailable for requests created {label}. The read has dispatch times, but no matching caregiver response timestamps.</p><p>Sample size: unavailable. Attempt endings, timeouts and parent approval times are excluded. No caregiver comparison is calculated.</p></> : <p className="vp-empty">No dated pickup requests are available in this window.</p>)}
      </Surface>

      <Surface className="vp-panel" role="region" aria-label="Open items"><h3>Open items</h3>
        <p>Current caller-visible pending approvals and the latest visible Orbit status. No alert details are repeated here.</p>
        <ReadBoundary state={jobs} subject="approval records" />
        {jobs.kind === 'ready' && pending.length > 0 && <ul className="vp-open">{pending.map(run => <li key={run.job.id}>Parent approval pending <a href="#/mission-control">Open Mission Control</a></li>)}</ul>}
        <ReadBoundary state={orbit} subject="Orbit status" />
        {activeOrbit && <p className="vp-open">Orbit alert active. <a href="#/orbit">Open Orbit</a></p>}
        {jobs.kind === 'ready' && !pending.length && orbit.kind === 'ready' && !activeOrbit && <p className="vp-empty">No records are available to this view. The Orbit read covers the latest visible alert only.</p>}
      </Surface>
    </div>
  </section>
}

function OrbitPulse({ controller, jobs, now }: { controller: OrbitController; jobs: PulseRead<StoredRun[]>; now: number }) {
  const state = useOrbitState(controller)
  const orbit: PulseRead<PulseOrbit> = state.phase === 'loading' ? { kind: 'loading' }
    : state.phase === 'unavailable' ? { kind: /not shared|unauthorized/i.test(state.error) ? 'refused' : 'failed' }
      : { kind: 'ready', value: { alertId: state.status?.alertId ?? null, status: state.status?.status ?? null } }
  return <VillagePulseView jobs={jobs} orbit={orbit} now={now} />
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
