import {useEffect,useRef,useState} from 'react'
import {Button} from '@/components/ui/button'
import type {NoticeProposal} from './types'
export function NoticeReview({proposal,submittedText,busy,onAnswer}:{proposal:NoticeProposal;submittedText:string|null;busy:boolean;onAnswer:(answer:string)=>void}){
 const [answer,setAnswer]=useState(''),review=useRef<HTMLElement>(null)
 useEffect(()=>{review.current?.scrollIntoView?.({block:'start',behavior:'instant'})},[proposal.proposalId,proposal.version])
 const normalize=(s:string)=>s.replace(/\s+/g,' ').trim()
 return <section ref={review} className="notice-review" aria-label="Review proposed changes">
  <h3>Review proposed changes</h3><p>Mock review · No records created</p>
  <p>Dates use {proposal.scenario.referenceDate} · America/Detroit.</p>
  {proposal.clarification&&<div className="notice-question"><label htmlFor="notice-answer">{proposal.clarification.question}</label><input id="notice-answer" value={answer} onChange={e=>setAnswer(e.target.value)}/><Button className="notice-control" type="button" disabled={busy||!answer.trim()} onClick={()=>onAnswer(answer.trim())}>Answer and continue</Button></div>}
  {!proposal.changes.length&&!proposal.clarification&&<p>No proposed changes were returned.</p>}
  {proposal.changes.map((change,index)=>{
   const source=change.source,verified=source.type==='verified_quote'&&submittedText!==null&&normalize(source.quote).length>0&&normalize(submittedText).includes(normalize(source.quote))
   return <article key={index}><h4>{change.what}</h4>
    {source.type==='verified_quote'?verified?<><strong>Verified quote · pasted text</strong><blockquote>{source.quote}</blockquote></>:<p>Source passage could not be verified against your pasted text.</p>:<><strong>Transcribed from {source.ref==='pdf:p1'?'PDF · page 1':'image'}</strong><blockquote>{source.text}</blockquote>{source.ref==='pdf:p1'&&<p>Only page 1 is read in this version.</p>}</>}
    <dl><dt>Why it matters</dt><dd>{change.whyItMatters}</dd><dt>Who’s affected</dt><dd>{change.whoAffected}</dd><dt>What’s unknown</dt><dd>{change.unknown.length?<ul>{change.unknown.map((item,i)=><li key={i}>{item}</li>)}</ul>:'No unknowns reported.'}</dd><dt>What happens on confirm</dt><dd>{change.onConfirm.available?'Confirmation isn’t connected yet. Nothing will be created.':change.onConfirm.note}</dd></dl>
   </article>
  })}
 </section>
}
