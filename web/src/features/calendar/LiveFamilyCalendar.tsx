import {useEffect,useState} from 'react'
import {Dialog} from 'radix-ui'
import {ChevronLeft,ChevronRight,X} from 'lucide-react'
import type {LiveCalendarAdapter,LiveWindow,LiveEvent,ReadOutcome,EffectiveCare,Availability} from './liveAdapter'
import {outcomeCopy} from './liveAdapter'
import {addDays,dayHours,formatDay,formatInstant,intersects,localDay,midnight,segmentLabel,validDay,weekStart} from './time'
import './calendar.css'
const eventStatus=(status:string)=>status==='proposed'?'Proposed':status==='confirmed'?'Confirmed':status==='cancelled'?'Cancelled':'Status not recorded'
export function careLabel(result:ReadOutcome<EffectiveCare>){
 if(result.state!=='ready')return outcomeCopy[result.state]
 if(!result.value.parent)return outcomeCopy.empty
 const name=result.value.parent.displayName.split(' ')[0]
 return result.value.source==='ARRANGEMENT'?`Approved arrangement: scheduled with ${name}`:result.value.source==='WEEKLY'?`Scheduled with ${name}`:'Schedule source not recorded'
}
function Outcome({result,empty}:{result:ReadOutcome<unknown[]>;empty?:boolean}){return <p className="cal-no-events" role={result.state==='failed'?'alert':undefined}>{result.state==='ready'?(empty?outcomeCopy.empty:null):outcomeCopy[result.state]}</p>}
export function LiveFamilyCalendar({adapter}:{adapter:LiveCalendarAdapter}){
 const [route,setRoute]=useState(location.hash),[cancelled,setCancelled]=useState(false)
 const [loaded,setLoaded]=useState<{adapter:LiveCalendarAdapter;key:string;value:LiveWindow}|null>(null),[failed,setFailed]=useState('')
 const [availabilityDetail,setAvailabilityDetail]=useState<Availability|null>(null)
 const [selected,setSelected]=useState<LiveEvent|null>(null),[careDetail,setCareDetail]=useState<{day:string;care:ReadOutcome<EffectiveCare>}|null>(null)
 const query=new URLSearchParams(route.split('?')[1]??''),requested=query.get('day'),eventId=query.get('event')
 const known=eventId?adapter.knownEvent(eventId):undefined
 const day=requested??(known?localDay(known.start):localDay(Date.now())),view=query.get('view')==='day'?'day':'week'
 const childId=query.get('childId')??(eventId?adapter.knownChild(eventId):undefined)??adapter.scope.childId,from=validDay(day)?view==='week'?weekStart(day):day:'',to=from?view==='week'?addDays(from,6):from:''
 const key=`${route}:${cancelled}`,current=loaded?.adapter===adapter&&loaded.key===key?loaded.value:null
 useEffect(()=>{const follow=()=>{setRoute(location.hash);setSelected(null);setCareDetail(null);setAvailabilityDetail(null)};window.addEventListener('hashchange',follow);return()=>window.removeEventListener('hashchange',follow)},[])
 useEffect(()=>{
  let active=true,refused=false
  setSelected(null);setCareDetail(null);setAvailabilityDetail(null);setFailed('')
  if(!from){setFailed('Choose a valid calendar date.');return}
  const load=async()=>{try{const value=await adapter.readWindow({childId,from,to,includeCancelled:cancelled});if(active){setLoaded({adapter,key,value});refused=value.events.state==='refused';if(eventId)setSelected(value.events.state==='ready'?value.events.value.find(e=>e.id===eventId)??null:null)}}catch{if(active)setFailed(outcomeCopy.failed)}}
  void load();const timer=setInterval(()=>{if(!refused&&document.visibilityState!=='hidden')void load()},30000)
  return()=>{active=false;clearInterval(timer)}
 },[adapter,key,childId,from,to,cancelled,eventId])
 function navigate(nextDay:string,nextView=view){setSelected(null);setCareDetail(null);setAvailabilityDetail(null);const next=`#/calendar?day=${nextDay}&childId=${encodeURIComponent(childId)}&view=${nextView}`;setRoute(next);location.hash=next}
 if(failed)return <section className="cal-empty" role="alert"><p>{failed}</p></section>
 if(!current)return <p role="status">Loading your shared calendar…</p>
 if(current.events.state==='refused')return <section className="cal-empty" role="alert"><h2>{outcomeCopy.refused}</h2><p>This calendar is only shown to people with permission to read it.</p><a href="#/calendar">Return to your calendar</a></section>
 const slots=current.availability.state==='ready'?current.availability.value:[]
 const records=current.events.state==='ready'?current.events.value:[]
 const conflicts=current.conflicts.state==='ready'?current.conflicts.value:[]
 return <section className="family-calendar cal-live" aria-label="Family Calendar" data-state="live">
  <div className="cal-toolbar"><div className="cal-child"><strong>{childId===adapter.scope.childId?adapter.scope.childName:'Selected child'}</strong><span className="cal-authority">Live data</span></div><div className="cal-view"><button aria-pressed={view==='week'} onClick={()=>navigate(day,'week')}>Week</button><button aria-pressed={view==='day'} onClick={()=>navigate(day,'day')}>Day</button></div></div>
  <div className="cal-period"><div><p>Detroit time</p><h2>{formatDay(from)}{view==='week'?` – ${formatDay(to)}`:''}, {from.slice(0,4)}</h2></div><div className="cal-date-controls"><button aria-label={`Previous ${view}`} onClick={()=>navigate(addDays(day,view==='week'?-7:-1))}><ChevronLeft size={19}/></button><input type="date" aria-label="Calendar date" value={day} onChange={e=>{if(validDay(e.target.value))navigate(e.target.value)}}/><button aria-label={`Next ${view}`} onClick={()=>navigate(addDays(day,view==='week'?7:1))}><ChevronRight size={19}/></button></div></div>
  <div className="cal-live-key"><p>A care schedule describes responsibility, not a confirmed location.</p><label><input type="checkbox" checked={cancelled} onChange={e=>setCancelled(e.target.checked)}/> Show cancelled events</label></div>
  {eventId&&!selected&&<p className="cal-attention">Event details are not available in the records read for this view.</p>}
  <p className="cal-unavailable" data-state="unavailable">School-closure information isn’t available in this view.</p>
  <div className="cal-board"><div className={`cal-days ${view==='day'?'is-day':''}`}>{current.days.map(date=>{
   const care=current.care[date],events=records.filter(e=>intersects(e.start,e.end,midnight(date),midnight(addDays(date,1)))),busy=slots.filter(e=>intersects(e.start,e.end,midnight(date),midnight(addDays(date,1))))
   const problems=conflicts.filter(c=>c.onDay===date)
   return <section className="cal-day" key={date} role="region" aria-label={`${formatDay(date,true)} day`}><header className="cal-day-heading"><button onClick={()=>navigate(date,'day')}>{formatDay(date)}</button>{dayHours(date)!==24&&<small>{dayHours(date)}-hour day · clocks change</small>}</header>
    <button className={`cal-care ${care.state==='ready'&&care.value.source==='ARRANGEMENT'?'is-holiday':''}`} onClick={()=>setCareDetail({day:date,care})}>{careLabel(care)}</button>
    {care.state==='ready'&&care.value.parent&&<span className="cal-schedule-source">{care.value.source==='WEEKLY'?'Weekly schedule':care.value.source==='ARRANGEMENT'?'Approved arrangement':'Source not recorded'}</span>}
    {problems.map((p,i)=><p className="cal-attention" key={i}>{p.kind==='OVERLAP'?'Schedule needs review · overlapping arrangements':p.kind==='GAP'?'Needs coverage · no care schedule recorded':'Schedule needs review'}</p>)}
    <div className="cal-events">{events.map(event=><button key={event.id} className={`cal-event ${event.status==='proposed'?'is-proposed':event.status==='cancelled'?'is-cancelled':''}`} onClick={()=>setSelected(event)}><strong>{event.title}</strong><span className="cal-time">{segmentLabel(event.start,event.end,date)}</span><span className="cal-event-status">{eventStatus(event.status)}</span>{event.status==='proposed'&&<span className="cal-attention">Unconfirmed</span>}</button>)}{!events.length&&<Outcome result={current.events} empty/>}</div>
    <div className="cal-busy-list"><h3>Recorded Busy/Free time</h3>{busy.map((slot,i)=><button type="button" className={`cal-busy ${slot.state==='FREE'?'is-free':''}`} key={i} onClick={()=>setAvailabilityDetail(slot)}><span>{slot.person.displayName} · {slot.state==='FREE'?'free time recorded':slot.state==='BUSY'?'Busy':'State not recorded'}</span><small>{segmentLabel(slot.start,slot.end,date)}</small></button>)}{!busy.length&&<Outcome result={current.availability} empty/>}</div>
   </section>
  })}</div></div>
  <section className="cal-conflicts"><h3>Schedule conflicts</h3><Outcome result={current.conflicts} empty={!conflicts.length}/>{!!conflicts.length&&<p>Overlaps and gaps are shown on the affected days. No arrangement is chosen here to resolve a conflict.</p>}</section>
  <p className="cal-footnote">Free time recorded does not mean willingness, permission or suitability to provide care.</p>
  <Dialog.Root open={!!selected||!!careDetail||!!availabilityDetail} onOpenChange={value=>{if(!value){setSelected(null);setCareDetail(null);setAvailabilityDetail(null)}}}><Dialog.Portal><Dialog.Overlay className="cal-overlay"/><Dialog.Content className="cal-sheet"><Dialog.Title>{selected?.title??(availabilityDetail?availabilityDetail.state==='FREE'?'Free time recorded':'Busy':careDetail?careLabel(careDetail.care):'Calendar record')}</Dialog.Title><Dialog.Description>Only recorded information shared with you is shown.</Dialog.Description><Dialog.Close className="cal-close" aria-label="Close details"><X size={20}/></Dialog.Close>
   {availabilityDetail?<dl><dt>Who</dt><dd>{availabilityDetail.person.displayName}</dd><dt>State</dt><dd>{availabilityDetail.state==='FREE'?'Free time recorded':'Busy'}</dd><dt>Starts</dt><dd>{formatInstant(availabilityDetail.start,availabilityDetail.end)}</dd><dt>Ends</dt><dd>{formatInstant(availabilityDetail.end,availabilityDetail.start)}</dd></dl>:selected?<dl><dt>Who</dt><dd>{childId===adapter.scope.childId?adapter.scope.childName:'Participant names not recorded'}</dd><dt>Starts</dt><dd>{formatInstant(selected.start,selected.end)}</dd><dt>Ends</dt><dd>{formatInstant(selected.end,selected.start)}</dd><dt>Where</dt><dd>{selected.location??'Location not provided'}</dd><dt>Status</dt><dd>{eventStatus(selected.status)}</dd><dt>Category</dt><dd>Category not recorded</dd><dt>Confirmed by</dt><dd>{selected.status==='proposed'?'Not confirmed yet':'Confirmer not recorded'}</dd><dt>Linked records</dt><dd>Linked records are not available in this view</dd></dl>:careDetail?<><p>{formatDay(careDetail.day,true)}, {careDetail.day.slice(0,4)}</p><p>{careLabel(careDetail.care)}</p>{careDetail.care.state==='ready'&&<p>{careDetail.care.value.source==='ARRANGEMENT'?'An approved arrangement takes precedence over the weekly schedule for this day.':careDetail.care.value.source==='WEEKLY'?'This answer comes from the weekly schedule.':'Schedule source not recorded'}</p>}<p>This is scheduled responsibility, not a confirmed location.</p></>:null}
  </Dialog.Content></Dialog.Portal></Dialog.Root>
 </section>
}
