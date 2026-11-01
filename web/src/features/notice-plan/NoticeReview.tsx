import {useEffect,useRef,useState} from 'react'
import {Button} from '@/components/ui/button'
import type {NoticeConfirmResult,NoticeProposal} from './types'
export function NoticeReview({proposal,submittedText,busy,canConfirm=false,confirmDisabled=false,confirmed=null,onConfirm,onAnswer}:{proposal:NoticeProposal;submittedText:string|null;busy:boolean;canConfirm?:boolean;confirmDisabled?:boolean;confirmed?:NoticeConfirmResult|null;onConfirm?:()=>void;onAnswer:(answer:string)=>void}){
 const [answer,setAnswer]=useState(''),review=useRef<HTMLElement>(null)
 useEffect(()=>{review.current?.scrollIntoView?.({block:'start',behavior:'instant'})},[proposal.proposalId,proposal.version])
 const normalize=(s:string)=>s.replace(/\s+/g,' ').trim()
 const actionChange=proposal.changes.find(change=>'action' in change.onConfirm)
 const confirmAction=actionChange?.onConfirm
 const sourceVerified=actionChange?.source.type==='transcription'||(actionChange?.source.type==='verified_quote'&&submittedText!==null&&normalize(actionChange.source.quote).length>0&&normalize(submittedText).includes(normalize(actionChange.source.quote)))
 const matchingAction=sourceVerified&&confirmAction&&'action' in confirmAction&&confirmAction.action==='requestPickup'&&proposal.claims.action==='requestPickup'&&proposal.claims.params&&JSON.stringify(proposal.claims.params)===JSON.stringify(confirmAction.params)&&proposal.claims.proposalId===proposal.proposalId&&proposal.claims.version===proposal.version&&proposal.claims.childId===proposal.childId
 return <section ref={review} className="notice-review" aria-label="Review proposed changes">
  <h3>Review proposed changes</h3><p>Mock review · No records created</p>
  <p>Dates use {proposal.scenario.referenceDate} · America/Detroit.</p>
  {proposal.clarification&&<div className="notice-question"><label htmlFor="notice-answer">{proposal.clarification.question}</label><input id="notice-answer" value={answer} onChange={e=>setAnswer(e.target.value)}/><Button className="notice-control" type="button" disabled={busy||!answer.trim()} onClick={()=>onAnswer(answer.trim())}>Answer and continue</Button></div>}
  {!proposal.changes.length&&!proposal.clarification&&<p>No proposed changes were returned.</p>}
  {proposal.changes.map((change,index)=>{
   const source=change.source,verified=source.type==='verified_quote'&&submittedText!==null&&normalize(source.quote).length>0&&normalize(submittedText).includes(normalize(source.quote))
   return <article key={index}><h4>{change.what}</h4>
    {source.type==='verified_quote'?verified?<><strong>Verified quote · pasted text</strong><blockquote>{source.quote}</blockquote></>:<p>Source passage could not be verified against your pasted text.</p>:<><strong>Transcribed from {source.ref==='pdf:p1'?'PDF · page 1':'image'}</strong><blockquote>{source.text}</blockquote>{source.ref==='pdf:p1'&&<p>Only page 1 is read in this version.</p>}</>}
    <dl><dt>Why it matters</dt><dd>{change.whyItMatters}</dd><dt>Who’s affected</dt><dd>{change.whoAffected}</dd><dt>What’s unknown</dt><dd>{change.unknown.length?<ul>{change.unknown.map((item,i)=><li key={i}>{item}</li>)}</ul>:'No unknowns reported.'}</dd><dt>What happens on confirm</dt><dd>{'action' in change.onConfirm&&change.onConfirm.action==='requestPickup'?`A mock pickup request for the ${change.onConfirm.params.window} window is shown. A parent would review and approve a candidate in Mission Control; the exact dismissal time is not stored in that request. No real record is created.`:'note' in change.onConfirm?change.onConfirm.note:'Noted, no action available.'}</dd></dl>
   </article>
  })}
  {matchingAction&&!proposal.clarification&&canConfirm&&!confirmed&&<Button className="notice-control" type="button" disabled={busy||confirmDisabled} onClick={onConfirm}>Confirm mock pickup request</Button>}
  {matchingAction&&!proposal.clarification&&!canConfirm&&!confirmed&&<p>Only Nora’s parent or guardian can confirm this pickup request.</p>}
  {confirmed&&<div role="status" className="notice-confirmed"><strong>Mock pickup request shown</strong><p>No real record was created, and pickup is not arranged yet.</p><a href="#/mission-control">View Mission Control</a></div>}
 </section>
}
