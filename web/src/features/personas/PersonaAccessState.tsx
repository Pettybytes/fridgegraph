import type { ReactNode } from 'react'
import { useSession } from './Session'
export function PersonaAccessState({ surface, actions }: { surface: 'pickup' | 'village'; actions?: ReactNode }) {
  const { session, switchPerson } = useSession()
  if (!session) return null
  const child = session.scope.childName.split(' ')[0]
  const grants = session.persona.grants
  const shared = [grants.includes('schedule.read') && 'schedule', grants.includes('careplan.read') && 'care information', grants.includes('goals.read') && 'goals'].filter(Boolean) as string[]
  const list = shared.length < 2 ? shared[0] : `${shared.slice(0, -1).join(', ')} and ${shared.at(-1)}`
  return <section className="persona-access-state" role="alert" data-state="derived">
    <h2>{surface === 'pickup' ? `Pickup plans are shared with ${child}'s parents.` : `This village view is shared with ${child}'s parents.`}</h2>
    <p>{shared.length ? `You can see ${child}'s ${list}.` : 'Your account only shows information shared with you.'}</p>
    {grants.includes('schedule.read') && <p className="persona-access-note">The schedule screen isn’t available here yet.</p>}
    {actions ?? <div className="persona-access-actions">{grants.includes('careplan.read') && <a className="persona-access-card" href="#/care-information">Open care information</a>}<button type="button" className="persona-access-card" onClick={() => { void switchPerson() }}>Choose another person</button></div>}
  </section>
}
