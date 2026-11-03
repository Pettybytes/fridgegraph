import {useCallback,useEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react'
import {Dialog,Popover} from 'radix-ui'
import {authorInk,doors,loadLayout,notePositions,saveLayout,samples,type FridgeReader,type Goal,type Position,type Slot,type Read} from './model'
import {Magnet} from './Magnet'
import {useFridgeSource} from './useFridgeSource'
import type {FridgeNoteRecord} from './editingContract'
import {useFridgeViewport} from './useFridgeViewport'
import {FamilyAlbum} from './FamilyAlbum'
import type {AlbumAsset} from './packs'
import './fridge.css'

type Door='notes'|'goals'|null
type Props={personId:string;childId:string;generation:number;reader:FridgeReader;readOnly?:boolean;sampleSlots?:Slot[];artLabel?:string; editingControls?:ReactNode;goalsOverride?:Read<Goal[]>;boardReadOnly?:boolean;postedNotes?:FridgeNoteRecord[];openPostedNotes?:()=>void;boardEditor?:ReactNode;noteCreateControl?:ReactNode;artPackId?:string|null;albumAssets?:AlbumAsset[]}
const hashDoor=():Door=>location.hash==='#/fridge/notes'?'notes':location.hash==='#/fridge/goals'?'goals':null
const positionStyle=(p:Position):CSSProperties=>({left:`${p.x*100}%`,top:`${p.y*100}%`,width:`${p.width*100}%`,'--turn':`${p.rotation}deg`} as CSSProperties)
function movedPosition(p:Position,dx:number,dy:number):Position{return {...p,x:Math.max(.205,Math.min(.457-p.width,p.x+dx)),y:Math.max(.11,Math.min(.49,p.y+dy))}}

export function Fridge(props:Props){return <FridgeContext key={`${props.personId}:${props.childId}:${props.generation}`} {...props}/>}
function FridgeContext({personId,childId,reader,readOnly,sampleSlots=samples,artLabel='Decorative family artwork',editingControls,goalsOverride,boardReadOnly=true,postedNotes=[],openPostedNotes,boardEditor,noteCreateControl,artPackId,albumAssets=[]}:Props){
 const viewport=useFridgeViewport()
 const [arrange,setArrange]=useState(false)
 const [door,setDoor]=useState<Door>(hashDoor)
 const appliedHash=useRef<string|null>(null)
 const [layout,setLayout]=useState(()=>loadLayout(personId)),[selected,setSelected]=useState<Slot|null>(null)
 const care=useFridgeSource(reader,childId,'care'),goals=useFridgeSource(reader,childId,'goals')
 const board=goalsOverride??goals.state
 const scene=useRef<HTMLDivElement>(null),notesControl=useRef<HTMLButtonElement>(null),goalsControl=useRef<HTMLButtonElement>(null)
 const openTimer=useRef<ReturnType<typeof setTimeout>|null>(null)
 const activate=(detail:number,action:()=>void)=>{if(openTimer.current)clearTimeout(openTimer.current);if(detail===0)action();else openTimer.current=setTimeout(action,240)}
 useEffect(()=>()=>{if(openTimer.current)clearTimeout(openTimer.current)},[])
 const drag=useRef<{id:string;x:number;y:number;position:Position;moved:boolean;next:Position}|null>(null)
 const navigate=useCallback((next:Door)=>{
  setDoor(next);setArrange(false)
  if(next){const r=doors[next],scale=Math.min(1/r.width,1/r.height);viewport.apply({scale,x:.5-(r.x+r.width/2)*scale,y:.5-(r.y+r.height/2)*scale})}else viewport.reset()
  const hash=next?`#/fridge/${next}`:'#/fridge'
  appliedHash.current=hash
  if(location.hash!==hash)location.hash=hash
  ;(next==='goals'?goalsControl:notesControl).current?.focus()
 },[viewport.apply,viewport.reset])
 useEffect(()=>{
  if(!location.hash)history.replaceState(null,'','#/fridge')
  const update=()=>{
   if(appliedHash.current===location.hash)return
   appliedHash.current=location.hash
   const next=hashDoor();setDoor(next);setSelected(null);setArrange(false)
   if(next){const r=doors[next],scale=Math.min(1/r.width,1/r.height);viewport.apply({scale,x:.5-(r.x+r.width/2)*scale,y:.5-(r.y+r.height/2)*scale})}else viewport.reset()
   // Move focus off an object that becomes clipped, including history navigation.
   const active=document.activeElement
   if(active instanceof HTMLElement&&active.closest('[data-fridge-door]'))(next==='goals'?goalsControl:notesControl).current?.focus()
  }
  update()
  window.addEventListener('hashchange',update)
  return()=>window.removeEventListener('hashchange',update)
 },[])
 useEffect(()=>{
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&!selected&&viewport.view.scale>1)navigate(null)}
  window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape)
 },[selected,viewport.view.scale,navigate])
 const previousScale=useRef(1)
 useEffect(()=>{if(viewport.view.scale===1&&previousScale.current>1)navigate(null);previousScale.current=viewport.view.scale},[viewport.view.scale,navigate])
 useEffect(()=>{if(viewport.moving&&door){setDoor(null);appliedHash.current='#/fridge';history.replaceState(null,'','#/fridge')}},[viewport.moving,door])
 const live=[care].flatMap(({state})=>state.status==='ready'?state.value as Slot[]:[])
 const displayedLive=artPackId==='ellison-fridge-v1'?live.map(slot=>({...slot,position:{...slot.position,y:.39}})):live
 // Stored papers take priority over decorative samples; the invitation remains
 // reachable in the separate sample tray. Never merge stored text into that manifest.
 const doorSamples=postedNotes.length?sampleSlots.filter(slot=>slot.variant!=='save-date').map(slot=>slot.id==='sample-family-dinner'?{...slot,position:{x:.211,y:.478,width:.115,rotation:3}}:slot):sampleSlots
 const slots=[...doorSamples,...displayedLive]
 const storePosition=(id:string,p:Position)=>setLayout(old=>{const value={...old,[id]:p};saveLayout(personId,value);return value})
 const postedPaper=(note:FridgeNoteRecord,placed?:Position)=>{
  const position=(target:HTMLElement):Position=>{const box=target.getBoundingClientRect(),base=scene.current!.getBoundingClientRect();return placed??{x:(box.left-base.left)/base.width,y:(box.top-base.top)/base.height,width:box.width/base.width,rotation:0}}
  return <button key={note.id} className={`fridge-posted-paper ${placed?'is-arranged':''}`} style={placed?positionStyle(placed):undefined} data-paper={note.paperColor} data-note-id={note.id}
   onKeyDown={e=>{if(!arrange||!e.altKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const p=position(e.currentTarget);storePosition(note.id,movedPosition(p,e.key==='ArrowLeft'?-.005:e.key==='ArrowRight'?.005:0,e.key==='ArrowUp'?-.005:e.key==='ArrowDown'?.005:0));requestAnimationFrame(()=>{Array.from(scene.current?.querySelectorAll<HTMLButtonElement>('[data-note-id]')??[]).find(el=>el.dataset.noteId===note.id)?.focus()})}}
   onPointerDown={e=>{if(!arrange||e.button!==0)return;const p=position(e.currentTarget);drag.current={id:note.id,x:e.clientX,y:e.clientY,position:p,moved:false,next:p};e.currentTarget.setPointerCapture(e.pointerId)}}
   onPointerMove={e=>{const d=drag.current;if(!d||d.id!==note.id||!scene.current)return;const box=scene.current.getBoundingClientRect();if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>6)d.moved=true;if(d.moved){d.next=movedPosition(d.position,(e.clientX-d.x)/box.width,(e.clientY-d.y)/box.height);e.currentTarget.style.transform=`translate(${(d.next.x-d.position.x)*box.width/viewport.view.scale}px, ${(d.next.y-d.position.y)*box.height/viewport.view.scale}px)`}}}
   onPointerUp={e=>{if(drag.current?.id===note.id&&drag.current.moved){e.currentTarget.style.transform='';storePosition(note.id,drag.current.next);viewport.suppress.current=true}}}
   onPointerCancel={e=>{drag.current=null;e.currentTarget.style.transform=''}}
   onClick={e=>{if(drag.current?.moved){drag.current=null;return}activate(e.detail,()=>openPostedNotes?.())}} aria-label={`Open posted note: ${note.text}`}>
    <Magnet kind="star"/><span className="fridge-note-source">{note.audience==='PARENTS_ONLY'?'Parents only':'Shared with granted readers'}</span><span className="fridge-paper-text">{note.text}</span><span className="fridge-note-author">{note.author.displayName?`By ${note.author.displayName}`:'Author not shared'}</span>
   </button>
 }
 const goalFeedback=()=>board.status==='ready'?null:<p className="fridge-read" role={board.status==='failed'?'alert':'status'}>{board.status==='loading'?'Loading shared goals…':board.status==='empty'?'Nothing posted here yet.':board.status==='refused'?"These notes aren't shared with this perspective.":"Couldn't load these notes"}{board.status==='failed'&&<button aria-label="Retry goals" onClick={goals.refresh}>Retry</button>}</p>
 return <section className="fridge-feature" aria-label="The Fridge">
  <header className="fridge-toolbar"><div><h1>The Fridge</h1><p>A little of your family, all in one place.</p></div><div>{viewport.view.scale>1&&<button onClick={()=>navigate(null)}>← Back to fridge</button>}<button onClick={()=>{setLayout({});saveLayout(personId,{})}}>Tidy up</button></div></header>
  <div className="fridge-caption"><span>{artLabel}. {readOnly?'Read-only perspective.':''}</span><Popover.Root><Popover.Trigger className="fridge-help-trigger" aria-label="Fridge layout and keyboard help">ⓘ</Popover.Trigger><Popover.Portal><Popover.Content className="fridge-help" sideOffset={8} aria-label="Fridge layout and keyboard help"><h2>Make yourself at home</h2><p>Tap anywhere to zoom into that point; tap again to open an item. Drag to pan, pinch to zoom, or focus the viewer to use the wheel and + / − keys. Arrow keys pan. Turn on Arrange items to drag paper or move it with Alt + arrow keys.</p><p>Moving paper changes this browser’s layout only. Tidy up resets it. Escape returns to the full fridge. {boardReadOnly?'Goals are read-only.':'Goal changes require a confirmed save.'}</p><Popover.Close aria-label="Close fridge help">Close</Popover.Close></Popover.Content></Popover.Portal></Popover.Root></div>
  <nav aria-label="Fridge doors"><button ref={notesControl} aria-pressed={door==='notes'} onClick={()=>navigate('notes')}>Open collage door</button><button ref={goalsControl} aria-pressed={door==='goals'} onClick={()=>navigate('goals')}>Open goals door</button></nav>
  <FamilyAlbum assets={albumAssets} readOnly={!!readOnly||boardReadOnly}/>
  {!sampleSlots.length&&<p className="fridge-empty-art">Make room for your family’s moments. There’s no artwork in this family album yet.</p>}
  <div className="fridge-intake-state"><button disabled aria-describedby="fridge-intake-reason">+ Add photo or paper</button><p id="fridge-intake-reason">Photo and paper intake is unavailable. Private upload, extraction, confirmation, storage and authorized retrieval have not been verified together.</p></div>
  {editingControls&&<div className="fridge-editing-controls">{editingControls}</div>}
  <nav className="fridge-view-controls" aria-label="Fridge view controls">
   <button onClick={()=>viewport.zoom(1.25)}>Zoom in</button><button disabled={viewport.view.scale===1} onClick={()=>viewport.zoom(.8)}>Zoom out</button><button onClick={()=>navigate(null)}>Reset view</button>
   <button aria-pressed={arrange} disabled={viewport.view.scale===1} onClick={()=>setArrange(value=>!value)}>Arrange items</button>
  </nav>
  <div ref={viewport.ref} className={`fridge-viewport ${viewport.view.scale>1?'is-focused':''}`} data-view={door??'overview'} data-scale={viewport.view.scale} data-arrange={arrange} tabIndex={0} role="region" aria-label="Fridge viewer"
   onFocusCapture={e=>{
    if(e.target===e.currentTarget||viewport.view.scale===1)return
    const r=e.currentTarget.getBoundingClientRect(),t=e.target.getBoundingClientRect()
    if(!r.width||!r.height)return
    const dx=t.left<r.left?r.left-t.left:t.right>r.right?r.right-t.right:0
    const dy=t.top<r.top?r.top-t.top:t.bottom>r.bottom?r.bottom-t.bottom:0
    if(dx||dy)viewport.apply({...viewport.view,x:viewport.view.x+dx/r.width,y:viewport.view.y+dy/r.height})
   }}
   onDoubleClick={()=>{if(openTimer.current)clearTimeout(openTimer.current);setSelected(null);navigate(null)}}
   onPointerDownCapture={e=>{drag.current=null;viewport.down(e,arrange)}} onPointerMove={viewport.move} onPointerUp={viewport.up} onPointerCancel={viewport.up}
   onClickCapture={e=>{
    if(e.detail>=2){if(openTimer.current)clearTimeout(openTimer.current);e.preventDefault();e.stopPropagation();setSelected(null);navigate(null);return}
    if(viewport.suppress.current){e.preventDefault();e.stopPropagation();viewport.suppress.current=false;drag.current=null;return}
    if(viewport.view.scale===1){e.preventDefault();e.stopPropagation();const p=e.detail===0?{x:.5,y:.3}:viewport.point(e.clientX,e.clientY);viewport.zoom(2.5,p.x,p.y);viewport.ref.current?.focus()}
   }}
   onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(['+','=','-','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','0'].includes(e.key)){e.preventDefault();if(e.key==='0')navigate(null);else if(e.key==='+'||e.key==='=')viewport.zoom(1.25);else if(e.key==='-')viewport.zoom(.8);else viewport.apply({...viewport.view,x:viewport.view.x+(e.key==='ArrowLeft'?.06:e.key==='ArrowRight'?-.06:0),y:viewport.view.y+(e.key==='ArrowUp'?.06:e.key==='ArrowDown'?-.06:0)})}}}>
   <div ref={scene} className="fridge-scene" data-moving={viewport.moving} style={{transform:`translate(${viewport.view.x*100}%, ${viewport.view.y*100}%) scale(${viewport.view.scale})`}}>
    <img className="fridge-background" alt="A stainless steel family refrigerator in a sunlit kitchen" src="/fridge/fridge-front-1400.webp" srcSet="/fridge/fridge-front-780.webp 780w, /fridge/fridge-front-1400.webp 1400w, /fridge/fridge-front-2336.webp 2336w" sizes={viewport.view.scale>1?'2336px':'(max-width: 600px) 100vw, 90vw'}/>
    {(['notes','goals'] as const).map(d=><button tabIndex={door?-1:0} inert={!!door} key={d} className="fridge-door" aria-label={`Zoom into ${d==='notes'?'collage':'goals'} door`} style={{left:`${doors[d].x*100}%`,top:`${doors[d].y*100}%`,width:`${doors[d].width*100}%`,height:`${doors[d].height*100}%`}} onClick={()=>{if(viewport.view.scale===1)navigate(d)}}/>)}
    <div className="fridge-layer" data-fridge-door="notes" inert={door==='goals'} aria-hidden={door==='goals'}>
     {slots.map(slot=>{
      const p=layout[slot.id]??slot.position
      return <button key={slot.id} className={`fridge-object ${slot.kind} paper-${slot.paper??0} ${slot.variant??''}`} style={{...positionStyle(p),color:authorInk(slot.owner)}} aria-label={slot.text} tabIndex={door==='goals'?-1:0}
       onKeyDown={e=>{if(!arrange||!e.altKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();storePosition(slot.id,movedPosition(p,e.key==='ArrowLeft'?-.005:e.key==='ArrowRight'?.005:0,e.key==='ArrowUp'?-.005:e.key==='ArrowDown'?.005:0))}}
       onPointerDown={e=>{if(!arrange||e.button!==0)return;drag.current={id:slot.id,x:e.clientX,y:e.clientY,position:p,moved:false,next:p};e.currentTarget.setPointerCapture(e.pointerId)}}
       onPointerMove={e=>{const d=drag.current;if(!d||d.id!==slot.id||!scene.current)return;const box=scene.current.getBoundingClientRect();if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>6)d.moved=true;if(d.moved){d.next=movedPosition(d.position,(e.clientX-d.x)/box.width,(e.clientY-d.y)/box.height);setLayout(old=>({...old,[slot.id]:d.next}))}}}
       onPointerUp={()=>{if(drag.current?.moved)storePosition(slot.id,drag.current.next)}} onPointerCancel={()=>{drag.current=null}}
       onClick={e=>{if(drag.current?.moved){drag.current=null;return}drag.current=null;activate(e.detail,()=>{if(slot.destination)location.hash=slot.destination;else setSelected(slot)})}}>
       <Magnet kind={slot.magnet??'apple'}/>
       {(slot.asset||slot.image)&&<img draggable={false} src={slot.image?.src??`/fridge/samples/${slot.asset}-720.webp`} srcSet={slot.image?.srcSet??(slot.asset?`/fridge/samples/${slot.asset}-360.webp 360w, /fridge/samples/${slot.asset}-720.webp 720w, /fridge/samples/${slot.asset}-1440.webp 1440w`:undefined)} sizes="500px" alt={slot.image?.alt??''}/>}
       {(slot.kind==='note'||slot.kind==='form')&&<span className="fridge-note-source">{slot.heading??(slot.source==='sample'?'':'Shared note')}</span>}
       {slot.variant==='save-date'?<span className="fridge-save-date-copy"><span className="fridge-reveal-accent" aria-hidden="true">?</span>{slot.lines?.map((line,index)=><span key={line} className={index===0?'save-date-title':''}>{line}</span>)}</span>:slot.kind!=='photo'&&<span className="fridge-paper-text">{slot.text}</span>}
      </button>
     })}
     {noteCreateControl&&<div className="fridge-create-note" data-viewer-control>{noteCreateControl}</div>}
     {postedNotes.length>0&&<section className="fridge-posted-notes" aria-label="Posted fridge notes" tabIndex={door==='goals'?-1:0}>
      {postedNotes.filter(note=>!layout[note.id]).map(note=>postedPaper(note))}
     </section>}
     {postedNotes.filter(note=>layout[note.id]).map(note=>postedPaper(note,layout[note.id]))}
     {([['care',care]] as const).map(([source,{state,refresh}])=>state.status==='ready'?null:<article key={source} className={`fridge-feedback paper-0`} style={positionStyle(artPackId==='ellison-fridge-v1'?{...notePositions.care,y:.39}:notePositions.care)} aria-label={'Care notes'}>
      <Magnet kind={'apple'}/>
      <p role={state.status==='failed'?'alert':'status'}><span className="fridge-note-source">Care notes · </span><span>{state.status==='loading'?'Loading…':state.status==='empty'?'Nothing posted yet.':state.status==='refused'?'Not shared with this perspective.':"Couldn't load"}</span></p>
      {state.status==='failed'&&<button aria-label={'Retry care notes'} onClick={refresh}>Retry</button>}
     </article>)}
    </div>
    <section className="fridge-whiteboard" data-fridge-door="goals" inert={door==='notes'} aria-hidden={door==='notes'} aria-label="Recorded goals">
     <h2>Our goals</h2>{boardEditor&&<div className="fridge-inline-goal" data-viewer-control>{boardEditor}</div>}<span className="fridge-board-rule"/>{goalFeedback()}
     {board.status==='ready'&&(board.value as Goal[]).map(goal=><article key={goal.id}><h3>{goal.title}</h3>{goal.horizon!==null&&<p className="fridge-horizon"><span>Horizon</span> <span>{goal.horizon}</span></p>}<small className="fridge-goal-status">{goal.status}</small>{goal.period&&<p className="fridge-horizon">Period: {goal.period}</p>}{goal.completedAt!==undefined&&<p className="fridge-horizon">{goal.completedAt?<>Completed <time dateTime={goal.completedAt}>{Number.isFinite(Date.parse(goal.completedAt))?new Intl.DateTimeFormat('en-US',{timeZone:'America/Detroit',month:'short',day:'numeric',year:'numeric'}).format(new Date(goal.completedAt)):'Time not recorded'}</time></>:<>Not marked complete</>}</p>}</article>)}
     <p className="fridge-board-foot">Family-chosen commitments{boardReadOnly?' · Read only':''}</p><span className="fridge-marker" aria-hidden="true"/><span className="fridge-erased-texture" aria-hidden="true"/>
    </section>
   </div>
  </div>
  {!door&&sampleSlots.some(slot=>slot.kind==='form'||(postedNotes.length>0&&slot.variant==='save-date'))&&<div className="fridge-sample-card-tray" aria-label="Decorative papers">{sampleSlots.filter(slot=>slot.kind==='form'||(postedNotes.length>0&&slot.variant==='save-date')).map(slot=><button key={slot.id} aria-label={`Open decorative ${slot.text}`} onClick={()=>setSelected(slot)}><img src={slot.image?.src??`/fridge/samples/${slot.asset}-720.webp`} alt=""/><strong>{slot.text}</strong></button>)}</div>}
  <Dialog.Root open={!!selected} onOpenChange={open=>{if(!open)setSelected(null)}}><Dialog.Portal><Dialog.Overlay className="fridge-overlay"/><Dialog.Content className="fridge-dialog"><Dialog.Title>{selected?.text}</Dialog.Title>{selected&&(selected.asset||selected.image)&&<img src={selected.image?.src??`/fridge/samples/${selected.asset}-1440.webp`} alt={selected.image?.alt??selected.text}/>}<Dialog.Description>{selected?.caption}</Dialog.Description><Dialog.Close>Close</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
 </section>
}
