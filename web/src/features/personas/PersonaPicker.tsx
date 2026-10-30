import { useState } from 'react'
import type { FormEvent } from 'react'
import { Sprout, ArrowUpRight } from 'lucide-react'
import { personas, personaGroups } from './auth'
import { useSession } from './Session'
import './personas.css'
export function SandboxBanner() { return <p className="sandbox-banner">Demo village. Calls and texts go to test responders.</p> }
export function PersonaPicker() {
  const { switching, switchPerson, error, resetDemo, createDemoFamily, families } = useSession()
  const [familyOpen, setFamilyOpen] = useState(false)
  const [familyError, setFamilyError] = useState('')
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget, values = new FormData(form)
    try { await createDemoFamily({ parentName: String(values.get('parentName')), childName: String(values.get('childName')) }); form.reset(); setFamilyError('') }
    catch (error) { setFamilyError(error instanceof Error ? error.message : 'Unable to create the mock family.') }
  }
  return <main className="persona-entry">
    <a className="persona-brand" href="#/"><Sprout aria-hidden="true" />FridgeGraph</a>
    <div className="persona-intro"><h1>Try FridgeGraph as…</h1><p>One village, different responsibilities.<br />Choose someone to see care from their side.</p><span className="persona-mock">Fictional people · demo experience</span></div>
    {switching && <p role="status">Clearing the previous session and loading your village…</p>}
    {error && <p role="alert">{error}</p>}
    {personaGroups.map(group => <section key={group.id} className="persona-group" aria-labelledby={`${group.id}-heading`}><h2 id={`${group.id}-heading`}>{group.label}</h2><div className="persona-grid">{group.personaIds.map(id => {
      const index = personas.findIndex(person => person.id === id), person = personas[index]
      return <button type="button" key={person.id} disabled={switching} onClick={() => { void switchPerson(person.id) }} className={`persona-card persona-tone-${index}`}><span className="persona-portrait" aria-hidden="true"><span className="persona-initial">{person.id === 'jax-family' ? 'R' : person.name[0]}</span></span><span><strong>{person.name}</strong><small>{person.role}</small></span><ArrowUpRight aria-hidden="true" size={20} /></button>
    })}</div></section>)}
    <div className="persona-tools"><button type="button" disabled={switching} onClick={() => setFamilyOpen(!familyOpen)}>Create a demo family</button><button type="button" disabled={switching} onClick={() => { void resetDemo() }}>Reset demo</button></div>
    {familyOpen && <section className="demo-family"><h2>Create a demo family</h2><p>Demo only. This family stays on this device and isn’t added to the village.</p><form onSubmit={create}><label>Parent name<input name="parentName" required maxLength={80} /></label><label>Child name<input name="childName" required maxLength={80} /></label><button type="submit" disabled={switching}>Create demo family</button></form>{familyError && <p role="alert">{familyError}</p>}{families.map(family => <p key={family.id} role="status">{family.parentName} and {family.childName} · demo family created</p>)}</section>}
  </main>
}
export function SessionChip() {
  const { session, switchPerson, resetDemo } = useSession()
  if (!session) return null
  return <div className="session-chip"><span>Signed in as {session.persona.name}</span><button type="button" onClick={() => { void switchPerson() }}>Switch person</button><button type="button" onClick={() => { void resetDemo() }}>Reset demo</button></div>
}
