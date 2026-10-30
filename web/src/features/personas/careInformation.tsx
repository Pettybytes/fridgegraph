import { useSession } from './Session'
// Derived from the recorded demo care plan. No author metadata exists in today's record.
export const noraCareInformation = { text: 'Peanut allergy. Epi-pen in right backpack pocket.', source: "Nora's care plan" }
export function sourceCitation(title: string, author?: string | null): string {
  return `Source: ${title}${author ? `, added by ${author}` : ''}`
}
export function CareInformation() {
  const { session } = useSession()
  if (!session) return null
  const childName = session.scope.childName.split(' ')[0]
  if (!session.persona.parent && !session.persona.guardian && !session.persona.grants.includes('careplan.read')) return <section className="care-information" role="alert"><h2>Care information hasn’t been shared with you</h2><p>{childName}'s parents choose who can see their care information.</p></section>
  if (session.scope.childId !== 'p_nora') return <section className="care-information" data-state="unavailable"><h2>No care information is available here yet</h2><p>Care information hasn’t been added to this demo view yet.</p></section>
  return <section className="care-information" aria-label="Care information" data-state="derived" data-source="mock"><h2>Care information for {childName}</h2><p>{noraCareInformation.text}</p><p>{sourceCitation(noraCareInformation.source)}</p></section>
}
