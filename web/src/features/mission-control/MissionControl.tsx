import { useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { Dialog } from 'radix-ui'
import { Check, ChevronRight, Clock3, MessageSquare, Phone, ShieldCheck, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dataErrorMessage, useDataContext, useSurfaceData } from '@/lib/frontendData/provider'
import type { Candidate } from '@/lib/frontendData/types'
import type { CoordinationJob, MissionControlData } from '@/lib/frontendData/types'
import { buildMissionControlView } from './model'
import './mission-control.css'

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
// Unavailable for drivers: the adapter preserves the backend's nullable paid-ride cost.
function PaidRideEstimate({ candidate }: { candidate: Candidate }) {
  if (candidate.estimatedRideCostUsd === null) return null
  return <span className="paid-ride-estimate"><span>{candidate.name} · Rideshare to school (Uber or Lyft) · Est. {money(candidate.estimatedRideCostUsd)}</span><small>FridgeGraph estimate (distance × $1.40/mi), not an Uber or Lyft quote</small>{candidate.costBasis && <small>Recorded basis: {candidate.costBasis}</small>}</span>
}
const time = (at: string) => new Date(at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false })
const miles = (value: number | null) => value == null ? 'Distance not recorded' : `${value.toFixed(2)} miles`
const eventTitle: Record<string, string> = { job_created: 'Request acknowledged', attempt: 'Caregivers contacted', candidate_evaluation: 'Response evaluated', confirmation: 'Parent approval recorded', simulated_tracking: 'Simulated route preview' }
export function MissionControl() {
  const result = useSurfaceData<MissionControlData>('mission-control')
  const { scope, mode, adapter } = useDataContext()
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const reviewButtonRef = useRef<HTMLButtonElement | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [acceptOverLimit, setAcceptOverLimit] = useState(false)
  const [actionError, setActionError] = useState('')
  if (result.loading && !result.data) return <p role="status">Loading Rosina's recorded activity…</p>
  if (result.error) return <p role="alert">{dataErrorMessage(result.error)}</p>
  if (!result.data) return <p>No pickup activity has been recorded.</p>
  const data = result.data.frontendSnapshot
  const view = buildMissionControlView(data)
  const job: CoordinationJob | undefined = data.coordinationJobs?.[0] ?? view.timeline.at(-1)?.job
  if (!job) return <p>No pickup job has been recorded.</p>
  const confirmation = data.confirmations?.find(item => item.job.id === job?.id)
  const overLimitCandidate = view.candidates.find(candidate => candidate.id === job.overLimitCandidate?.id)
  const recommendation = job.overLimitCandidate ? null : view.recommendation
  const selected = view.candidates.find(candidate => candidate.id === selectedId) ?? overLimitCandidate ?? recommendation ?? view.candidates[0]
  const reviewingOverLimit = !!overLimitCandidate && selected?.id === overLimitCandidate.id
  const windowName = (job.idempotencyKey ?? view.timeline.at(-1)?.job.idempotencyKey)?.split(':').at(-1)
  const scenarioDate = view.timeline[0]?.at ? new Date(view.timeline[0].at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : 'Pickup coordination'
  const canApprove = !!adapter.approvePickup && job?.status === 'awaiting_approval' && !confirmation && (selected?.id === recommendation?.id || reviewingOverLimit)
  const status = confirmation ? 'Parent approval recorded' : job?.status === 'awaiting_approval' ? 'Awaiting parent approval' : job?.status === 'confirmed' ? 'Awaiting approval evidence' : job?.status === 'discovering' ? 'Contacting caregivers' : job?.status === 'failed' ? 'Coordination ended' : 'Request acknowledged'
  function openReview(event: MouseEvent<HTMLButtonElement>, id?: string) { openerRef.current = event.currentTarget; if (id) setSelectedId(id); setAcceptOverLimit(false); setActionError(''); setReviewOpen(true) }
  async function approve() {
    if (!canApprove || !job || !adapter.approvePickup || (reviewingOverLimit && !acceptOverLimit)) return
    setSaving(true); setActionError('')
    try {
      await adapter.approvePickup(scope, { jobId: job.id, version: job.version, decision: 'APPROVED', ...(reviewingOverLimit ? { acceptOverLimit: true } : {}) })
      await result.refetch()
      setReviewOpen(false)
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to record approval. Try again.') }
    finally { setSaving(false) }
  }
  return <div className="mc-workspace">
    <div className="mc-context"><span><Clock3 size={15} aria-hidden="true" />{scenarioDate} · {mode === 'mock' ? 'Recorded scenario' : 'Current pickup'}</span><span className="mc-simulated">{mode === 'mock' ? 'Simulated' : 'Connected'}</span></div>
    <div className="mc-layout">
      <section className="pickup-card" aria-labelledby="pickup-heading">
        <div className="pickup-title"><div><p>Pickup coordination</p><h2 id="pickup-heading">{scope.childName.split(' ')[0]}'s {windowName ? `${windowName} ` : ''}pickup</h2></div><ShieldCheck size={25} aria-hidden="true" /></div>
        <p className="pickup-status" role="status"><span className={cn('status-dot', confirmation && 'complete')} />{status}</p>
        <div className="caregiver-header"><h3>Caregiver responses</h3><span>{view.candidates.length} recorded</span></div>
        <div className="caregiver-list">{view.candidates.map(candidate => {
          const Channel = candidate.channel === 'CALL' ? Phone : MessageSquare
          const approved = confirmation?.candidate.id === candidate.id
          return <button key={candidate.id} type="button" className={cn('caregiver-row', candidate.id === selected?.id && 'selected')} aria-label={`Select ${candidate.name}`} aria-pressed={candidate.id === selected?.id} aria-describedby={`${candidate.id}-status`} onClick={() => setSelectedId(candidate.id)}>
            <span className="channel-icon"><Channel size={16} aria-hidden="true" /><span className="sr-only">{candidate.channel}</span></span>
            <span className="caregiver-identity"><strong>{candidate.name}</strong><small>{miles(candidate.distanceMiles)}</small><PaidRideEstimate candidate={candidate} /></span>
            <span id={`${candidate.id}-status`} className={cn('candidate-pill', candidate.reasonCode === 'OVER_POLICY' && 'over-limit', approved && 'approved')}>{approved ? 'Approval recorded' : candidate.statusLabel}</span>
          </button>
        })}</div>
        {selected && <div className="selected-detail"><span>Selected for review: <strong>{selected.name}</strong></span><button type="button" ref={reviewButtonRef} onClick={event => openReview(event)}>Review<ChevronRight size={15} aria-hidden="true" /></button></div>}
        {recommendation && <div className="recommendation">
          <div className="recommendation-label"><Sparkles size={17} aria-hidden="true" /><h3>Rosina's recommendation</h3></div>
          <h4>{recommendation.name}</h4><p>Recorded candidate status: {recommendation.statusLabel}.</p>
          <ul><li><Check size={14} aria-hidden="true" />{confirmation ? `Approval from ${confirmation.approvedBy.displayName}` : 'Parent approval is still required'}</li></ul>
          <PaidRideEstimate candidate={recommendation} />
          {!confirmation ? <button className="mc-primary" type="button" disabled={!adapter.approvePickup || job?.status !== 'awaiting_approval'} onClick={event => openReview(event, recommendation?.id)}>Approve pickup<ChevronRight size={16} aria-hidden="true" /></button> : <p className="approval-proof"><ShieldCheck size={17} aria-hidden="true" />{confirmation.id} · {time(confirmation.receivedAt)} UTC</p>}
        </div>}
        {overLimitCandidate && <div className="recommendation over-limit-option"><h3>Over your travel limit</h3><h4>{overLimitCandidate.name}</h4><p>No policy-compliant recommendation was returned for this job.</p><PaidRideEstimate candidate={overLimitCandidate} />{!confirmation && <button type="button" className="mc-primary" onClick={event => openReview(event, overLimitCandidate.id)}>Review rideshare option</button>}</div>}
        {confirmation?.overLimitApproved && <p className="mc-completion-note">Over-limit option explicitly accepted.</p>}
        <p className="cost-footnote">Drivers have no travel cost attached. Paid-ride estimates are explored only when no driver can do the pickup.</p>
        {confirmation && <p className="mc-completion-note">Approval is recorded. Pickup completion has not been recorded.</p>}
      </section>
      <section className="mc-trace" aria-labelledby="trace-heading"><div className="mc-section-heading"><Sparkles size={17} aria-hidden="true" /><h2 id="trace-heading">Rosina's activity trace</h2></div><p className="mc-muted">Recorded outreach and evaluations. Times in UTC.</p>
        {view.activityTrace.length ? <ol>{view.activityTrace.map(event => <li key={event.id}><time dateTime={event.at}>{time(event.at)}</time><div><h3>{eventTitle[event.kind] ?? event.kind}</h3><p>{event.summary.replaceAll('OVER_POLICY', 'Over your travel limit').replaceAll('APPROVAL_PENDING', 'Awaiting parent approval')}</p></div></li>)}</ol> : <p>No outreach has been recorded.</p>}
      </section>
      <section className="mc-timeline" aria-labelledby="timeline-heading"><div className="mc-section-heading"><Clock3 size={17} aria-hidden="true" /><h2 id="timeline-heading">Job timeline</h2></div><ol>{view.timeline.map(event => <li key={event.id}><span className="timeline-marker" /><time dateTime={event.at}>{time(event.at)}</time><div><strong>{eventTitle[event.kind] ?? event.kind}</strong><p>{event.kind === 'simulated_tracking' ? 'Simulated preview only; no arrival or completed pickup is recorded.' : `Version ${event.job.version} · ${event.job.status.replaceAll('_', ' ')}`}</p></div></li>)}</ol></section>
    </div>
    <Dialog.Root open={reviewOpen} onOpenChange={setReviewOpen}><Dialog.Portal><Dialog.Overlay className="mc-dialog-overlay" /><Dialog.Content className="mc-dialog" onCloseAutoFocus={event => {
      event.preventDefault()
      // The approval button disappears after a successful replay; Review remains available.
      const target = openerRef.current?.isConnected ? openerRef.current : reviewButtonRef.current
      target?.focus()
    }}><Dialog.Title>Review {selected?.name}</Dialog.Title><Dialog.Description>{selected?.statusLabel}. {reviewingOverLimit ? 'Review the details before explicitly accepting this over-limit option.' : 'Review the recorded details before approving the recommended caregiver.'}</Dialog.Description><Dialog.Close className="mc-dialog-close" aria-label="Close review"><X size={19} /></Dialog.Close>
      {selected && <dl><div><dt>Estimated distance</dt><dd>{miles(selected.distanceMiles)}</dd></div><div><dt>Contact channel</dt><dd>{selected.channel}</dd></div></dl>}
      {selected && <PaidRideEstimate candidate={selected} />}
      <p className="mc-muted">{reviewingOverLimit ? 'This option exceeds your household travel limit. Explicit acceptance is required and does not raise that limit.' : selected?.id !== recommendation?.id ? 'This caregiver is an alternative for review. The recorded recommendation has not changed.' : confirmation ? 'Parent approval already exists for this recorded pickup.' : mode === 'mock' ? 'Simulated demo: this action replays the approval already recorded in this scenario. No one is contacted.' : 'Only the named parent approver can approve this pickup.'}</p>
      {reviewingOverLimit && !confirmation && <label className="over-limit-consent"><input type="checkbox" checked={acceptOverLimit} onChange={event => setAcceptOverLimit(event.target.checked)} />I accept this option above my travel limit</label>}
      {actionError && <p role="alert">{actionError}</p>}
      {canApprove && <button type="button" className="mc-primary" disabled={saving || (reviewingOverLimit && !acceptOverLimit)} onClick={approve}>{saving ? 'Recording…' : reviewingOverLimit ? 'Accept over-limit option' : mode === 'mock' ? 'Replay recorded approval' : 'Confirm approval'}</button>}
      <Dialog.Close className="mc-secondary">Back to pickup</Dialog.Close>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>
}
