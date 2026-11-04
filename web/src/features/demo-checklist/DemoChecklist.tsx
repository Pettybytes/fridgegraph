import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Compass, FileText, Image, Mic, Radar, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FgButton, Surface } from '@/components/fg/primitives'
import { ProgressBar, TypeNode, type CardType } from '@/components/fg/cards'
import { checklistStorageKey } from './storage'
import './demo-checklist.css'

export type DemoStepId = 'notice' | 'village' | 'orbit' | 'voice' | 'photo' | 'guide'
export type DemoChecklistEvidence = Record<DemoStepId, string>
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
  evidenceLinks: DemoChecklistEvidence
  reopenSignal?: number
  resetFailure?: string
  /** Supply only an authorized reset action. A resolved false means reset failed. */
  onReset?: () => Promise<boolean | void>
  /** Card 1 trigger: stage + open the real notice flow. Only wired when the live gate is on. */
  onStartNotice?: () => void
  /** The server's recorded pickup from a confirmed notice — persisted-state completion for Card 1. */
  noticeResult?: { jobId: string; status: string; mode: 'mock' | 'live' } | null
}

const IDS: DemoStepId[] = ['notice', 'village', 'orbit', 'voice', 'photo', 'guide']
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

type Step = { id: DemoStepId; number: number; title: string; doThis: ReactNode; lookFor: ReactNode; evidenceLabel: string }

/** Card type + icon per step — the design-v2 type system (docs/contracts/design.md §12). */
const STEP_LOOK: Record<DemoStepId, { type: CardType; icon: LucideIcon }> = {
  notice: { type: 'school', icon: FileText },
  village: { type: 'invite', icon: Users },
  orbit: { type: 'orbit', icon: Radar },
  voice: { type: 'rosina', icon: Mic },
  photo: { type: 'fridge', icon: Image },
  guide: { type: 'pending', icon: Compass },
}

function steps(availability: DemoChecklistAvailability): Step[] {
  const result: Step[] = [{
    id: 'notice', number: 1, title: 'A school notice changes the plan',
    doThis: <>Viewing Nora as Kendra or the Demo guide, open <strong>Add a notice</strong> → <strong>Try a sample</strong> → <strong>Use early dismissal notice (PNG)</strong>. Review the proposal, then confirm once. On a phone, <a download href="/samples/notice-plan/notice-a-early-dismissal.png">download the PNG</a> or <a download href="/samples/notice-plan/notice-a-early-dismissal.pdf">PDF</a> and use <strong>Choose notice files</strong>.</>,
    lookFor: <>This is a historical October 26, 2026 sample: 12:30 PM dismissal conflicts with Nora’s recorded 3:00 PM pickup that day. {availability.noticeConfirmReady ? <>After parent confirmation, look for <strong>Pickup request created</strong>; pickup is <strong>not arranged yet</strong>.</> : <>In mock mode, confirmation shows a sample pickup request; <strong>no record is created</strong>. A recorded request needs live parent confirmation.</>}</>,
    evidenceLabel: 'Notice and pickup receipt',
  }]
  if (availability.villageReady) result.push({
    id: 'village', number: 2, title: 'Grow the village with permission',
    doThis: <>Review Dana’s proposed relationship and <strong>exact access scopes</strong>, then confirm as a parent.</>,
    lookFor: <>A bounded grant with only the approved scopes. A relationship alone grants no access.</>,
    evidenceLabel: 'Add a Villager receipt',
  })
  if (availability.orbitReady) result.push({
    id: 'orbit', number: 3, title: 'Coordinate with Orbit Alert',
    doThis: <>As a parent, review and approve activation. View caregiver responses, then close the alert explicitly.</>,
    lookFor: <>Caregiver responses are <strong>reports</strong>, not verified safety. The alert stays active until a parent closes it.</>,
    evidenceLabel: 'Orbit authority receipt',
  })
  if (availability.voiceReady) result.push({
    id: 'voice', number: 4, title: 'Talk to Rosina',
    doThis: <>Use the microphone on Today to speak to Rosina.</>,
    lookFor: <>Your spoken words as text in the conversation; listen to a reply only if playback is enabled.</>,
    evidenceLabel: 'Voice backend receipt',
  })
  if (availability.photoReady) result.push({
    id: 'photo', number: 5, title: 'Review photo suggestions',
    doThis: <>Use the <a download href="/samples/demo-checklist/fictional-outfit.png">fictional outfit sample illustration</a> as the photo input, then review the suggested descriptors. The sample is an authored fixture with no recorded generation model; it is not Muse art.</>,
    lookFor: <>Suggestions from the child’s allowed vocabulary for a parent to review; none are automatically confirmed.</>,
    evidenceLabel: 'Photo descriptor receipt (different fixture)',
  })
  result.push({
    id: 'guide', number: 6, title: 'Explore the showcase',
    doThis: <>Use <strong>Explore as…</strong> to switch to the <strong>Demo guide</strong> perspective.</>,
    lookFor: <>Explore all fictional families. Try parent actions with the Ellison showcase.</>,
    evidenceLabel: 'Demo guide scope receipt',
  })
  return result
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

  const visible = props.mode === 'guide' ? steps(props.availability).filter(step => step.id === 'guide') : steps(props.availability)
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
          {isNoticeAction(step.id) ? (
            <div className="demo-checklist__action">
              <FgButton variant={noticeDone ? 'secondary' : 'primary'} onClick={props.onStartNotice} disabled={!props.onStartNotice}>{noticeDone ? 'Add another notice' : 'Add the school notice'}</FgButton>
              <p className="demo-checklist__action-state" role="status">{noticeActionState}</p>
              {noticeDone && <nav className="demo-checklist__results" aria-label="Check the result">
                <a href="#/mission-control">Mission Control — the pickup request</a>
                <a href="#/activity">Recorded activity</a>
                <a href="#/calendar">Family Calendar</a>
              </nav>}
              <a className="demo-checklist__action-receipt" href={props.evidenceLinks[step.id]} target="_blank" rel="noreferrer">{step.evidenceLabel}</a>
            </div>
          ) : (
            <div className="demo-checklist__step-foot"><a href={props.evidenceLinks[step.id]} target="_blank" rel="noreferrer">{step.evidenceLabel}</a><label><input type="checkbox" checked={saved.tried.includes(step.id)} onChange={event => mark(step.id, event.target.checked)} aria-label={`I tried this: ${step.title}`} /><span>I tried this</span></label></div>
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
