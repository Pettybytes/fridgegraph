import { gql, type ApolloClient } from '@apollo/client'
import { useEffect, useState } from 'react'
import { useChildAccess } from './childContext'
import { useSession } from './Session'
// Derived from the recorded demo care plan. No author metadata exists in today's record.
export const noraCareInformation = { text: 'Peanut allergy. Epi-pen in right backpack pocket.', source: "Nora's care plan" }
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
  if (session.scope.childId !== 'p_nora') return <section className="care-information" data-state="unavailable"><h2>No care information is available here yet</h2><p>Care information hasn’t been added to this demo view yet.</p></section>
  return <section className="care-information" aria-label="Care information" data-state="derived" data-source="mock"><h2>Care information for {childName}</h2><p>{noraCareInformation.text}</p><p>{sourceCitation(noraCareInformation.source)}</p></section>
}

const CARE_PLAN = gql`query WebCareInformation($childId: ID!) { carePlan(childId: $childId) { text } }`
type CarePlanState = {status:'loading'|'ready'|'empty'|'refused'|'error'; text?:string}
function LiveCareInformation({childId,childName,client,runRead}:{childId:string;childName:string;client:ApolloClient|null;runRead?:<T>(read:()=>Promise<T>)=>Promise<T>}) {
  const [state,setState]=useState<CarePlanState>({status:'loading'})
  useEffect(()=>{
    if(!client||!runRead){setState({status:'error'});return}
    let current=true
    const controller=new AbortController()
    void runRead(async()=>{
      const result=await client.query<{carePlan:{text:string}|null}>({query:CARE_PLAN,variables:{childId},fetchPolicy:'no-cache',context:{fetchOptions:{signal:controller.signal}}})
      return result.data?.carePlan ?? null
    }).then(plan=>{if(current)setState(plan?{status:'ready',text:plan.text}:{status:'empty'})},error=>{
      if(!current||controller.signal.aborted)return
      setState({status:/UNAUTHORIZED|UNAUTHENTICATED|FORBIDDEN|AUTH_ERROR/.test(error instanceof Error?error.message:'')?'refused':'error'})
    })
    return()=>{current=false;controller.abort()}
  },[client,childId,runRead])
  const firstName=childName.split(' ')[0]
  if(state.status==='loading')return <section className="care-information" role="status">Loading care information shared with you…</section>
  if(state.status==='refused')return <section className="care-information" role="alert">This isn't shared with you.</section>
  if(state.status==='error')return <section className="care-information" role="alert">Couldn't load this just now.</section>
  if(state.status==='empty')return <section className="care-information" data-state="empty">No records are available to this view.</section>
  return <section className="care-information" aria-label="Care information" data-state="live" data-source="live"><h2>Care information for {firstName}</h2><p>{state.text}</p><p>{sourceCitation(`${firstName}'s care plan`)}</p></section>
}
