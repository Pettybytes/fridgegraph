import { useEffect, useMemo, useRef, useState } from 'react'
import { FgButton, InlineFeedback, StatusChip, Surface } from '@/components/fg/primitives'
import { useChildAccess } from '@/features/personas/childContext'
import { useSession } from '@/features/personas/Session'
import { addVillagerError, createLiveAddVillagerConfirm, createMockAddVillagerConfirm } from './addVillager'
import type { AddVillagerProposal, ConfirmAddVillager } from './addVillager'
import './addVillager.css'

type State = 'review' | 'sending' | 'confirmed' | 'expired' | 'stale' | 'refused' | 'sign-in' | 'uncertain'

/** The parent action uses the active persona's Apollo client. Live mode requires an explicit
 * opt-in after migration 0074 is applied and the serving graph is verified. */
export function useAddVillagerConfirm(liveEnabled = false): {
  confirm: ConfirmAddVillager | null; mode: 'mock' | 'live'; canConfirm: boolean; identityKey: string; childName: string
} {
  const { session, authMode, getSessionGeneration } = useSession()
  const child = useChildAccess()
  const mode = liveEnabled && authMode === 'live' ? 'live' : 'mock'
  const confirm = useMemo(() => mode === 'mock' ? createMockAddVillagerConfirm() : child?.client ? createLiveAddVillagerConfirm(child.client) : null, [mode, child?.client])
  return {
    confirm,
    mode,
    canConfirm: !!session?.persona.parent && (!session.marks?.demoGuide||session.marks.showcaseEditor===true),
    identityKey: `${session?.generation ?? getSessionGeneration()}:${session?.persona.personId ?? 'signed-out'}:${child?.selectedChildId ?? ''}`,
    childName: child?.selectedChildName ?? session?.scope.childName ?? 'Child',
  }
}

export function AddVillagerReview({ proposal, liveEnabled = false, confirm: confirmOverride }: {
  proposal: AddVillagerProposal | null
  liveEnabled?: boolean
  /** Test and offline preview seam; never pass Rosina's tool transport here. */
  confirm?: ConfirmAddVillager
}) {
  const { session } = useSession()
  const child = useChildAccess()
  const action = useAddVillagerConfirm(liveEnabled)
  if (!proposal) return null
  const allowed = action.canConfirm && child?.selectedChildId === proposal.childId && session?.scope.childId === proposal.childId
  if (!allowed) return <Surface role="region" aria-label="Add a Villager unavailable"><InlineFeedback tone="warning">Only a parent viewing their child can review this proposal.</InlineFeedback></Surface>
  return <ReviewCard key={`${action.identityKey}:${proposal.id}:${proposal.version}`} proposal={proposal}
    childName={action.childName} canConfirm={allowed} mode={action.mode} confirm={confirmOverride ?? action.confirm} />
}

export function ReviewCard({ proposal, childName, canConfirm, mode, confirm }: {
  proposal: AddVillagerProposal; childName: string; canConfirm: boolean; mode: 'mock' | 'live'; confirm: ConfirmAddVillager | null
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
  const blocked = !canConfirm || !confirm || pending.current || (expired && state !== 'uncertain') ||
    state === 'sending' || state === 'confirmed' || state === 'expired' || state === 'stale' || state === 'refused' || state === 'sign-in'
  async function approve() {
    if (blocked || !confirm) return
    pending.current = true
    const controller = new AbortController()
    abort.current = controller
    setState('sending')
    try {
      await confirm(proposal, controller.signal)
      if (active.current && !controller.signal.aborted) setState('confirmed')
    } catch (error) {
      if (active.current && !controller.signal.aborted) setState(addVillagerError(error))
    } finally {
      pending.current = false
      if (abort.current === controller) abort.current = null
    }
  }
  return <Surface className="add-villager-review" role="region" aria-label="Review Add a Villager proposal" data-mode={mode}>
    <div className="add-villager-review__heading"><div>
      <p className="add-villager-review__eyebrow">{mode === 'mock' ? 'Sample proposal' : 'Proposed change'}</p>
      <h3>Add a Villager</h3>
    </div><StatusChip tone="brand">Review first</StatusChip></div>
    <p className="add-villager-review__intro">Review the exact person and permissions for {childName} before confirming.</p>
    <dl className="add-villager-review__details">
      <dt>Person</dt><dd>{proposal.personDisplayName?.trim() || 'Name not shared'}</dd>
      <dt>Relationship</dt><dd>{proposal.relationshipType}</dd>
      <dt>Exact permissions</dt><dd><ul>{proposal.scopes.map(scope => <li key={scope}><code>{scope}</code></li>)}</ul></dd>
      <dt>Valid from</dt><dd>{proposal.validFrom || 'Not specified'}</dd>
      <dt>Valid until</dt><dd>{proposal.validUntil || 'Not specified'}</dd>
      <dt>Review by</dt><dd>{new Date(proposal.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</dd>
    </dl>
    <div className="add-villager-review__unknown"><strong>What is not known</strong><p>This proposal does not verify free time, acceptance, transport, or a completed pickup.</p></div>
    {mode === 'mock' && <InlineFeedback>Sample review only. Confirm creates no relationship or permission.</InlineFeedback>}
    {!canConfirm && <InlineFeedback tone="warning">Only a parent viewing this child can confirm this proposal.</InlineFeedback>}
    {!confirm && canConfirm && <InlineFeedback tone="warning">Confirmation is unavailable in this view.</InlineFeedback>}
    {state === 'confirmed' && <InlineFeedback tone="success">{mode === 'mock' ? 'Sample reviewed. No relationship or permission was created.' : 'Villager added with the exact permissions shown above.'}</InlineFeedback>}
    {(state === 'expired' || (expired && state === 'review')) && <InlineFeedback tone="error">This proposal expired. Ask Rosina to prepare a new one.</InlineFeedback>}
    {state === 'stale' && <InlineFeedback tone="error">This proposal changed. Review the new version before confirming.</InlineFeedback>}
    {state === 'refused' && <InlineFeedback tone="error">You cannot confirm this proposal. No change was made.</InlineFeedback>}
    {state === 'sign-in' && <InlineFeedback tone="error">Your session ended. Choose a perspective again before confirming.</InlineFeedback>}
    {state === 'uncertain' && <InlineFeedback tone="error">Could not confirm the result. Retry this same proposal; a completed confirm returns the same result.</InlineFeedback>}
    {canConfirm && confirm && <FgButton disabled={blocked} onClick={() => { void approve() }}>
      {state === 'sending' ? 'Confirming…' : state === 'uncertain' ? 'Retry same proposal' : 'Confirm Add a Villager'}
    </FgButton>}
  </Surface>
}
