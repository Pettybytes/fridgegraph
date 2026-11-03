import {useCallback,useEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react'
export type View={scale:number;x:number;y:number}
export const overview:View={scale:1,x:0,y:0}
export const clampView=(view:View):View=>{
 const scale=Math.max(1,Math.min(4,view.scale))
 return {scale,x:Math.max(1-scale,Math.min(0,view.x)),y:Math.max(1-scale,Math.min(0,view.y))}
}
export const zoomAt=(view:View,point:{x:number;y:number},scale:number):View=>{
 const next=Math.max(1,Math.min(4,scale)),ratio=next/view.scale
 return clampView({scale:next,x:point.x-(point.x-view.x)*ratio,y:point.y-(point.y-view.y)*ratio})
}
/** Coordinates are viewport fractions: resizing keeps the same image point and
 * all photo/DOM/hit geometry in a single transform. Nothing is persisted. */
export function useFridgeViewport(){
 const ref=useRef<HTMLDivElement>(null),current=useRef(overview)
 const [view,setView]=useState(overview),[moving,setMoving]=useState(false)
 const pointers=useRef(new Map<number,{x:number;y:number}>()),suppress=useRef(false)
 const pinch=useRef<{distance:number;view:View;image:{x:number;y:number}}|null>(null)
 const start=useRef<{x:number;y:number;view:View}|null>(null)
 const apply=useCallback((next:View)=>{current.current=clampView(next);setView(current.current)},[])
 const point=(x:number,y:number)=>{const r=ref.current?.getBoundingClientRect();return {x:r?.width?(x-r.left)/r.width:.5,y:r?.height?(y-r.top)/r.height:.5}}
 const reset=useCallback(()=>{pointers.current.clear();pinch.current=null;start.current=null;setMoving(false);apply(overview)},[apply])
 const zoom=(factor:number,x=.5,y=.5)=>apply(zoomAt(current.current,{x,y},current.current.scale*factor))
 useEffect(()=>{
  const el=ref.current;if(!el)return
  const wheel=(e:WheelEvent)=>{
   if(!el.contains(document.activeElement))return
   e.preventDefault();const p=point(e.clientX,e.clientY);apply(zoomAt(current.current,p,current.current.scale*Math.exp(-e.deltaY*.002)))
  }
  // A two-finger touch intentionally activates the viewer; a single finger at
  // overview stays a normal page scroll. Pointer events own the actual geometry.
  const touch=(e:TouchEvent)=>{if(e.touches.length>1)e.preventDefault()}
  el.addEventListener('wheel',wheel,{passive:false});el.addEventListener('touchstart',touch,{passive:false});el.addEventListener('touchmove',touch,{passive:false})
  const resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(()=>{start.current=null;pinch.current=null;pointers.current.clear();setMoving(false)})
  resize?.observe(el)
  return()=>{el.removeEventListener('wheel',wheel);el.removeEventListener('touchstart',touch);el.removeEventListener('touchmove',touch);resize?.disconnect()}
 },[apply])
 function down(e:ReactPointerEvent,arrange:boolean){
  if(e.button!==0)return
  suppress.current=false
  if((e.target as HTMLElement).closest('input,textarea,select,form,[data-viewer-control]'))return
  if(arrange&&(e.target as HTMLElement).closest('.fridge-object,.fridge-posted-paper'))return
  ref.current?.focus({preventScroll:true})
  pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY})
  if(pointers.current.size===1)start.current={x:e.clientX,y:e.clientY,view:current.current}
  if(pointers.current.size===2){
   const [a,b]=[...pointers.current.values()],p=point((a.x+b.x)/2,(a.y+b.y)/2)
   pinch.current={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),view:current.current,image:{x:(p.x-current.current.x)/current.current.scale,y:(p.y-current.current.y)/current.current.scale}}
   suppress.current=true;setMoving(true)
  }
 }
 function move(e:ReactPointerEvent){
  if(!pointers.current.has(e.pointerId))return
  pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY})
  const [a,b]=[...pointers.current.values()]
  if(b&&pinch.current){
   const p=point((a.x+b.x)/2,(a.y+b.y)/2),scale=Math.max(1,Math.min(4,pinch.current.view.scale*Math.hypot(a.x-b.x,a.y-b.y)/pinch.current.distance))
   apply({scale,x:p.x-pinch.current.image.x*scale,y:p.y-pinch.current.image.y*scale});return
  }
  const s=start.current,r=ref.current?.getBoundingClientRect()
  if(s&&Math.hypot(e.clientX-s.x,e.clientY-s.y)>6){
   suppress.current=true
   if(s.view.scale>1&&r?.width&&r.height){setMoving(true);e.currentTarget.setPointerCapture?.(e.pointerId);apply({...s.view,x:s.view.x+(e.clientX-s.x)/r.width,y:s.view.y+(e.clientY-s.y)/r.height})}
  }
 }
 function up(e:ReactPointerEvent){pointers.current.delete(e.pointerId);pinch.current=null;if(!pointers.current.size){start.current=null;setMoving(false)}else{const p=[...pointers.current.values()][0];start.current={...p,view:current.current}}}
 return {ref,view,moving,apply,reset,zoom,point,down,move,up,suppress}
}
