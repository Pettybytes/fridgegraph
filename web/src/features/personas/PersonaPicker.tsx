import { ResetDemoControl } from './ResetDemoControl'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { FridgeMark } from '@/components/fg/FridgeMark'
import { personas, personaGroups, type Persona } from './auth'
import { useSession } from './Session'
import { Avatar, Icon, Surface, StatusChip, FgButton, Field } from '@/components/fg/primitives'
import { RosinaAvatar } from '@/components/fg/RosinaAvatar'
import './personas.css'
import './picker.css'

export function SandboxBanner() {
  return <p className="sandbox-banner">Demo village · outreach is limited to approved test responders.</p>
}

const GRANT_WORD: Record<string, string> = {
  'schedule.read': 'schedule', 'careplan.read': 'care information', 'goals.read': 'goals',
  'pickup.request': 'pickups', 'pickup.verify': 'pickups', 'supervise.request': 'supervision',
  'contacts.read': 'contacts', 'school.read': 'school', 'transport.read': 'transport',
  'school.report': 'school-day reporting',
}
const firstName = (full: string) => full.split(/\s+/)[0]
function relationship(p: Persona): string { return p.role.split('·')[0].trim() }
function canSee(p: Persona): string {
  if (p.guardian) return `Guardian · full view of ${firstName(p.childName)}’s care`
  if (p.parent) return `Parent · full view of ${firstName(p.childName)}’s village`
  const words = [...new Set(p.grants.map((g) => GRANT_WORD[g]).filter(Boolean))]
  if (words.length === 0) return `In ${firstName(p.childName)}’s village`
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
  return `Sees ${firstName(p.childName)}’s ${list}`
}

export function PersonaPicker() {
  const { switching, switchPerson, error, notice, createDemoFamily, families, authMode, unavailable, retryAt } = useSession()
  const [familyOpen, setFamilyOpen] = useState(false)
  const [familyError, setFamilyError] = useState('')
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget, values = new FormData(form)
    try { await createDemoFamily({ parentName: String(values.get('parentName')), childName: String(values.get('childName')) }); form.reset(); setFamilyError('') }
    catch (error) { setFamilyError(error instanceof Error ? error.message : 'Unable to create the demo family.') }
  }
  const byId = (id: string) => personas.find((p) => p.id === id)!
  const soon = (id: string) => unavailable.has(id as Persona['id'])
  const busy = (id: string) => (retryAt[id as Persona['id']] ?? 0) > Date.now()

  function Card({ p }: { p: Persona }) {
    const unavailableNow = soon(p.id)
    return (
      <button
        type="button" className="fg-pcard" disabled={switching || unavailableNow}
        aria-label={`Explore as ${p.name}`} onClick={() => { void switchPerson(p.id) }}
      >
        <Avatar name={p.name} personId={p.personId} kind="adult" size={44} />
        <span className="fg-pcard-body">
          <span className="fg-pcard-name">{p.name}</span>
          <span className="fg-pcard-rel">{relationship(p)}</span>
          <span className="fg-pcard-see">{unavailableNow ? 'Not set up in this demo yet' : busy(p.id) ? 'Busy, try again in a moment' : p.id === 'kendra' ? 'Try it as Kendra, the parent, and follow the checklist' : canSee(p)}</span>
        </span>
        <Icon.chevron className="fg-pcard-go" aria-hidden />
      </button>
    )
  }

  return (
    <main className="fg-picker">
      <header className="fg-picker-head">
        <a className="fg-picker-brand" href="#/"><FridgeMark size={26} aria-hidden="true" />FridgeGraph</a>
        <h1 className="fg-picker-title">The village it takes to raise a child, kept in one shared place.</h1>
        <p className="fg-picker-sub">Every person sees only what that family has shared with them. Choose a perspective to explore. No sign-in needed.</p>
        <div className="fg-picker-rosina">
          <RosinaAvatar state="ready" size={34} />
          <p>Rosina helps each person with exactly what they’re allowed to see, and never acts without a confirmation.</p>
        </div>
      </header>

      {error ? <p className="fg-picker-alert" role="alert">{error}</p> : null}
      {notice ? <p className="fg-picker-notice" role="status">{notice}</p> : null}

      <aside className="fg-picker-guide" aria-label="Demo guide entry">
        <h2 id="guide-heading" className="fg-picker-group-label">Start here</h2>
        <button
          type="button" className="fg-pcard fg-pcard-guide" disabled={switching || soon('demo-guide')}
          aria-label="Explore as the Demo guide" onClick={() => { void switchPerson('demo-guide') }}
        >
          <Avatar name="Demo guide" kind="adult" size={44} />
          <span className="fg-pcard-body">
            <span className="fg-pcard-name">Demo guide <StatusChip tone="simulated" icon={false}>Read-only</StatusChip></span>
            <span className="fg-pcard-rel">Every family in the demo · No real family would have this view.</span>
            <span className="fg-pcard-see">{soon('demo-guide') ? 'Not set up in this demo yet' : 'Explore (read-only). Browse everything, nothing changes.'}</span>
          </span>
          <Icon.chevron className="fg-pcard-go" aria-hidden />
        </button>
      </aside>

      <div className="fg-picker-groups">
        {personaGroups.map((group) => (
          <section key={group.id} className="fg-picker-group" aria-labelledby={`${group.id}-heading`}>
            <h2 id={`${group.id}-heading`} className="fg-picker-group-label">{group.label}</h2>
            <div className="fg-picker-grid">
              {group.personaIds.map((id) => <Card key={id} p={byId(id)} />)}
            </div>
          </section>
        ))}
      </div>

      {authMode === 'mock' ? (
        <Surface className="fg-picker-tools" aria-label="Demo tools">
          <div className="fg-picker-tools-head">
            <div><h2 className="fg-picker-group-label">Make it yours</h2><p>A demo family stays on this device and isn’t added to any village.</p></div>
            <div className="fg-picker-tools-actions">
              <FgButton variant="secondary" onClick={() => setFamilyOpen(!familyOpen)} disabled={switching} aria-expanded={familyOpen}>Create a demo family</FgButton>
              <ResetDemoControl />
            </div>
          </div>
          {familyOpen ? (
            <form className="fg-picker-family" onSubmit={create}>
              <Field label="Parent name" name="parentName" required maxLength={80} />
              <Field label="Child name" name="childName" required maxLength={80} />
              <FgButton variant="primary" type="submit" disabled={switching}>Create demo family</FgButton>
              {familyError ? <p className="fg-picker-alert" role="alert">{familyError}</p> : null}
              {families.map((f) => <p key={f.id} className="fg-picker-notice" role="status">{f.parentName} and {f.childName} · demo family created</p>)}
            </form>
          ) : null}
        </Surface>
      ) : null}
    </main>
  )
}

export function SessionChip() {
  const { session, switchPerson, authMode } = useSession()
  if (!session) return null
  return <div className="session-chip"><span>{authMode === 'live' ? 'Exploring as' : 'Signed in as'} {session.persona.name}</span><button type="button" onClick={() => { void switchPerson() }}>Switch {authMode === 'live' ? 'perspective' : 'person'}</button>{authMode === 'live' && <button type="button" onClick={() => { void switchPerson() }}>Leave perspective</button>}{session.marks?.demoGuide && <span>Demo guide is read-only</span>}<ResetDemoControl /></div>
}
