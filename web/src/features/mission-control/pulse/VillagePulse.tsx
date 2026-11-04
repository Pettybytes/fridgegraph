import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import { Sprout, Activity, Gauge, ChartPie, ChartColumn, ClipboardCheck, BellRing, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useSession } from '@/features/personas/Session'
import { useOrbit, useOrbitState } from '@/features/orbit/runtime'
import type { OrbitController } from '@/features/orbit/controller'
import type { StoredMissionControl, StoredRun } from '@/lib/frontendData/deliveredAdapter'
import { formatDay, formatTime } from '@/features/calendar/time'
import { approvalBreakdown, dailyCurrentStatuses, pulseCohort, pulseWindow, requestsByWeekday, statusOrder } from './model'
import { ApprovalDonut, ContactGauge, CountUp, RequestsStream, StatusDonut, WeekdayBars } from './PulseVisuals'
import { PulseRecords, selectRuns, type PulseSelection, type SelectPulse } from './records'
import { orbitPulseRead } from './orbitPulseRead'
import type { CardType } from '@/components/fg/cards'
import '@/components/fg/cards.css'
import './village-pulse.css'

// The one sky backdrop, self-hosted under web/public (same image app-wide for continuity).
const backdrop640 = '/sky-backdrop-640.webp'
const backdrop1280 = '/sky-backdrop-1280.webp'
const backdrop2000 = '/sky-backdrop-2000.webp'

export type PulseRead<T> = { kind: 'loading' } | { kind: 'ready'; value: T } | { kind: 'refused' } | { kind: 'failed' }
export type PulseOrbit = { alertId: string | null; status: string | null }
type PulseProps = { jobs: PulseRead<StoredRun[]>; orbit: PulseRead<PulseOrbit>; now: number; readAt?: number | null }

function ReadBoundary({ state, subject }: { state: PulseRead<unknown>; subject: string }) {
  if (state.kind === 'loading') return <p role="status">Loading {subject}…</p>
  if (state.kind === 'refused') return <p role="alert">Access to {subject} is refused for this perspective.</p>
  if (state.kind === 'failed') return <p role="alert">Couldn’t load {subject}. Try again later.</p>
  return null
}

function CalculationHelp({ from, through }: { from: string; through: string }) {
  return <details className="vp-help"><summary><Info size={16} aria-hidden="true"/><span>How this is calculated</span></summary><div className="vp-help-content" role="note">
    <p><strong>Window and scope.</strong> {formatDay(from)} – {formatDay(through)} {through.slice(0, 4)}, America/Detroit. These are pickup jobs visible to this signed-in perspective. A request with no recorded creation time is excluded from dated charts. No number represents the whole village.</p>
    <p><strong>Requests over 30 days.</strong> The stream groups those dates into six five-day bins. Each job is colored by its <em>current recorded status</em>; the stream does not reconstruct historical status transitions. A smooth curve only connects recorded bin totals. Read the daily table for exact counts.</p>
    <p><strong>Contact coverage and weekday bars.</strong> The gauge counts distinct jobs with at least one recorded contact attempt, divided by distinct requests. An attempt is not proof of delivery or response, and the gauge has no target. Weekdays are Detroit creation dates from the same cohort.</p>
    <p><strong>Status mix and parent approvals.</strong> Status mix counts current recorded job statuses. Parent approval counts jobs with an explicit confirmation record; pending counts jobs currently awaiting parent approval without one. Other jobs are outside that approval ring. Parent approval does not confirm pickup.</p>
    <p><strong>Open items.</strong> Pending approvals use current visible pickup-job status, independent of the 30-day chart window. Orbit shows only the latest visible alert’s status. A failed or refused Orbit read has no current count, even when an older status remains cached. No alert payload appears here.</p>
    <p><strong>Not calculated.</strong> No matching caregiver response timestamp or proposal calculation contract is exposed. Response duration and proposal metrics remain absent.</p>
  </div></details>
}

function PulseTile({ label, name, icon: Icon, type, span2 = false, delay = 0, still, onOpen, children }: { label: string; name: string; icon: LucideIcon; type: CardType; span2?: boolean; delay?: number; still: boolean; onOpen?: () => void; children: React.ReactNode }) {
  return <motion.section className={`vp-tile${span2 ? ' vp-span2' : ''}`} data-fgc-type={type} role="region" aria-label={name} onClick={event => { if (onOpen && !(event.target as Element).closest('button,a,summary,details,svg,.vp-stream-wrap,.vp-donut-wrap,.vp-gauge-wrap,.vp-open-grid')) onOpen() }} initial={still ? false : { opacity: 0, y: 30, scale: .95 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={still ? { duration: 0 } : { duration: .6, delay: delay * .1, ease: [0.25, 0.46, 0.45, 0.94] }}>
    <span className="vp-tile-bar" aria-hidden="true"/>
    <div className="vp-tile-head"><h3>{onOpen ? <button type="button" onClick={onOpen} data-pulse-tile={name} aria-label={`View ${name} records`}>{label}</button> : label}</h3><span className="vp-icon-chip"><Icon size={16} aria-hidden="true"/></span></div>
    {children}
  </motion.section>
}

/** All quantities come from caller-visible recorded rows. This component makes no read or mutation. */
export function VillagePulseView({ jobs, orbit, now, readAt = null }: PulseProps) {
  const containerRef = useRef<HTMLElement>(null)
  const dashboardRef = useRef<HTMLDivElement>(null)
  const slides = useRef<(HTMLDivElement | null)[]>([])
  const touchStart = useRef(0)
  const [width, setWidth] = useState(() => typeof window === 'undefined' ? 1000 : window.innerWidth)
  const [page, setPage] = useState(0)
  const [panelHeight, setPanelHeight] = useState<number | null>(null)
  const [hovered, setHovered] = useState(false)
  const [selection, setSelection] = useState<PulseSelection | null>(null)
  const returnFocus = useRef<HTMLElement | SVGElement | null>(null)
  const reduce = useReducedMotion()
  const mobile = width < 600
  const still = mobile || Boolean(reduce)
  const smoothX = useSpring(0, { stiffness: 50, damping: 30 })
  const smoothY = useSpring(0, { stiffness: 50, damping: 30 })
  const { scrollYProgress } = useScroll({ target: dashboardRef, offset: ['start end', 'center center'] })
  const springConfig = { stiffness: 100, damping: 30, restDelta: .001 }
  const rotateX = useSpring(useTransform(scrollYProgress, [0, .5, 1], still ? [0, 0, 0] : [45, 15, 0]), springConfig)
  const scale = useSpring(useTransform(scrollYProgress, [0, .5, 1], still ? [1, 1, 1] : [.85, .95, 1]), springConfig)
  const y = useSpring(useTransform(scrollYProgress, [0, 1], still ? [0, 0] : [80, 0]), springConfig)
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const update = () => setWidth(element.getBoundingClientRect().width || window.innerWidth)
    update()
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', update); return () => window.removeEventListener('resize', update) }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!mobile) { setPanelHeight(null); return }
    const selected = slides.current[page]
    if (!selected) return
    const update = () => setPanelHeight(selected.getBoundingClientRect().height)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(selected)
    return () => observer.disconnect()
  }, [mobile, page, jobs, orbit])
  const moveBackground = (event: React.MouseEvent<HTMLElement>) => {
    if (still || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    smoothX.set(((event.clientX - rect.left) / rect.width - .5) * 150)
    smoothY.set(((event.clientY - rect.top) / rect.height - .5) * 60)
  }
  const range = pulseWindow(now)
  const cohort = jobs.kind === 'ready' ? pulseCohort(jobs.value, range) : null
  const dated = cohort?.jobs ?? []
  const days = cohort ? dailyCurrentStatuses(dated, range) : []
  const counts = Object.fromEntries(statusOrder.map(status => [status, days.reduce((sum, day) => sum + (day.counts[status] ?? 0), 0)]))
  const approvals = approvalBreakdown(dated)
  const pending = jobs.kind === 'ready' ? jobs.value.filter(run => run.job.type === 'PICKUP' && run.job.status === 'awaiting_approval' && !run.job.confirmation?.id) : []
  const pendingCount = new Set(pending.map(run => run.job.id)).size
  const activeOrbit = orbit.kind === 'ready' && orbit.value.status === 'ACTIVE'
  const select: SelectPulse = (target, label) => {
    returnFocus.current = document.activeElement as HTMLElement | SVGElement
    const current = target.kind === 'pending' || target.kind === 'open' || target.kind === 'orbit'
    const bounded = current ? target : { ...range, ...target }
    const latest = (target.kind === 'orbit' || target.kind === 'open') && activeOrbit && orbit.kind === 'ready' && orbit.value.alertId ? { alertId: orbit.value.alertId, status: orbit.value.status! } : null
    setSelection({ kind: target.kind, label, runs: jobs.kind === 'ready' ? selectRuns(jobs.value, bounded) : [], orbit: latest, from: bounded.from, through: bounded.through })
  }
  const back = () => { setSelection(null); requestAnimationFrame(() => returnFocus.current?.focus()) }
  const selectionAuthorized = !selection || ((selection.kind === 'orbit' || (jobs.kind === 'ready' && selection.runs.every(run => jobs.value.some(current => current.job.id === run.job.id)))) && (!['orbit', 'open'].includes(selection.kind) || (orbit.kind === 'ready' && (!selection.orbit || (orbit.value.alertId === selection.orbit.alertId && orbit.value.status === 'ACTIVE')))))
  useEffect(() => { if (!selectionAuthorized) setSelection(null) }, [selectionAuthorized])
  // Freeze the selected IDs, while respecting field-level changes in every authorized refresh.
  const currentRuns = jobs.kind === 'ready' ? new Map(jobs.value.map(run => [run.job.id, run])) : new Map<string, StoredRun>()
  const shownSelection = selectionAuthorized && selection ? { ...selection, runs: selection.runs.map(run => currentRuns.get(run.job.id)!) } : null
  const navNames = ['Requests and status', 'Weekdays and open items']
  const changePage = (next: number) => setPage(Math.max(0, Math.min(1, next)))
  const requestContent = (subject: string) => <>{jobs.kind !== 'ready' ? <ReadBoundary state={jobs} subject={subject}/> : !cohort?.jobs.length ? <p className="vp-empty">No dated pickup requests are available in this window.</p> : null}</>
  return <section ref={containerRef} className="vp" aria-label="Village pulse" onMouseMove={moveBackground} onMouseEnter={() => setHovered(true)} onMouseLeave={() => { setHovered(false); smoothX.set(0); smoothY.set(0) }}>
    {still ? <img className="vp-backdrop vp-backdrop-static" src={backdrop1280} srcSet={`${backdrop640} 640w, ${backdrop1280} 1280w, ${backdrop2000} 2000w`} sizes="100vw" alt="" aria-hidden="true"/> : <motion.div className="vp-backdrop vp-backdrop-moving" style={{ x: smoothX, y: smoothY }} animate={{ scale: hovered ? 1 : 1.03 }} transition={{ scale: { duration: 1.2, ease: 'easeOut' } }}><img src={backdrop2000} srcSet={`${backdrop640} 640w, ${backdrop1280} 1280w, ${backdrop2000} 2000w`} sizes="100vw" alt="" aria-hidden="true"/></motion.div>}
    <div className="vp-vignette" aria-hidden="true"/>
    <motion.div ref={dashboardRef} className="vp-dashboard" style={{ rotateX: still ? 0 : rotateX, scale: still ? 1 : scale, y: still ? 0 : y }}>
      <header className="vp-heading"><motion.div className="vp-mark" initial={still ? false : { scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }} transition={{ duration: .8, ease: 'easeOut' }}><Sprout size={25} aria-hidden="true"/></motion.div><div className="vp-heading-text"><h2>Village pulse</h2><p>Mission Control</p></div><span className="vp-update-pill">{readAt !== null && jobs.kind === 'ready' ? `Updated ${formatTime(readAt, false)}` : readAt !== null ? `Last read ${formatTime(readAt, false)} · refresh unavailable` : 'Update time not recorded'}</span></header>
      {shownSelection && <PulseRecords selection={shownSelection} back={back}/>}
      <div hidden={Boolean(shownSelection)} className="vp-overview">
      <div className="vp-context"><CalculationHelp from={range.from} through={range.through}/></div>
      <div className="vp-carousel" style={mobile && panelHeight ? { height: panelHeight } : undefined} onTouchStart={event => { touchStart.current = event.changedTouches[0].clientX }} onTouchEnd={event => { const delta = event.changedTouches[0].clientX - touchStart.current; if (mobile && Math.abs(delta) > 50) changePage(page + (delta < 0 ? 1 : -1)) }} onKeyDown={event => { if (!mobile || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); changePage(page + (event.key === 'ArrowRight' ? 1 : -1)) }}>
        <motion.div className="vp-grid" initial={false} animate={{ x: mobile ? `-${page * 50}%` : '0%' }} transition={still ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 }}>
          <div className="vp-slide" ref={node => { slides.current[0] = node }} inert={mobile && page !== 0} aria-hidden={mobile && page !== 0}>
            <PulseTile label="Requests over 30 days" name="Requests over 30 days" icon={Activity} type="pickup" span2 still={still} onOpen={cohort?.jobs.length ? () => select({ kind: 'requests' }, 'Requests over 30 days') : undefined}><div className="vp-tile-number">{cohort?.jobs.length ? <CountUp value={cohort.requests}/> : null}</div>{requestContent('request records')}{cohort?.jobs.length ? <RequestsStream days={days} select={select}/> : null}{!!cohort?.undated && <p className="vp-undated">{cohort.undated} visible pickup {cohort.undated === 1 ? 'request has' : 'requests have'} no recorded creation time.</p>}</PulseTile>
            <PulseTile label="Contact coverage" name="Contact coverage" icon={Gauge} type="pickup" still={still} delay={1} onOpen={cohort?.jobs.length ? () => select({ kind: 'contact', value: 'recorded' }, 'Contact coverage') : undefined}>{requestContent('request records')}{cohort?.jobs.length ? <><ContactGauge contacted={cohort.withContactAttempts} total={cohort.requests} select={select}/><p className="vp-tile-subtitle">Jobs with a contact attempt recorded</p></> : null}</PulseTile>
            <PulseTile label="Status mix" name="Status mix" icon={ChartPie} type="pickup" still={still} delay={2} onOpen={cohort?.jobs.length ? () => select({ kind: 'requests' }, 'Status mix') : undefined}>{requestContent('request records')}{cohort?.jobs.length ? <StatusDonut counts={counts} select={select}/> : null}</PulseTile>
          </div>
          <div className="vp-slide" ref={node => { slides.current[1] = node }} inert={mobile && page !== 1} aria-hidden={mobile && page !== 1}>
            <PulseTile label="Requests by weekday" name="Requests by weekday" icon={ChartColumn} type="pickup" span2 still={still} delay={3} onOpen={cohort?.jobs.length ? () => select({ kind: 'requests' }, 'Requests by weekday') : undefined}><div className="vp-tile-number">{cohort?.jobs.length ? <CountUp value={cohort.requests}/> : null}</div>{requestContent('request records')}{cohort?.jobs.length ? <WeekdayBars values={requestsByWeekday(dated)} select={select}/> : null}</PulseTile>
            <PulseTile label="Parent approvals" name="Parent approvals" icon={ClipboardCheck} type="safe" still={still} delay={4} onOpen={cohort?.jobs.length ? () => select({ kind: 'approval' }, 'Parent approvals') : undefined}>{requestContent('request records')}{cohort?.jobs.length ? <ApprovalDonut approved={approvals.approved} pending={approvals.pending} select={select}/> : null}</PulseTile>
            <PulseTile label="Open items" name="Open items" icon={BellRing} type="orbit" still={still} delay={5} onOpen={jobs.kind === 'ready' && orbit.kind === 'ready' ? () => select({ kind: 'open' }, 'Open items') : undefined}><div className="vp-open-grid"><div><span>Pending parent approvals</span><ReadBoundary state={jobs} subject="approval records"/>{jobs.kind === 'ready' && <><strong><CountUp value={pendingCount}/></strong><button type="button" data-pulse-action='{"kind":"pending"}' onClick={() => select({ kind: 'pending' }, 'Pending parent approvals')}>View pending records</button></>}</div><div><span>Latest visible active Orbit alert</span><ReadBoundary state={orbit} subject="Orbit status"/>{orbit.kind === 'ready' && <><strong><CountUp value={activeOrbit ? 1 : 0}/></strong><button type="button" data-pulse-action='{"kind":"orbit"}' onClick={() => select({ kind: 'orbit' }, 'Latest visible active Orbit alert')}>View Orbit record</button></>}</div></div>{jobs.kind === 'ready' && !pendingCount && orbit.kind === 'ready' && !activeOrbit && <p className="vp-empty">No current open item is available in these reads.</p>}</PulseTile>
          </div>
        </motion.div>
      </div>
      <nav className="vp-mobile-nav" aria-label="Pulse panels"><button type="button" onClick={() => changePage(page - 1)} disabled={page === 0} aria-label="Previous pulse panel"><ChevronLeft size={18}/></button><div className="vp-dots">{navNames.map((name, index) => <button key={name} type="button" onClick={() => changePage(index)} aria-label={`Show ${name}`} aria-current={page === index ? 'step' : undefined}><motion.span initial={false} animate={{ width: page === index ? 24 : 8, opacity: page === index ? 1 : .55 }} transition={still ? { duration: 0 } : { duration: .2 }}/></button>)}</div><button type="button" onClick={() => changePage(page + 1)} disabled={page === 1} aria-label="Next pulse panel"><ChevronRight size={18}/></button><span className="vp-page-label" role="status">{page + 1} of 2 · {navNames[page]}</span></nav>
      </div>
    </motion.div>
  </section>
}

function OrbitPulse({ controller, jobs, now, readAt }: { controller: OrbitController; jobs: PulseRead<StoredRun[]>; now: number; readAt: number | null }) {
  const state = useOrbitState(controller)
  return <VillagePulseView jobs={jobs} orbit={orbitPulseRead(state)} now={now} readAt={readAt}/>
}

export function VillagePulse({ result }: { result: { loading: boolean; error?: { message: string }; data?: { frontendSnapshot: StoredMissionControl } } }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer) }, [])
  const { session } = useSession()
  const [lastRead, setLastRead] = useState<{ generation: number; snapshot: StoredMissionControl; at: number } | null>(null)
  useEffect(() => {
    if (session && result.data && !result.loading && !result.error) setLastRead({ generation: session.generation, snapshot: result.data.frontendSnapshot, at: Date.now() })
  }, [session?.generation, result.data?.frontendSnapshot, result.loading, result.error])
  const readAt = session && lastRead && result.data?.frontendSnapshot === lastRead.snapshot && session.generation === lastRead.generation ? lastRead.at : null
  const controller = useOrbit()
  const parent = Boolean(session && (session.persona.parent || session.persona.guardian || session.marks?.demoGuide))
  const jobs: PulseRead<StoredRun[]> = !parent ? { kind: 'refused' }
    : result.loading && !result.data ? { kind: 'loading' }
      : result.error ? { kind: /UNAUTHORIZED|UNAUTHENTICATED|AUTH_ERROR/.test(result.error.message) ? 'refused' : 'failed' }
        : result.data ? { kind: 'ready', value: result.data.frontendSnapshot.recordedRuns } : { kind: 'failed' }
  if (!parent) return <VillagePulseView key={session?.generation} jobs={jobs} orbit={{ kind: 'refused' }} now={now} readAt={readAt}/>
  if (!controller) return <VillagePulseView key={session?.generation} jobs={jobs} orbit={{ kind: 'failed' }} now={now} readAt={readAt}/>
  return <OrbitPulse key={session?.generation} controller={controller} jobs={jobs} now={now} readAt={readAt}/>
}
