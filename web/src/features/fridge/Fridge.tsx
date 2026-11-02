import {useCallback,useEffect,useRef,useState,type CSSProperties} from 'react'
import {Dialog,Popover} from 'radix-ui'
import {authorInk,doors,loadLayout,notePositions,saveLayout,samples,type FridgeReader,type Goal,type Position,type Slot} from './model'
import {Magnet} from './Magnet'
import {useFridgeSource} from './useFridgeSource'
import './fridge.css'

type Door='notes'|'goals'|null
type Props={personId:string;childId:string;generation:number;reader:FridgeReader;readOnly?:boolean;sampleSlots?:Slot[];artLabel?:string}
const hashDoor=():Door=>location.hash==='#/fridge/notes'?'notes':location.hash==='#/fridge/goals'?'goals':null
const positionStyle=(p:Position):CSSProperties=>({left:`${p.x*100}%`,top:`${p.y*100}%`,width:`${p.width*100}%`,'--turn':`${p.rotation}deg`} as CSSProperties)
function movedPosition(p:Position,dx:number,dy:number):Position{return {...p,x:Math.max(.205,Math.min(.457-p.width,p.x+dx)),y:Math.max(.11,Math.min(.49,p.y+dy))}}

export function Fridge(props:Props){return <FridgeContext key={`${props.personId}:${props.childId}:${props.generation}`} {...props}/>}
function FridgeContext({personId,childId,reader,readOnly,sampleSlots=samples,artLabel='Sample family collage'}:Props){
 const [door,setDoor]=useState<Door>(hashDoor)
 const [layout,setLayout]=useState(()=>loadLayout(personId)),[selected,setSelected]=useState<Slot|null>(null)
 const care=useFridgeSource(reader,childId,'care'),goals=useFridgeSource(reader,childId,'goals')
 const scene=useRef<HTMLDivElement>(null),notesControl=useRef<HTMLButtonElement>(null),goalsControl=useRef<HTMLButtonElement>(null)
 const drag=useRef<{id:string;x:number;y:number;position:Position;moved:boolean;next:Position}|null>(null)
 const navigate=useCallback((next:Door)=>{
  setDoor(next)
  const hash=next?`#/fridge/${next}`:'#/fridge'
  if(location.hash!==hash)location.hash=hash
  ;(next==='goals'?goalsControl:notesControl).current?.focus()
 },[])
 useEffect(()=>{
  if(!location.hash)history.replaceState(null,'','#/fridge')
  const update=()=>{
   const next=hashDoor();setDoor(next);setSelected(null)
   // Move focus off an object that becomes clipped, including history navigation.
   const active=document.activeElement
   if(active instanceof HTMLElement&&active.closest('[data-fridge-door]'))(next==='goals'?goalsControl:notesControl).current?.focus()
  }
  window.addEventListener('hashchange',update)
  return()=>window.removeEventListener('hashchange',update)
 },[])
 useEffect(()=>{
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&!selected&&door)navigate(null)}
  window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape)
 },[selected,door,navigate])
 const live=[care].flatMap(({state})=>state.status==='ready'?state.value as Slot[]:[])
 const displayedLive=artLabel==='Sample Ellison family art pack'?live.map(slot=>({...slot,position:{...slot.position,y:.39}})):live
 const slots=[...sampleSlots,...displayedLive],region=door?doors[door]:null
 const storePosition=(id:string,p:Position)=>setLayout(old=>{const value={...old,[id]:p};saveLayout(personId,value);return value})
 const goalFeedback=()=>goals.state.status==='ready'?null:<p className="fridge-read" role={goals.state.status==='failed'?'alert':'status'}>{goals.state.status==='loading'?'Loading shared goals…':goals.state.status==='empty'?'Nothing posted here yet.':goals.state.status==='refused'?"These notes aren't shared with this perspective.":"Couldn't load these notes"}{goals.state.status==='failed'&&<button aria-label="Retry goals" onClick={goals.refresh}>Retry</button>}</p>
 return <section className="fridge-feature" aria-label="The Fridge">
  <header className="fridge-toolbar"><div><h1>The Fridge</h1><p>A little of your family, all in one place.</p></div><div>{door&&<button onClick={()=>navigate(null)}>← Back to fridge</button>}<button onClick={()=>{setLayout({});saveLayout(personId,{})}}>Tidy up</button></div></header>
  <div className="fridge-caption"><span>{artLabel}. {readOnly?'Read-only perspective.':''}</span><Popover.Root><Popover.Trigger className="fridge-help-trigger" aria-label="Fridge layout and keyboard help">ⓘ</Popover.Trigger><Popover.Portal><Popover.Content className="fridge-help" sideOffset={8} aria-label="Fridge layout and keyboard help"><h2>Make yourself at home</h2><p>Open a door to take a closer look. Tap paper or a photo to open it. In door view, drag paper or use Alt + arrow keys to move it.</p><p>Moving paper changes this browser’s layout only. Tidy up resets it. Escape returns to the full fridge. Goals are read-only.</p><Popover.Close aria-label="Close fridge help">Close</Popover.Close></Popover.Content></Popover.Portal></Popover.Root></div>
  <nav aria-label="Fridge doors"><button ref={notesControl} aria-pressed={door==='notes'} onClick={()=>navigate('notes')}>Open collage door</button><button ref={goalsControl} aria-pressed={door==='goals'} onClick={()=>navigate('goals')}>Open goals door</button></nav>
  <div className={`fridge-viewport ${door?'is-focused':''}`} data-view={door??'overview'} style={region?{aspectRatio:`${region.width*2336}/${region.height*3504}`}:{}}>
   <div ref={scene} className="fridge-scene" style={region?{width:`${100/region.width}%`,height:`${100/region.height}%`,transform:`translate(${-region.x*100}%, ${-region.y*100}%)`}:undefined}>
    <img className="fridge-background" alt="A stainless steel family refrigerator in a sunlit kitchen" src="/fridge/fridge-front-1400.webp" srcSet="/fridge/fridge-front-780.webp 780w, /fridge/fridge-front-1400.webp 1400w, /fridge/fridge-front-2336.webp 2336w" sizes={door?'2000px':'(max-width: 600px) 100vw, 800px'}/>
    {(['notes','goals'] as const).map(d=><button tabIndex={door?-1:0} inert={!!door} key={d} className="fridge-door" aria-label={`Zoom into ${d==='notes'?'collage':'goals'} door`} style={{left:`${doors[d].x*100}%`,top:`${doors[d].y*100}%`,width:`${doors[d].width*100}%`,height:`${doors[d].height*100}%`}} onClick={()=>navigate(d)}/>)}
    <div className="fridge-layer" data-fridge-door="notes" inert={door==='goals'} aria-hidden={door==='goals'}>
     {slots.map(slot=>{
      const p=layout[slot.id]??slot.position
      return <button key={slot.id} className={`fridge-object ${slot.kind} paper-${slot.paper??0} ${slot.variant??''}`} style={{...positionStyle(p),color:authorInk(slot.owner)}} aria-label={slot.text} tabIndex={door==='goals'?-1:0}
       onKeyDown={e=>{if(door!=='notes'||!e.altKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();storePosition(slot.id,movedPosition(p,e.key==='ArrowLeft'?-.005:e.key==='ArrowRight'?.005:0,e.key==='ArrowUp'?-.005:e.key==='ArrowDown'?.005:0))}}
       onPointerDown={e=>{if(door!=='notes'||e.button!==0)return;drag.current={id:slot.id,x:e.clientX,y:e.clientY,position:p,moved:false,next:p};e.currentTarget.setPointerCapture(e.pointerId)}}
       onPointerMove={e=>{const d=drag.current;if(!d||d.id!==slot.id||!scene.current)return;const box=scene.current.getBoundingClientRect();if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>6)d.moved=true;if(d.moved){d.next=movedPosition(d.position,(e.clientX-d.x)/box.width,(e.clientY-d.y)/box.height);setLayout(old=>({...old,[slot.id]:d.next}))}}}
       onPointerUp={()=>{if(drag.current?.moved)storePosition(slot.id,drag.current.next)}} onPointerCancel={()=>{drag.current=null}}
       onClick={()=>{if(drag.current?.moved){drag.current=null;return}drag.current=null;if(slot.destination)location.hash=slot.destination;else setSelected(slot)}}>
       <Magnet kind={slot.magnet??'apple'}/>
       {(slot.asset||slot.image)&&<img draggable={false} src={slot.image?.src??`/fridge/samples/${slot.asset}-720.webp`} srcSet={slot.image?.srcSet??(slot.asset?`/fridge/samples/${slot.asset}-360.webp 360w, /fridge/samples/${slot.asset}-720.webp 720w, /fridge/samples/${slot.asset}-1440.webp 1440w`:undefined)} sizes="500px" alt={slot.image?.alt??''}/>}
       {(slot.kind==='note'||slot.kind==='form')&&<span className="fridge-note-source">{slot.heading??(slot.source==='sample'?(slot.kind==='form'?'Sample':'Sample note'):'Shared note')}</span>}
       {slot.variant==='save-date'?<span className="fridge-save-date-copy"><span className="fridge-sample-badge">Sample</span><span className="fridge-reveal-accent" aria-hidden="true">?</span>{slot.lines?.map((line,index)=><span key={line} className={index===0?'save-date-title':''}>{line}</span>)}</span>:slot.kind!=='photo'&&<span className="fridge-paper-text">{slot.text}</span>}
      </button>
     })}
     {([['care',care]] as const).map(([source,{state,refresh}])=>state.status==='ready'?null:<article key={source} className={`fridge-feedback paper-0`} style={positionStyle(artLabel==='Sample Ellison family art pack'?{...notePositions.care,y:.39}:notePositions.care)} aria-label={'Care notes'}>
      <Magnet kind={'apple'}/>
      <p role={state.status==='failed'?'alert':'status'}><span className="fridge-note-source">Care notes · </span><span>{state.status==='loading'?'Loading…':state.status==='empty'?'Nothing posted yet.':state.status==='refused'?'Not shared with this perspective.':"Couldn't load"}</span></p>
      {state.status==='failed'&&<button aria-label={'Retry care notes'} onClick={refresh}>Retry</button>}
     </article>)}
    </div>
    <section className="fridge-whiteboard" data-fridge-door="goals" inert={door==='notes'} aria-hidden={door==='notes'} aria-label="Recorded goals">
     <h2>Our goals</h2><span className="fridge-board-rule"/>{goalFeedback()}
     {goals.state.status==='ready'&&(goals.state.value as Goal[]).map(goal=><article key={goal.id}><h3>{goal.title}</h3>{goal.horizon!==null&&<p className="fridge-horizon"><span>Horizon</span> <span>{goal.horizon}</span></p>}<small className="fridge-goal-status">{goal.status}</small></article>)}
     <p className="fridge-board-foot">Family-chosen commitments · Read only</p><span className="fridge-marker" aria-hidden="true"/><span className="fridge-erased-texture" aria-hidden="true"/>
    </section>
   </div>
  </div>
  <Dialog.Root open={!!selected} onOpenChange={open=>{if(!open)setSelected(null)}}><Dialog.Portal><Dialog.Overlay className="fridge-overlay"/><Dialog.Content className="fridge-dialog"><Dialog.Title>{selected?.text}</Dialog.Title>{selected&&(selected.asset||selected.image)&&<img src={selected.image?.src??`/fridge/samples/${selected.asset}-1440.webp`} alt={selected.image?.alt??selected.text}/>}<Dialog.Description>{selected?.caption}</Dialog.Description><Dialog.Close>Close</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
 </section>
}
