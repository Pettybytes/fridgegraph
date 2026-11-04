import { gql, type ApolloClient } from '@apollo/client'
import { useCallback, useState } from 'react'
import { useCachedResource, storeResource, invalidateResources } from '@/lib/frontendData/resourceCache'
import {FgButton} from '@/components/fg/primitives'
import './care-plan-edit.css'
import { RouteSkeleton } from '@/app/RouteSkeleton'
import { useChildAccess } from './childContext'
import { useSession } from './Session'
// Derived from the recorded demo care plans. No author metadata exists in today's records.
export const noraCareInformation = { text: 'Peanut allergy. Epi-pen in right backpack pocket.', source: "Nora's care plan" }
/** Sample care plans per child — mirrors the seeded care_plans rows so the mock view and the
 *  mock Rosina adapter answer for every demo family, not only Nora's (QA pristine item 8). */
export const sampleCareInformation: Record<string, { text: string; source: string; peanut: boolean }> = {
  p_nora: { ...noraCareInformation, peanut: true },
  p_jax: { text: 'Mild asthma. Inhaler in the front pocket of the school bag.', source: "Jax's care plan", peanut: false },
  p_emma: { text: 'No known allergies. Glasses for reading — spare pair in the front pouch.', source: "Emma's care plan", peanut: false },
  p_malik: { text: 'Peanut allergy. Epi-pen in the left backpack pocket; the school office has a second.', source: "Malik's care plan", peanut: true },
}
export function sourceCitation(title: string, author?: string | null): string {
  return `Source: ${title}${author ? `, added by ${author}` : ''}`
}
export function CareInformation() {
  const { session, authMode } = useSession()
  const access = useChildAccess()
  if (!session) return null
  if (authMode === 'live') return <LiveCareInformation key={`${session.generation}:${access?.selectedChildId ?? session.scope.childId}`} childId={access?.selectedChildId ?? session.scope.childId} childName={access?.selectedChildName ?? session.scope.childName} client={access?.client ?? null} runRead={access?.runRead} />
  const childName = session.scope.childName.split(' ')[0]
  if (!session.persona.parent && !session.persona.guardian && !session.persona.grants.includes('careplan.read')) return <section className="care-information" role="alert"><h2>Care information hasn’t been shared with you</h2><p>{childName}'s parents choose who can see their care information.</p></section>
  const sample = sampleCareInformation[session.scope.childId]
  if (!sample) return <section className="care-information" data-state="empty"><h2>Care information for {childName}</h2><p>{childName}'s parents haven't added a care plan to this sample view. Open the live demo for the recorded details.</p></section>
  return <section className="care-information" aria-label="Care information" data-state="derived" data-source="mock"><h2>Care information for {childName}</h2><p>{sample.text}</p><p>{sourceCitation(sample.source)}</p></section>
}

export const CARE_PLAN = gql`query WebCareInformation($childId: ID!) { carePlan(childId: $childId) { text } careFacts(childId: $childId) { id key value source { kind ref } } }`
type CarePlanState = {status:'loading'|'ready'|'empty'|'refused'|'error'; text?:string; facts?:{id:string;key:string;value:string;source:{kind:string;ref:string}}[]}
export async function readCareInformation(client:ApolloClient|null,childId:string,runRead?:<T>(read:()=>Promise<T>)=>Promise<T>){
  if(!client||!runRead)throw Error('READ_UNAVAILABLE')
  return runRead(async()=>{
    const result=await client.query<{carePlan:{text:string}|null;careFacts?:NonNullable<CarePlanState['facts']>}>({query:CARE_PLAN,variables:{childId},fetchPolicy:'network-only'})
    return {plan:result.data?.carePlan??null,facts:result.data?.careFacts??[]}
  })
}
function LiveCareInformation({childId,childName,client,runRead}:{childId:string;childName:string;client:ApolloClient|null;runRead?:<T>(read:()=>Promise<T>)=>Promise<T>}) {
  const {session}=useSession()
  const canEdit=!!session&&(session.persona.parent||session.persona.guardian===true)&&(!session.marks?.demoGuide||session.marks.showcaseEditor===true)
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState(''),[saving,setSaving]=useState(false),[saveMessage,setSaveMessage]=useState('')
  async function save(){
    if(!client||!runRead||!canEdit||saving||!draft.trim())return
    setSaving(true);setSaveMessage('')
    try {
      const result=await client.mutate<{updateCarePlan:{text:string}}>({mutation:gql`mutation WebUpdateCarePlan($childId:ID!,$text:String!){updateCarePlan(childId:$childId,text:$text){text}}`,variables:{childId,text:draft}})
      if(!result.data?.updateCarePlan)throw Error('Missing receipt')
      invalidateResources(client);storeResource(client,`care:${childId}`,{plan:result.data.updateCarePlan,facts:state.facts??[]});window.dispatchEvent(new Event('frontend:changed'));setEditing(false);setSaveMessage('Care plan saved.')
    }catch{setSaveMessage('Care plan was not saved. Try again.')}finally{setSaving(false)}
  }
  const load=useCallback(()=>readCareInformation(client,childId,runRead),[client,childId,runRead])
  const cached=useCachedResource(client,`care:${childId}`,load,2500)
  const state:CarePlanState=!client?{status:'error'}:cached?.error?{status:/UNAUTHORIZED|UNAUTHENTICATED|FORBIDDEN|AUTH_ERROR/.test(cached.error)?'refused':'error'}:!cached?{status:'loading'}:cached.value&&(cached.value.plan||cached.value.facts.length)?{status:'ready',text:cached.value.plan?.text,facts:cached.value.facts}:{status:'empty'}
  const firstName=childName.split(' ')[0]
  if(state.status==='loading')return <RouteSkeleton />
  if(state.status==='refused')return <section className="care-information" role="alert">This isn't shared with you.</section>
  if(state.status==='error')return <section className="care-information" role="alert">Couldn't load this just now.</section>
  if(state.status==='empty'&&!canEdit)return <section className="care-information" data-state="empty">No records are available to this view.</section>
  return <section className="care-information" aria-label="Care information" data-state="live" data-source="live"><h2>Care information for {firstName}</h2><p>{state.text}</p>{!!state.facts?.length&&<dl>{state.facts.map(fact=><div key={fact.id}><dt>{fact.key.replaceAll('_',' ')}</dt><dd>{fact.value}<p>Source: {fact.source.kind.replaceAll('_',' ')} · {fact.source.ref}</p></dd></div>)}</dl>}<p>{sourceCitation(`${firstName}'s care plan`)}</p>
    {canEdit&&(editing?<form className="care-plan-edit" onSubmit={event=>{event.preventDefault();void save()}}>
      <label>Care plan<textarea value={draft} maxLength={10000} required onChange={event=>setDraft(event.target.value)} disabled={saving}/></label>
      <p>Saving replaces the care plan shared with this child's authorized caregivers.</p>
      <FgButton type="submit" disabled={saving||!draft.trim()}>{saving?'Saving…':'Save care plan'}</FgButton>
      <FgButton type="button" variant="secondary" disabled={saving} onClick={()=>setEditing(false)}>Cancel</FgButton>
    </form>:<FgButton type="button" onClick={()=>{setDraft(state.text??'');setEditing(true);setSaveMessage('')}}>Edit care plan</FgButton>)}
    <p role="status">{saveMessage}</p>
  </section>
}
