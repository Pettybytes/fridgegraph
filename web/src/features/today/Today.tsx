/**
 * Kendra's Today — the signature home surface. Bound by docs/contracts/design.md.
 *
 * Every fact is read from a delivered contract; nothing is invented. Information
 * order: identity/context · Ask Rosina · next-attention (the real Orbit check-in,
 * passed in) · your children (fresh MyChildren) · recorded activity (mission
 * control) · a compact village preview. Empty, loading and refusal are explicit
 * and use the contract's exact wording. The selected child (current context) is
 * kept visibly separate from the authorized MyChildren list.
 */
import { useState, type ReactNode } from 'react'
import { useSession } from '@/features/personas/Session'
import { useSurfaceData } from '@/lib/frontendData/provider'
import type { MissionControlData, VillageData } from '@/lib/frontendData/types'
import { recordedSummary } from '@/lib/frontendData/displayCopy'
import { scopeLabel, type ChildAccess, type MyChildrenState } from '@/features/personas/myChildren'
import { useChildAccess } from '@/features/personas/childContext'
import { ConnectedVillagePreview } from '@/components/signature'
import { Surface, StatusChip, SourceChip, Avatar, InlineFeedback, Composer, Icon } from '@/components/fg/primitives'
import { RosinaAvatar } from '@/components/fg/RosinaAvatar'
import { Mic } from 'lucide-react'
import { TodayDemoChecklist } from '@/features/demo-checklist/TodayDemoChecklist'
import './today.css'

function greeting(now: number): string {
  const h = new Date(now).getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}
function longDate(now: number): string {
  return new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}
function shortWhen(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
export function Today({ attention, now = Date.now }: { attention?: ReactNode; now?: () => number }) {
  const [checklistReopen, setChecklistReopen] = useState(0)
  const { session, authMode } = useSession()
  const access = useChildAccess()
  const mission = useSurfaceData<MissionControlData>('mission-control')
  const myChildren: MyChildrenState = access?.authorized ?? { status: 'loading' }
  const at = now()

  if (!session) return null
  const { scope } = session
  const live = authMode === 'live'
  // The focused child (current context), kept separate from the session home child
  // and from the authorized list. Falls back to the session scope before context loads.
  const childId = access?.selectedChildId ?? scope.childId
  const childName = access?.selectedChildName ?? scope.childName

  const events = (mission.data?.frontendSnapshot.events ?? []).slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 4)

  return (
    <section className="fg-today" aria-label={`Today for ${scope.parentName}`}>
      {/* ── Main story ─────────────────────────────────────────────── */}
      <div className="fg-today-main">
        <header className="fg-today-greet">
          <p className="fg-today-date">{longDate(at)}</p>
          <h2 className="fg-today-hi">{greeting(at)}, {scope.parentName}.</h2>
          <StatusChip tone="brand" className="fg-today-context">Viewing {childName}</StatusChip>
          {(session.persona.id === 'kendra' || session.persona.id === 'demo-guide') && <button type="button" className="fg-today-checklist-link" onClick={() => {
            setChecklistReopen(value => value + 1)
            requestAnimationFrame(() => document.getElementById('today-demo-checklist')?.focus())
          }}>Demo checklist</button>}
        </header>

        {/* Next attention — the real Orbit check-in — is the hero of the screen when
            there is one to act on. */}
        {attention ? <div className="fg-today-hero">{attention}</div> : null}

        {/* Ask Rosina entry */}
        <Surface elevated className="fg-today-rosina">
          <div className="fg-today-rosina-head">
            <RosinaAvatar state="ready" size={44} />
            <div>
              <h3>Ask Rosina</h3>
              <p>Ask about what’s shared with you. Every change needs your confirmation.</p>
            </div>
          </div>
          <div className="fg-today-askrow">
            <Composer
              placeholder={`What’s on ${childName}’s calendar today?`}
              maxLength={4000}
              onSend={message => window.dispatchEvent(new CustomEvent('rosina:send-from-today', {
                detail: { message, generation: session.generation, childId },
              }))}
              sendLabel="Ask Rosina"
            />
            <button type="button" className="fg-iconbtn fg-today-mic" aria-label="Open Rosina microphone" title="Open Rosina microphone" onClick={() => window.dispatchEvent(new Event('rosina:focus-mic'))}>
              <Mic size={19} aria-hidden="true" />
            </button>
          </div>
        </Surface>

        <TodayDemoChecklist reopenSignal={checklistReopen} />

        {/* Recorded activity — the latest recorded items. Loading and refusal are
            explicit; when it has loaded with nothing to show, the section is omitted
            entirely rather than rendering an empty block on the hero screen. */}
        {(mission.loading && !mission.data) || mission.error || events.length > 0 ? (
          <Surface className="fg-today-activity" aria-label="Recorded activity">
            <div className="fg-today-section-head">
              <h3>Recorded activity</h3>
              <a className="fg-today-link" href="#/mission-control">Mission Control <Icon.chevron /></a>
            </div>
            {mission.loading && !mission.data ? (
              <div className="fg-skel-list" aria-hidden><span /><span /><span /></div>
            ) : mission.error && /UNAUTHORIZED|UNAUTHENTICATED|AUTH_ERROR/.test(mission.error.message) ? (
              <p className="fg-today-empty">No records are available to this view.</p>
            ) : mission.error ? (
              <InlineFeedback tone="error">I couldn’t check that just now.</InlineFeedback>
            ) : (
              <>
                <ul className="fg-today-events">
                  {events.map((e) => (
                    <li key={e.id}>
                      <span className="fg-today-event-dot" data-kind={e.kind} aria-hidden />
                      <span className="fg-today-event-summary">{recordedSummary(e.summary)}</span>
                      <time className="fg-today-event-when" dateTime={e.at}>{shortWhen(e.at)}</time>
                    </li>
                  ))}
                </ul>
                <SourceChip>Pickup records{live ? '' : ' · sample'}</SourceChip>
              </>
            )}
          </Surface>
        ) : null}
      </div>

      {/* ── Supporting rail ────────────────────────────────────────── */}
      <aside className="fg-today-aside">
        {/* Children shared with you — fresh MyChildren; a read scope, not parenthood;
            selected context marked, scopes never unioned. */}
        <Surface className="fg-today-children" aria-label="Children shared with you">
          <div className="fg-today-section-head"><h3>Children shared with you</h3></div>
          {!live ? (
            <ChildRow child={{ id: scope.childId, displayName: scope.childName, scopes: [] }} current sample />
          ) : myChildren.status === 'loading' ? (
            <div className="fg-skel-list" aria-hidden><span /><span /></div>
          ) : myChildren.status === 'empty' ? (
            <p className="fg-today-empty">No children are shared with you right now.</p>
          ) : myChildren.status === 'refused' || myChildren.status === 'error' ? (
            <InlineFeedback tone="error">I couldn’t check that just now.</InlineFeedback>
          ) : (
            <ul className="fg-today-childlist">
              {myChildren.children.map((c) => (
                <li key={c.id}><ChildRow child={c} current={c.id === childId} /></li>
              ))}
            </ul>
          )}
        </Surface>

        {/* Village preview — the real compact signature rings, read from the
            authorized MyChildren context (loading/refused/error handled inside). */}
        <Surface className="fg-today-village" aria-label="Village preview">
          <div className="fg-today-section-head">
            <h3>{childName}’s village</h3>
            <a className="fg-today-link" href="#/village">Open <Icon.chevron /></a>
          </div>
          {live
            ? <ConnectedVillagePreview client={access?.client ?? null} />
            : <MockVillagePreview childName={childName} />}

        </Surface>
      </aside>
    </section>
  )
}

/** Demo-only village cluster. Isolated so its `village` surface query runs ONLY in
 *  mock mode — live Today reads the authorized village through ConnectedVillagePreview
 *  (selected child), never this home-child background poll. */
function MockVillagePreview({ childName }: { childName: string }) {
  const village = useSurfaceData<VillageData>('village')
  const nodes = village.data?.frontendSnapshot.nodes ?? []
  if (village.loading && !village.data) return <div className="fg-skel-cluster" aria-hidden><span /><span /><span /><span /></div>
  if (village.error) return <p className="fg-today-empty">No records are available to this view.</p>
  if (nodes.length === 0) return <p className="fg-today-empty">The people around {childName} will gather here.</p>
  return (
    <>
      <div className="fg-today-cluster">
        {nodes.slice(0, 6).map((n) => (
          <Avatar key={n.person.id} name={n.person.displayName} personId={n.person.id} kind={n.role === 'child' ? 'child' : 'adult'} size={40} title={n.person.displayName} />
        ))}
        {nodes.length > 6 ? <span className="fg-today-cluster-more">+{nodes.length - 6}</span> : null}
      </div>
      <p className="fg-today-village-count">{nodes.length} {nodes.length === 1 ? 'person' : 'people'} shared with you · sample</p>
    </>
  )
}

function ChildRow({ child, current, sample }: { child: ChildAccess; current?: boolean; sample?: boolean }) {
  const name = child.displayName ?? 'Name not shared'
  return (
    <div className="fg-childrow">
      <Avatar name={child.displayName ?? "·"} personId={child.id} kind="child" size={42} />
      <div className="fg-childrow-body">
        <div className="fg-childrow-name">
          <strong>{name}</strong>
          {current ? <StatusChip tone="neutral" icon={false}>Current view</StatusChip> : null}
          {sample ? <StatusChip tone="simulated" icon={false}>Sample</StatusChip> : null}
        </div>
        {child.scopes.length > 0 ? (
          <details className="fg-childrow-scopes">
            <summary><span>{child.scopes.length} {child.scopes.length === 1 ? 'area' : 'areas'} shared</span><span className="fg-childrow-scopes-view">View</span></summary>
            <div className="fg-childrow-scopelist">
              {child.scopes.map((s) => <span key={s} className="fg-scope-tag">{scopeLabel(s)}</span>)}
            </div>
          </details>
        ) : sample ? null : (
          <span className="fg-childrow-noscope">No shared access recorded</span>
        )}
      </div>
    </div>
  )
}
