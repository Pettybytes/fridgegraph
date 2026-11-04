import {Suspense,lazy,useEffect,useId,useLayoutEffect,useRef,useState,type CSSProperties} from 'react'
import {createPortal} from 'react-dom'
import {motion,useReducedMotion} from 'motion/react'
import {ArrowUpRight,X,Users,Network,Check,Clock,Minus} from 'lucide-react'
import type {VillageRingsProps,VillagePerson} from './types'
import {orderedPeople,concentricLayout} from './layout'
import {Portrait} from './Portrait'
import {formatInstant} from '@/features/calendar/time'
import {DadStatusChip} from '@/features/shared-status/DadStatusChip'
import './signature.css'
/** Showcase-profile facts load lazily so their fictional seed text stays out of the main bundle. */
const ProfileFacts=lazy(()=>import('./ProfileFacts'))
export function VillageRings({child,people,variant='full',selectedPersonId,onSelectPerson,onOpenVillage}:VillageRingsProps){
 const root=useRef<HTMLElement|null>(null),[narrow,setNarrow]=useState(()=>typeof window!=='undefined'&&window.innerWidth<=540)
 useLayoutEffect(()=>{const element=root.current;if(!element||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(([entry])=>setNarrow(entry.contentRect.width<=540));observer.observe(element);return()=>observer.disconnect()},[])
 const entered=useRef<string|null>(null),isEntry=entered.current!==child.id
 useEffect(()=>{entered.current=child.id},[child.id])
 const reduced=useReducedMotion(),detailId=useId(),buttons=useRef(new Map<string,HTMLButtonElement>()),keyboard=useRef(false),detail=useRef<HTMLElement|null>(null)
 const [selection,setSelection]=useState<string|null>(null),[expanded,setExpanded]=useState<number|null>(null),[list,setList]=useState(false)
 const sorted=orderedPeople(people),compact=variant==='compact'
 const composition=concentricLayout(sorted,narrow,compact,variant==='orbit')
 const visible=composition.nodes.map(node=>node.person)
 const slots=composition.nodes
 const selected=sorted.find(person=>person.id===(selectedPersonId===undefined?selection:selectedPersonId))
 function choose(person:VillagePerson){setSelection(person.id);onSelectPerson?.(person)}
 function close(){if(selected)buttons.current.get(selected.id)?.focus();setSelection(null);onSelectPerson?.(null)}
 /* An open profile card also dismisses on outside press and on Escape wherever focus sits.
    Outside press keeps focus where the user pressed; Escape restores it to the person's portrait. */
 useEffect(()=>{
  if(!selected||variant==='orbit')return
  const selectedId=selected.id
  const onPointerDown=(event:PointerEvent)=>{const target=event.target as Node;if(detail.current?.contains(target))return;for(const button of buttons.current.values())if(button.contains(target))return;setSelection(null);onSelectPerson?.(null)}
  const onKeyDown=(event:KeyboardEvent)=>{if(event.key!=='Escape')return;buttons.current.get(selectedId)?.focus();setSelection(null);onSelectPerson?.(null)}
  document.addEventListener('pointerdown',onPointerDown);document.addEventListener('keydown',onKeyDown)
  return()=>{document.removeEventListener('pointerdown',onPointerDown);document.removeEventListener('keydown',onKeyDown)}
 },[selected,variant,onSelectPerson])
 const entrance=(index:number,central=false)=>({initial:reduced||!isEntry||variant==='orbit'?false:{opacity:0,transform:`translateY(${central?6:10}px) scale(.98)`},animate:{opacity:1,transform:'translateY(0px) scale(1)'},transition:{duration:central ? .28 : .36,delay:reduced||variant==='orbit'?0:central?0:.12+index*.045,ease:[.23,1,.32,1] as const}})
 return <section ref={root} className={`sg-village sg-${variant}`} onKeyDown={event=>{if(event.key==='Escape'&&selected){event.preventDefault();close()}else if(event.key==='Escape'&&expanded!==null){root.current?.querySelector<HTMLButtonElement>('.sg-overflow[aria-expanded=true]')?.focus();setExpanded(null)}}} aria-label={variant==='compact'?`${child.name}'s village preview`:`${child.name}'s village network`}>
  {!compact&&<div className="sg-tools"><div className="sg-ring-legend" aria-label="Relationship groups">{composition.rings.map(ring=><span key={ring.index}>{ring.label}</span>)}</div><button className="sg-view-toggle" type="button" aria-pressed={list} onClick={()=>setList(!list)}>{list?<Network size={18}/>:<Users size={18}/>} {list?'Network view':'List view'}</button></div>}
  {!list&&<div className="sg-overflow-controls">{composition.rings.filter(ring=>ring.overflow.length>0).map(ring=><button key={ring.index} className="sg-overflow" type="button" aria-expanded={expanded===ring.index} aria-controls={`${detailId}-overflow`} aria-label={`Show ${ring.overflow.length} more people in ${ring.label}`} onClick={()=>setExpanded(expanded===ring.index?null:ring.index)}>+{ring.overflow.length}<span>{ring.label}</span></button>)}</div>}
  {!list?<div className="sg-scene" data-narrow={narrow} style={{height:composition.height,transformOrigin:`50% ${composition.centerY/composition.height*100}%`}}><span className="sg-illumination" style={{top:`${composition.centerY/composition.height*100}%`}} aria-hidden="true"/>
   {variant==='orbit'&&<span className="sg-ring-notice">Simulated notification</span>}
   <svg className="sg-orbits" viewBox={`0 0 ${composition.width} ${composition.height}`} preserveAspectRatio="none" aria-hidden="true">{composition.rings.map(ring=><ellipse key={ring.index} cx={composition.width/2} cy={composition.centerY} rx={ring.rx} ry={ring.ry}/>)}</svg>
   <motion.figure className="sg-child" style={{top:`${composition.centerY/composition.height*100}%`}} key={child.id} {...entrance(0,true)}><Portrait name={child.name} src={child.portraitSrc}/><figcaption><strong>{child.name}</strong><span>{!compact?'Their village, as shared with you':'Their village'}</span></figcaption></motion.figure>
   {visible.map((person,index)=><motion.div className="sg-person" data-column={index%2===0?'left':'right'} data-response={person.response?.kind} data-fresh={person.response?.fresh||undefined} key={person.id} style={{left:`${slots[index].x}%`,top:`${slots[index].y}%`,'--sg-i':index} as CSSProperties} {...entrance(index)} animate={person.response?.fresh&&!reduced?{opacity:[.85,1],transform:'translateY(0px) scale(1)'}:{opacity:1,transform:'translateY(0px) scale(1)'}}><button type="button" ref={el=>{if(el)buttons.current.set(person.id,el);else buttons.current.delete(person.id)}} aria-label={`${person.name} ${person.response?.label??person.relationship}`} aria-expanded={selected?.id===person.id} aria-controls={detailId} onPointerDown={()=>{keyboard.current=false}} onKeyDown={event=>{keyboard.current=true;const delta=event.key==='ArrowRight'||event.key==='ArrowDown'?1:event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:0;if(delta){event.preventDefault();buttons.current.get(visible[(index+delta+visible.length)%visible.length].id)?.focus()}}} onClick={()=>choose(person)}><Portrait name={person.name} src={person.portraitSrc}/><span className="sg-person-name">{person.name}</span>{person.response?<motion.span className="sg-response-state" initial={false} animate={person.response.fresh&&!reduced?{opacity:[0,1],transform:['translateY(8px) scale(.94)','translateY(0px) scale(1)']}:{opacity:1,transform:'translateY(0px) scale(1)'}} transition={{duration:.48,ease:[.23,1,.32,1]}}>{person.response.kind==='WITH_ME'?<Check size={16}/>:person.response.kind==='ON_WAY'?<Clock size={16}/>:person.response.kind==='CANNOT_HELP'?<X size={16}/>:<Minus size={16}/>} {person.response.label}</motion.span>:<span className="sg-relationship">{person.relationship}</span>}{person.response?.at&&<time dateTime={person.response.at}>{formatInstant(person.response.at)}</time>}{person.authorityLabel&&<span className="sg-authority">{person.authorityLabel}</span>}</button></motion.div>)}

  </div>:<ul className="sg-list" aria-label="People shared with you">{sorted.map(person=><li key={person.id}><button type="button" ref={el=>{if(el)buttons.current.set(person.id,el);else buttons.current.delete(person.id)}} aria-label={`${person.name} ${person.response?.label??person.relationship}`} aria-expanded={selected?.id===person.id} aria-controls={detailId} onClick={()=>{keyboard.current=true;choose(person)}}><Portrait name={person.name} src={person.portraitSrc}/><span><strong>{person.name}</strong><span>{person.response?.label??person.relationship}</span>{person.response?.at&&<time dateTime={person.response.at}>{formatInstant(person.response.at)}</time>}</span>{person.authorityLabel&&<span>{person.authorityLabel}</span>}<ArrowUpRight size={18}/></button></li>)}</ul>}
  {people.length===0&&<p className="sg-empty">No records are available to this view.</p>}
  {(()=>{if(!selected)return null
   /* The full village floats the card above the page (portal: the container query on
      .sg-village makes it a containing block, so fixed positioning must escape it).
      Compact and orbit keep the inline docked aside unchanged. */
   const card=<motion.aside ref={detail} className={variant==='full'?'sg-detail sg-profile-card fg-glass':'sg-detail fg-glass'} id={detailId} aria-label="Selected person details" initial={reduced||keyboard.current?false:{opacity:0,transform:'translateY(8px)'}} animate={{opacity:1,transform:'translateY(0px)'}} transition={{duration:.18,ease:[.23,1,.32,1]}}><div className="sg-detail-heading"><Portrait name={selected.name} src={selected.portraitSrc}/><div><h3>{selected.name}</h3><p>{selected.relationship}</p><DadStatusChip personId={selected.id} sharedStatus={selected.sharedStatus} mode="mock" /></div><button type="button" aria-label="Close person details" onClick={close}><X size={20}/></button></div><Suspense fallback={null}><ProfileFacts personId={selected.id} childId={child.id} childName={child.name}/></Suspense>{selected.relationshipDetails?selected.relationshipDetails.map((record,index)=><p key={`${record.type}:${index}`}>{record.type}: {record.status.toLowerCase().replaceAll('_',' ')}</p>):selected.relationshipStatus&&<p>Relationship: {selected.relationshipStatus.toLowerCase().replaceAll('_',' ')}</p>}{selected.response&&<p>{selected.response.label}{selected.response.at&&<time dateTime={selected.response.at}>{formatInstant(selected.response.at)}</time>}</p>}{selected.authorityLabel&&<p>{selected.authorityLabel}</p>}<p className="sg-detail-note">Only information shared with this perspective appears here.</p></motion.aside>
   return variant==='full'?createPortal(card,document.body):card})()}
  {!list&&expanded!==null&&<div id={`${detailId}-overflow`} className="sg-overflow-panel fg-glass"><h3>{composition.rings.find(ring=>ring.index===expanded)?.label}</h3><button type="button" onClick={()=>setExpanded(null)}>Close remaining people</button><ul className="sg-list" aria-label="Remaining authorized people">{composition.rings.find(ring=>ring.index===expanded)?.overflow.map(person=><li key={person.id}><button type="button" aria-label={`${person.name} ${person.response?.label??person.relationship}`} ref={el=>{if(el)buttons.current.set(person.id,el);else buttons.current.delete(person.id)}} onClick={()=>choose(person)}><Portrait name={person.name} src={person.portraitSrc}/><span><strong>{person.name}</strong><span>{person.response?.label??person.relationship}</span>{person.response?.at&&<time dateTime={person.response.at}>{formatInstant(person.response.at)}</time>}</span></button></li>)}</ul></div>}
  {variant==='compact'&&onOpenVillage&&<button className="sg-open-village" type="button" onClick={onOpenVillage}>Explore the village <ArrowUpRight size={18}/></button>}
  {variant==='full'&&<p className="sg-layout-note">Grouped by recorded relationship. Position does not indicate availability, trust or approval authority.</p>}
 </section>
}
