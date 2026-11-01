import {useEffect,useState} from 'react'
import {motion,useReducedMotion} from 'motion/react'
import {Check,Clock,Minus,X} from 'lucide-react'
import type {Alert} from '@/features/orbit/adapter'
import {formatInstant} from '@/features/calendar/time'
import {Portrait} from './Portrait'
import type {ActivityLedger} from './activityLedger'
import {VillageRings} from './VillageRings'
import type {VillageChild} from './types'
import './signature.css'
const labels:Record<string,string>={ON_WAY:'On my way',CANNOT_HELP:"Can't help",WITH_ME:'Reported “With me”'}
export function OrbitRollCall({alert,parent,personId,ledger,portraitFor,child}:{alert:Alert;parent:boolean;personId:string;ledger:ActivityLedger;portraitFor?:(id:string)=>string|undefined;child?:VillageChild}){
 const reduce=useReducedMotion(),[fresh,setFresh]=useState<string[]>([])
 const responses=parent?alert.latestResponses:alert.latestResponses.filter(response=>response.person.id===personId)
 const audience=parent?alert.audience:alert.audience.filter(member=>member.person.id===personId)
 const keys=responses.map(response=>`${alert.id}:${response.person.id}:${response.respondedAt}:${response.response}`)
 const keySignature=JSON.stringify(keys)
 useEffect(()=>{setFresh(ledger.observe(keys));const timer=setTimeout(()=>setFresh([]),700);return()=>clearTimeout(timer)},[ledger,keySignature])
 return <section className="sg-rollcall" aria-label={parent?'Frozen Orbit audience':'Your Orbit response'} data-state="live" data-active={alert.status==='ACTIVE'}><header><div><h3>{parent?'Your village, responding':'Your response'}</h3><p>{parent?'This audience was recorded when you activated Orbit.':'Only your own response is shared in this view.'}</p></div>{(!parent||!child)&&<span className="sg-simulation">Simulated notification</span>}</header>
  {parent&&child?<VillageRings variant="orbit" child={child} people={audience.map(member=>{const response=responses.find(entry=>entry.person.id===member.person.id),name=member.person.displayName??response?.person.displayName??'Name not shared',key=response?`${alert.id}:${response.person.id}:${response.respondedAt}:${response.response}`:'';return {id:member.person.id,name,portraitSrc:name==='Name not shared'?undefined:portraitFor?.(member.person.id),group:'Frozen audience',relationship:'Recorded Orbit audience',response:{kind:response?.response??'NONE',label:response?labels[response.response]??'Response not recognized':member.eligible?'No response recorded':'Not included in notifications',at:response?.respondedAt,fresh:fresh.includes(key)}}})}/>:<ul>{audience.map(member=>{const response=responses.find(entry=>entry.person.id===member.person.id),name=member.person.displayName??response?.person.displayName??'Name not shared',key=response?`${alert.id}:${response.person.id}:${response.respondedAt}:${response.response}`:'';const Icon=response?.response==='WITH_ME'?Check:response?.response==='ON_WAY'?Clock:response?.response==='CANNOT_HELP'?X:Minus
   return <motion.li key={member.person.id} initial={false} animate={{opacity:!reduce&&fresh.includes(key)?[.55,1]:1}} transition={{duration:.36}} data-response={response?.response??'NONE'}><Portrait name={name} src={name==='Name not shared'?undefined:portraitFor?.(member.person.id)}/><div><strong>{name}</strong><span className="sg-response-state"><Icon size={16}/>{response?labels[response.response]??'Response not recognized':member.eligible?'No response recorded':'Not included in notifications'}</span>{response&&<time dateTime={response.respondedAt}>{formatInstant(response.respondedAt)}</time>}</div></motion.li>})}</ul>}
  {!audience.length&&<p>No audience records are shared with this view.</p>}
  {responses.some(response=>response.response==='WITH_ME')&&<p className="sg-report-note">“With me” is a report from a village member. Only the parent closes Orbit.</p>}
 </section>
}
