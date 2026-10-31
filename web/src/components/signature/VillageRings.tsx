import {useEffect,useId,useRef,useState} from 'react'
import {motion,useReducedMotion} from 'motion/react'
import {ArrowUpRight,X,Users,Network} from 'lucide-react'
import type {VillageRingsProps,VillagePerson} from './types'
import {orderedPeople,ringSlots} from './layout'
import {Portrait} from './Portrait'
import './signature.css'
export function VillageRings({child,people,variant='full',selectedPersonId,onSelectPerson,onOpenVillage}:VillageRingsProps){
 const entered=useRef<string|null>(null),isEntry=entered.current!==child.id
 useEffect(()=>{entered.current=child.id},[child.id])
 const reduced=useReducedMotion(),detailId=useId(),buttons=useRef(new Map<string,HTMLButtonElement>()),keyboard=useRef(false)
 const [selection,setSelection]=useState<string|null>(null),[group,setGroup]=useState<string|null>(null),[page,setPage]=useState(0),[list,setList]=useState(false)
 const sorted=orderedPeople(people),groups=[...new Set(sorted.map(person=>person.group))]
 const currentGroup=group&&groups.includes(group)?group:groups.includes('Family')?'Family':groups[0]
 const grouped=sorted.filter(person=>person.group===currentGroup)
 const pageSize=variant==='compact'?4:6,currentPage=Math.min(page,Math.max(0,Math.ceil(grouped.length/pageSize)-1)),visible=grouped.slice(currentPage*pageSize,(currentPage+1)*pageSize),slots=ringSlots(visible.length).map(slot=>variant==='compact'?{...slot,y:50+(slot.y-48)*.75}:slot)
 const selected=sorted.find(person=>person.id===(selectedPersonId===undefined?selection:selectedPersonId))
 function choose(person:VillagePerson){setSelection(person.id);onSelectPerson?.(person)}
 function close(){if(selected)buttons.current.get(selected.id)?.focus();setSelection(null);onSelectPerson?.(null)}
 const entrance=(index:number,central=false)=>({initial:reduced||!isEntry?false:{opacity:0,transform:`translateY(${central?6:10}px) scale(.98)`},animate:{opacity:1,transform:'translateY(0px) scale(1)'},transition:{duration:central ? .28 : .36,delay:reduced?0:central?0:.12+index*.045,ease:[.23,1,.32,1] as const}})
 return <section className={`sg-village sg-${variant}`} aria-label={variant==='compact'?`${child.name}'s village preview`:`${child.name}'s village network`}>
  {variant==='full'&&<div className="sg-tools"><div className="sg-groups" aria-label="Relationship groups">{groups.map(name=><button key={name} type="button" aria-label={`${name} ${sorted.filter(person=>person.group===name).length}`} aria-pressed={name===currentGroup} onClick={()=>{setGroup(name);setPage(0);setSelection(null)}}>{name}<span>{sorted.filter(person=>person.group===name).length}</span></button>)}</div><button className="sg-view-toggle" type="button" aria-pressed={list} onClick={()=>setList(!list)}>{list?<Network size={18}/>:<Users size={18}/>} {list?'Network view':'List view'}</button></div>}
  {variant==='compact'&&currentGroup&&<p className="sg-preview-group">{currentGroup} connections</p>}
  {!list?<div className="sg-scene"><span className="sg-illumination" aria-hidden="true"/>
   <svg className="sg-orbits" viewBox="0 0 1000 650" preserveAspectRatio="none" aria-hidden="true"><ellipse cx="500" cy="312" rx="360" ry="221"/>{visible.map((person,index)=><path key={person.id} data-selected={selected?.id===person.id||undefined} d={`M500 312 Q${slots[index].x*10} 312 ${slots[index].x*10} ${slots[index].y*6.5}`}/>)}</svg>
   <motion.figure className="sg-child" key={child.id} {...entrance(0,true)}><Portrait name={child.name} src={child.portraitSrc}/><figcaption><strong>{child.name}</strong><span>{variant==='full'?'Their village, as shared with you':'Their village'}</span></figcaption></motion.figure>
   {visible.map((person,index)=><motion.div className="sg-person" data-column={index%2===0?'left':'right'} key={person.id} style={{left:`${slots[index].x}%`,top:`${slots[index].y}%`}} {...entrance(index)}><button type="button" ref={el=>{if(el)buttons.current.set(person.id,el);else buttons.current.delete(person.id)}} aria-label={`${person.name} ${person.relationship}`} aria-expanded={selected?.id===person.id} aria-controls={detailId} onPointerDown={()=>{keyboard.current=false}} onKeyDown={event=>{keyboard.current=true;const delta=event.key==='ArrowRight'||event.key==='ArrowDown'?1:event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:0;if(delta){event.preventDefault();buttons.current.get(visible[(index+delta+visible.length)%visible.length].id)?.focus()}}} onClick={()=>choose(person)}><Portrait name={person.name} src={person.portraitSrc}/><span className="sg-person-name">{person.name}</span><span className="sg-relationship">{person.relationship}</span>{person.authorityLabel&&<span className="sg-authority">{person.authorityLabel}</span>}</button></motion.div>)}
  </div>:<ul className="sg-list" aria-label="People shared with you">{sorted.map(person=><li key={person.id}><button type="button" aria-label={`${person.name} ${person.relationship}`} aria-expanded={selected?.id===person.id} aria-controls={detailId} onClick={()=>{keyboard.current=true;choose(person)}}><Portrait name={person.name} src={person.portraitSrc}/><span><strong>{person.name}</strong><span>{person.relationship}</span></span>{person.authorityLabel&&<span>{person.authorityLabel}</span>}<ArrowUpRight size={18}/></button></li>)}</ul>}
  {people.length===0&&<p className="sg-empty">No records are available to this view.</p>}
  {selected&&<motion.aside className="sg-detail fg-glass" id={detailId} aria-label="Selected person details" initial={reduced||keyboard.current?false:{opacity:0,transform:'translateY(8px)'}} animate={{opacity:1,transform:'translateY(0px)'}} transition={{duration:.18,ease:[.23,1,.32,1]}}><div className="sg-detail-heading"><Portrait name={selected.name} src={selected.portraitSrc}/><div><h3>{selected.name}</h3><p>{selected.relationship}</p></div><button type="button" aria-label="Close person details" onClick={close}><X size={20}/></button></div>{selected.relationshipStatus&&<p>Relationship: {selected.relationshipStatus.toLowerCase().replaceAll('_',' ')}</p>}<p>{selected.authorityLabel??'Approval authority is not shown in this record.'}</p><p className="sg-detail-note">Only information shared with this perspective appears here.</p></motion.aside>}
  {variant==='full'&&!list&&grouped.length>pageSize&&<div className="sg-pagination"><button type="button" disabled={currentPage===0} onClick={()=>{setPage(currentPage-1);setSelection(null)}}>Previous people</button><span>{currentPage+1} of {Math.ceil(grouped.length/pageSize)}</span><button type="button" disabled={(currentPage+1)*pageSize>=grouped.length} onClick={()=>{setPage(currentPage+1);setSelection(null)}}>More people</button></div>}
  {variant==='compact'&&onOpenVillage&&<button className="sg-open-village" type="button" onClick={onOpenVillage}>Explore the village <ArrowUpRight size={18}/></button>}
  {variant==='full'&&<p className="sg-layout-note">Grouped by recorded relationship. Position does not indicate availability, trust or approval authority.</p>}
 </section>
}
