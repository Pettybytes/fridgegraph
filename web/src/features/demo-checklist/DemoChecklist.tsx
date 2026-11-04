import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CalendarDays, FileText, HeartHandshake, Map as MapIcon, MessageCircle, Radar } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FgButton, Surface } from '@/components/fg/primitives'
import { ProgressBar, TypeNode, type CardType } from '@/components/fg/cards'
import { checklistStorageKey } from './storage'
import './demo-checklist.css'

export type DemoStepId = 'notice' | 'calendar' | 'rosina' | 'orbit' | 'map' | 'living'
export type DemoChecklistAvailability = {
  noticeConfirmReady: boolean
  villageReady: boolean
  orbitReady: boolean
  voiceReady: boolean
  photoReady: boolean
}
export type DemoChecklistProps = {
  /** Use a non-secret run identifier. Never pass a token or response body here. */
  demoRunId: string
  personaId: string
  childId: string
  mode: 'parent' | 'guide'
  version?: string
  availability: DemoChecklistAvailability
  reopenSignal?: number
  resetFailure?: string
  /** Supply only an authorized reset action. A resolved false means reset failed. */
  onReset?: () => Promise<boolean | void>
  /** Card 1 trigger: stage + open the real notice flow. Only wired when the live gate is on. */
  onStartNotice?: () => void
  /** The server's recorded pickup from a confirmed notice — persisted-state completion for Card 1. */
  noticeResult?: { jobId: string; status: string; mode: 'mock' | 'live' } | null
}

const IDS: DemoStepId[] = ['notice', 'calendar', 'rosina', 'orbit', 'map', 'living']
type Saved = { tried: DemoStepId[]; dismissed: boolean }
const EMPTY: Saved = { tried: [], dismissed: false }

function readSaved(key: string): Saved {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return EMPTY
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return EMPTY
    const saved = value as Partial<Saved>
    return {
      tried: Array.isArray(saved.tried) ? saved.tried.filter((id): id is DemoStepId => IDS.includes(id as DemoStepId)) : [],
      dismissed: saved.dismissed === true,
    }
  } catch { return EMPTY }
}

type Step = { id: DemoStepId; number: number; title: string; doThis: ReactNode; lookFor: ReactNode; perspective: ReactNode }

/** Card type + icon per step — the design-v2 type system (docs/contracts/design.md §12). */
const STEP_LOOK: Record<DemoStepId, { type: CardType; icon: LucideIcon }> = {
  notice: { type: 'school', icon: FileText },
  calendar: { type: 'pending', icon: CalendarDays },
  rosina: { type: 'rosina', icon: MessageCircle },
  orbit: { type: 'orbit', icon: Radar },
  map: { type: 'neutral', icon: MapIcon },
  living: { type: 'care', icon: HeartHandshake },
}

function steps(availability: DemoChecklistAvailability): Step[] {
  // The six-step provenance path: every step points at a journey verified on the
  // public build (release board rows 1, 2, 4, 7, 9, 10). Unverified actions
  // (growing the village, Fridge photo upload, voice as the primary path) stay
  // out of the guided path until they are verified; each step carries a
  // perspective check so a judge can see the family boundaries for themselves.
  return [{
    id: 'notice', number: 1, title: 'A school notice changes the plan',
    doThis: <>Viewing Nora as Kendra or the Demo guide, open <strong>Add a notice</strong> → <strong>Try a sample</strong> → <strong>Use early dismissal notice (PNG)</strong>. Review the proposal, then confirm once. On a phone, <a download href="/samples/notice-plan/notice-a-early-dismissal.png">download the PNG</a> or <a download href="/samples/notice-plan/notice-a-early-dismissal.pdf">PDF</a> and use <strong>Choose notice files</strong>.</>,
    lookFor: <>This is a historical October 26, 2026 sample: 12:30 PM dismissal conflicts with Nora’s recorded 3:00 PM pickup that day. {availability.noticeConfirmReady ? <>After parent confirmation, look for <strong>Pickup request created</strong>; pickup is <strong>not arranged yet</strong>.</> : <>In mock mode, confirmation shows a sample pickup request; <strong>no record is created</strong>. A recorded request needs live parent confirmation.</>}</>,
    perspective: <>Switch to Dana (Jax’s mom): she cannot see or confirm Nora’s notice. Switch back to Kendra or the Demo guide to try this step.</>,
  }, {
    id: 'calendar', number: 2, title: 'Ask Rosina to add a calendar event',
    doThis: <>Open <strong>Ask Rosina</strong> and type: Please add a calendar event titled “Piano practice” for Nora tomorrow at 4:00 PM. Review the proposal card, then confirm it.</>,
    lookFor: <>The event appears in <strong>Family Calendar</strong> and <strong>Activity</strong>. Reload the page and check it is still there.</>,
    perspective: <>Open Family Calendar as Andre (Nora’s dad): the same event is in his view of Nora’s calendar.</>,
  }, {
    id: 'rosina', number: 3, title: 'Ask Rosina a question',
    doThis: <>In <strong>Ask Rosina</strong>, type: Who is picking Nora up today?</>,
    lookFor: <>An answer drawn from Nora’s recorded schedule, naming what it checked.</>,
    perspective: <>Ask the same question as Dana: Rosina refuses and shares none of Nora’s facts. Dana can ask about Jax instead.</>,
  }, {
    id: 'orbit', number: 4, title: 'Review Orbit before anyone sends',
    doThis: <>Open <strong>Orbit</strong> for Nora and review the start screen: who would be contacted and what would be sent. Only a parent can start an alert.</>,
    lookFor: <>The audience includes Nora’s dad Andre. An incomplete Send stays on the start screen; nothing is sent from this step.</>,
    perspective: <>Open Orbit as Loretta (Nora’s grandma): her view is read-only and she cannot start an alert.</>,
  }, {
    id: 'map', number: 5, title: 'Walk the Village map',
    doThis: <>Open <strong>Village map</strong> for Nora. Drag a person marker onto a place, then open a route.</>,
    lookFor: <>Pins, the walking route and its travel time update on the map.</>,
    perspective: <>Open the map as Dwayne (Malik’s dad), then as Priya: each sees only the children shared with them.</>,
  }, {
    id: 'living', number: 6, title: 'See a caregiver’s Living Village',
    doThis: <>Open <strong>Living Village</strong> as Loretta, then as Priya, for the children they care for.</>,
    lookFor: <>Care schedules and handoffs for Nora (and Malik for Priya), presented read-only.</>,
    perspective: <>As the Demo guide, every family opens read-only. Parents keep their own editing paths in Today and Family Calendar.</>,
  }]
}

/** Standalone checklist. It never calls a model or backend, and it never mounts itself. */
export function DemoChecklist(props: DemoChecklistProps) {
  const key = checklistStorageKey(props.version ?? '1', props.personaId, props.childId, props.demoRunId)
  return <ChecklistSession key={key} storageKey={key} {...props} />
}

function ChecklistSession({ storageKey, ...props }: DemoChecklistProps & { storageKey: string }) {
  const [saved, setSaved] = useState<Saved>(() => readSaved(storageKey))
  const [resetState, setResetState] = useState<'idle' | 'pending' | 'failed'>('idle')
  const [resetOpen, setResetOpen] = useState(false)
  const alive = useRef(true)
  const seenReopenSignal = useRef(props.reopenSignal)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(saved)) } catch { /* Progress remains usable in memory. */ } }, [storageKey, saved])
  useEffect(() => {
    if (seenReopenSignal.current === props.reopenSignal) return
    seenReopenSignal.current = props.reopenSignal
    setSaved(current => current.dismissed ? { ...current, dismissed: false } : current)
  }, [props.reopenSignal])

  const visible = steps(props.availability)
  // Card 1 (notice) is a persisted-state action card under the live gate — never a tried checkbox.
  const isNoticeAction = (id: DemoStepId) => id === 'notice' && props.availability.noticeConfirmReady
  const noticeDone = props.noticeResult?.mode === 'live'
  const checkboxSteps = visible.filter(step => !isNoticeAction(step.id))
  const triedCount = checkboxSteps.filter(step => saved.tried.includes(step.id)).length
  const noticeActionState = props.noticeResult?.mode === 'live'
    ? `Pickup request recorded — not arranged yet · ${props.noticeResult.jobId}`
    : props.noticeResult?.mode === 'mock'
      ? 'Sample reviewed. No record was created in this build.'
      : 'Not started. The trigger stages the notice; confirm the pickup request in Rosina’s review to record it.'
  const mark = (id: DemoStepId, checked: boolean) => setSaved(current => ({ ...current,
    tried: checked ? [...new Set([...current.tried, id])] : current.tried.filter(item => item !== id),
  }))

  async function reset() {
    if (!props.onReset || props.mode !== 'parent' || resetState === 'pending') return
    setResetState('pending')
    try {
      const result = await props.onReset()
      if (!alive.current) return
      if (result === false) { setResetState('failed'); return }
      setSaved(current => ({ ...current, tried: [] }))
      setResetOpen(false)
      setResetState('idle')
    } catch { if (alive.current) setResetState('failed') }
  }

  if (saved.dismissed) return <FgButton variant="secondary" onClick={() => setSaved(current => ({ ...current, dismissed: false }))}>Reopen judge checklist</FgButton>
  return <Surface className="demo-checklist" role="region" aria-label="Judge checklist">
    <div className="demo-checklist__header">
      <div><h2>Here's what to expect</h2><p>{props.mode === 'guide' ? 'Demo guide · showcase exploration' : 'View Nora as Kendra or the Demo guide. Start with a notice.'}</p></div>
      <FgButton variant="quiet" onClick={() => setSaved(current => ({ ...current, dismissed: true }))}>Dismiss checklist</FgButton>
    </div>
    {props.mode === 'parent' && (props.personaId !== 'kendra' || props.childId !== 'p_nora') && <p className="demo-checklist__context">The notice sample is for Kendra viewing Nora. Switch perspective before trying it.</p>}
    <div className="demo-checklist__running">
      <ProgressBar value={checkboxSteps.length ? Math.round((triedCount / checkboxSteps.length) * 100) : 0} type="safe" label={`${triedCount} of ${checkboxSteps.length} steps tried`} />
      <p className="demo-checklist__progress">{triedCount} of {checkboxSteps.length} tried. These boxes record what you tried; they do not verify an app result.</p>
    </div>
    <ol className="demo-checklist__steps">
      {visible.map(step => <li key={step.id} className="demo-checklist__step" data-fgc-type={STEP_LOOK[step.id].type} data-tried={(isNoticeAction(step.id) ? noticeDone : saved.tried.includes(step.id)) || undefined} value={step.number}>
        <span className="demo-checklist__bar" aria-hidden="true" />
        <div className="demo-checklist__node"><TypeNode type={STEP_LOOK[step.id].type}>{(() => { const StepIcon = STEP_LOOK[step.id].icon; return <StepIcon size={18} aria-hidden="true" /> })()}</TypeNode><span className="demo-checklist__number">{step.number}</span></div>
        <div className="demo-checklist__body">
          <div className="demo-checklist__step-heading"><h3>{step.title}</h3>{step.number > 1 && <span className="demo-checklist__optional">Optional</span>}</div>
          <p><strong>Do this:</strong> {step.doThis}</p>
          <p><strong>Look for:</strong> {step.lookFor}</p>
          <p><strong>Perspective check:</strong> {step.perspective}</p>
          {isNoticeAction(step.id) ? (
            <div className="demo-checklist__action">
              <FgButton variant={noticeDone ? 'secondary' : 'primary'} onClick={props.onStartNotice} disabled={!props.onStartNotice}>{noticeDone ? 'Add another notice' : 'Add the school notice'}</FgButton>
              <p className="demo-checklist__action-state" role="status">{noticeActionState}</p>
              {noticeDone && <nav className="demo-checklist__results" aria-label="Check the result">
                <a href="#/mission-control">Mission Control — the pickup request</a>
                <a href="#/activity">Recorded activity</a>
                <a href="#/calendar">Family Calendar</a>
              </nav>}
            </div>
          ) : (
            <div className="demo-checklist__step-foot"><label><input type="checkbox" checked={saved.tried.includes(step.id)} onChange={event => mark(step.id, event.target.checked)} aria-label={`I tried this: ${step.title}`} /><span>I tried this</span></label></div>
          )}
        </div>
      </li>)}
    </ol>
    {props.mode === 'parent' && props.onReset && <div className="demo-checklist__reset">
      <FgButton variant="secondary" onClick={() => { setResetOpen(true); setResetState('idle') }} disabled={resetState === 'pending'}>Reset shared demo…</FgButton>
      {resetOpen && <div className="demo-checklist__reset-confirm">
        <p>This resets the shared sandbox for everyone, clearing alerts, responses and visitor changes. Checklist progress clears only after a successful reset.</p>
        <div><FgButton variant="primary" loading={resetState === 'pending'} onClick={() => void reset()}>Reset demo for everyone</FgButton><FgButton variant="quiet" disabled={resetState === 'pending'} onClick={() => setResetOpen(false)}>Cancel</FgButton></div>
      </div>}
      {resetState === 'pending' && <p role="status">Resetting the demo… Checklist progress will clear only if the reset succeeds.</p>}
      {resetState === 'failed' && <p role="alert">{props.resetFailure || 'Reset did not complete.'} Checklist progress is unchanged. Try again when the demo is ready.</p>}
    </div>}
  </Surface>
}
