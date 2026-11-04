import {useEffect,useRef,useState} from 'react'
import type {ApolloClient} from '@apollo/client'
import {CREATE_EVENT,UPDATE_EVENT,DELETE_EVENT,type LiveEvent} from '@/features/calendar/liveAdapter'
import type {CalendarChangeArgs} from './catalog'
import {invalidateResources} from '@/lib/frontendData/resourceCache'
import {notifyCalendarChanged} from '@/features/calendar/changeSignal'
import {FgButton} from '@/components/fg/primitives'

export function calendarWallLabel(wall:string){
 return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(`${wall.slice(0,19)}Z`))
}
export function CalendarChangeCard({args,client,current,requestKey,saved,register,onSaved}:{args:CalendarChangeArgs;client:ApolloClient|null;current:boolean;requestKey?:string;saved?:boolean;register:(confirm:(()=>void)|null)=>void;onSaved:(text:string)=>void}){
 const key=useRef(requestKey??crypto.randomUUID()),inFlight=useRef(false),alive=useRef(true),controller=useRef<AbortController|null>(null),card=useRef<HTMLElement|null>(null)
 const [phase,setPhase]=useState<'review'|'saving'|'done'|'failed'|'stale'>('review')
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort()}},[])
 useEffect(()=>{if(current&&!saved)card.current?.scrollIntoView?.({block:'nearest',behavior:'instant'})},[current,saved])
 const label=args.operation==='create'?'Add to calendar':args.operation==='update'?'Confirm move':'Cancel event'
 async function confirm(){
  if(!current||!client||saved||inFlight.current||phase==='done')return
  inFlight.current=true;controller.current=new AbortController();setPhase('saving')
  const mutation=args.operation==='create'?CREATE_EVENT:args.operation==='update'?UPDATE_EVENT:DELETE_EVENT
  const field=args.operation==='create'?'createCalendarEvent':args.operation==='update'?'updateCalendarEvent':'deleteCalendarEvent'
  try{
   const result=await client.mutate<Record<string,LiveEvent|string>>({mutation,context:{fetchOptions:{signal:controller.current.signal}},variables:{...args,id:args.eventId,idempotencyKey:key.current}})
   const saved=result.data?.[field]
   if(!saved)throw Error('WRITE_UNCONFIRMED')
   if(!alive.current)return
   setPhase('done');register(null)
   invalidateResources(client);notifyCalendarChanged()
   const event=typeof saved==='object'?saved:args
   const verb=args.operation==='create'?'added':args.operation==='update'?'moved':'cancelled'
   onSaved(`Done: ${verb} ${event.title} for ${args.childName}. ${calendarWallLabel(event.start)} (America/Detroit).`)
  }catch(error){if(alive.current)setPhase(/CALENDAR_RECEIPT_STALE/.test(String(error))?'stale':'failed')}
  finally{inFlight.current=false}
 }
 useEffect(()=>{if(current&&!saved&&phase!=='done'&&phase!=='stale')register(()=>{void confirm()});else register(null);return()=>register(null)},[current,saved,phase,client])
 return <section ref={card} className="rosina-calendar-review" aria-label="Confirm calendar change">
  <h3>{args.title}</h3>
  <p>{args.childName}</p>
  <p><time dateTime={args.start}>{calendarWallLabel(args.start)}</time> to <time dateTime={args.end}>{args.start.slice(0,10)===args.end.slice(0,10)?new Intl.DateTimeFormat('en-US',{timeZone:'UTC',hour:'numeric',minute:'2-digit'}).format(new Date(`${args.end}Z`)):calendarWallLabel(args.end)}</time></p>
  <p>America/Detroit · {args.location||'No place specified'}</p>
  {args.operation==='delete'&&<p>This removes the event from the family calendar.</p>}
  {phase==='stale'&&<p role="alert">This event has changed since that request. Ask Rosina for a new proposal.</p>}
  {phase==='failed'&&<p role="alert">I couldn’t confirm the save. Retry checks the same request without making a duplicate.</p>}
  {saved||phase==='done'?<p role="status">Saved to the family calendar.</p>:current&&phase!=='stale'?<><FgButton disabled={!client||phase==='saving'} onClick={()=>{void confirm()}}>{phase==='saving'?'Saving…':phase==='failed'?'Retry confirmation':label}</FgButton><p>You can also reply “yes” to confirm this change.</p></>:<p>This proposal has been replaced.</p>}
 </section>
}
