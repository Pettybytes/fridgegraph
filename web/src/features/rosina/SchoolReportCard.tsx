import { useEffect, useRef, useState } from 'react'
import type { ConfirmSchoolReport, SchoolReportProposal } from './schoolReport'
import { schoolReportError } from './schoolReport'
import { FgButton, Surface } from '@/components/fg/primitives'

type State = 'review' | 'sending' | 'filed' | 'expired' | 'stale' | 'refused' | 'sign-in' | 'uncertain'

export function SchoolReportCard({ proposal, childName, canConfirm, accessLoading, mode, confirm }: {
  proposal: SchoolReportProposal
  childName: string
  canConfirm: boolean
  accessLoading: boolean
  mode: 'mock' | 'live'
  confirm: ConfirmSchoolReport
}) {
  const [state, setState] = useState<State>('review')
  const pending = useRef(false)
  const active = useRef(true)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => {
    active.current = true
    return () => { active.current = false; abort.current?.abort() }
  }, [])
  const expired = Date.now() >= Date.parse(proposal.expiresAt)
  // A lost response may have followed a committed confirm. The server returns that same
  // report before its expiry check, so an explicit retry stays possible after expiry.
  const disabled = !canConfirm || accessLoading || pending.current || (expired && state !== 'uncertain') || state === 'sending' || state === 'filed' || state === 'expired' || state === 'stale' || state === 'refused' || state === 'sign-in'
  async function file() {
    if (disabled) return
    pending.current = true
    const controller = new AbortController()
    abort.current = controller
    setState('sending')
    try {
      const report = await confirm(proposal, controller.signal)
      if (!active.current || controller.signal.aborted) return
      if (!report.id) throw new Error('Invalid report response')
      setState('filed')
    } catch (error) {
      if (active.current && !controller.signal.aborted) setState(schoolReportError(error))
    } finally {
      pending.current = false
      if (abort.current === controller) abort.current = null
    }
  }
  return <Surface className="rosina-school-report" role="region" aria-label="Review proposed school-day report" data-state={mode === 'mock' ? 'sample' : 'live'}>
    <p className="rosina-school-report-kicker">{mode === 'mock' ? 'Sample proposal · No school record will be filed' : 'Proposed school-day report'}</p>
    <h3>Review before sharing</h3>
    <dl><dt>Child</dt><dd>{childName}</dd><dt>Report type</dt><dd>{proposal.kind}</dd><dt>What the report says</dt><dd>{proposal.text}</dd></dl>
    <p className="rosina-school-report-note">{mode === 'mock' ? 'Confirm reviews this sample only.' : 'Nothing is filed until you confirm this exact report.'}</p>
    {accessLoading && <p role="status">Checking reporting access…</p>}
    {!accessLoading && !canConfirm && <p role="status">You cannot confirm school-day reports for this child.</p>}
    {state === 'filed' && <p role="status">{mode === 'mock' ? 'Sample reviewed. No school record was filed.' : 'Report filed. The family can now see this school-day report.'}</p>}
    {(state === 'expired' || (expired && state === 'review')) && <p role="alert">This proposal expired. Ask Rosina to prepare a new one.</p>}
    {state === 'stale' && <p role="alert">This proposal changed. Review a new proposal before confirming.</p>}
    {state === 'refused' && <p role="alert">This report is not shared with your role. Nothing was filed.</p>}
    {state === 'sign-in' && <p role="alert">Your session ended. Choose a perspective again before confirming.</p>}
    {state === 'uncertain' && <p role="alert">Couldn’t confirm whether the report was filed. You can retry this same proposal; it will not create a second report.</p>}
    {canConfirm && <FgButton type="button" disabled={disabled} onClick={() => { void file() }}>{state === 'sending' ? 'Confirming…' : state === 'uncertain' ? 'Retry same report' : 'Confirm report'}</FgButton>}
  </Surface>
}
