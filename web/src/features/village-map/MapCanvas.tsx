import {setWorkerUrl} from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import {useEffect,useRef,useState} from 'react'
import Map,{Marker,Source,Layer,type MapRef} from 'react-map-gl/maplibre'
import {useReducedMotion} from './useMapReducedMotion'
import {MapPin,School,House,Trees,Flag,Building2} from 'lucide-react'
import {portraitFor} from '@/components/fg/portraits'
import type {MapController,MapState} from './controller'
import type {Point,Place} from './types'
import {eventPlaceLabel,replayFrame,unclutter,personPoint} from './model'
import {layoutLabels,type LabelAnchor} from './labelLayout'
import 'maplibre-gl/dist/maplibre-gl.css'
setWorkerUrl(workerUrl)
const styleUrls={light:'https://tiles.openfreemap.org/styles/positron',dark:'https://tiles.openfreemap.org/styles/dark'}
// Keep the reviewed warm Positron land/building treatment independent of page re-skins.
// Water and routes retain the shared blue accents; historical purple is intentionally absent.
const lightMapPaint={land:'oklch(.985 .008 85)',building:'oklch(.52 0 0)'}
const icons={school:School,home:House,park:Trees,field:Flag,venue:Building2}
export function MapCanvas({controller,state,theme,compact=false,bottom=0,onExpand}:{controller:MapController;state:MapState;theme:'light'|'dark';compact?:boolean;bottom?:number;onExpand?:()=>void}){
 const ref=useRef<MapRef>(null),reduced=useReducedMotion(),[ready,setReady]=useState(false),[failed,setFailed]=useState(false),[camera,setCamera]=useState(0),[cluster,setCluster]=useState<string|null>(null),[dragEpoch,setDragEpoch]=useState(0),[draw,setDraw]=useState(1)
 useEffect(()=>{if(reduced)ref.current?.stop()},[reduced])
 const mapAccent=theme==='light'?'--type-school':'oklch(.72 .13 237)'
 const {world,route}=state,frame=route?replayFrame(route,state.progress):null
 useEffect(()=>{if(!state.route||reduced){setDraw(1);return}setDraw(0);let handle=0;const start=performance.now();const animate=(now:number)=>{const p=Math.min(1,(now-start)/650);setDraw(p);if(p<1)handle=requestAnimationFrame(animate)};handle=requestAnimationFrame(animate);return()=>cancelAnimationFrame(handle)},[state.route?.id,reduced])
 const token=(name:string)=>{const canvas=document.createElement('canvas'),context=canvas.getContext('2d')!;context.fillStyle=name.startsWith('--')?getComputedStyle(document.documentElement).getPropertyValue(name):name;context.fillRect(0,0,1,1);const [r,g,b]=context.getImageData(0,0,1,1).data;return `rgb(${r},${g},${b})`}
 useEffect(()=>{if(!ready||!ref.current)return;const map=ref.current;const points=route?.geometry??[...(world?.places.flatMap(p=>p.point?[p.point]:[])??[]),...(world?.people.flatMap(p=>{const point=personPoint(p,world);return point?[point]:[]})??[])];if(!points.length)return;const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);map.fitBounds([[Math.min(...xs),Math.min(...ys)],[Math.max(...xs),Math.max(...ys)]],{padding:{top:90,right:85,bottom:Math.min(bottom+85,map.getContainer().clientHeight*.48),left:85},duration:reduced?0:650,maxZoom:14.5})},[ready,state.fitRevision]) // Explicit user route/day/recenter only, not polls or layout changes.
 useEffect(()=>{const map=ref.current?.getMap();if(!map)return;const setup=()=>{
  for(const layer of map.getStyle().layers??[]){if(layer.type==='symbol'&&/poi|housenumber|minor|transit|road.*label|road.*name/.test(layer.id))map.setLayoutProperty(layer.id,'visibility','none');if(layer.type==='background')map.setPaintProperty(layer.id,'background-color',token(theme==='light'?lightMapPaint.land:'--fg-canvas'));if(layer.type==='fill'&&/^water/.test(layer.id))map.setPaintProperty(layer.id,'fill-color',token(theme==='light'?'oklch(.95 .028 237)':'oklch(.34 .04 237)'))}
  const building=map.getStyle().layers.find(l=>l.type==='fill'&&'source-layer' in l&&l['source-layer']==='building');if(building&&'source' in building&&!map.getLayer('vm-buildings'))map.addLayer({id:'vm-buildings',type:'fill-extrusion',source:building.source,'source-layer':'building',minzoom:15.5,paint:{'fill-extrusion-color':token(theme==='light'?lightMapPaint.building:'--fg-muted'),'fill-extrusion-opacity':.18,'fill-extrusion-height':['coalesce',['get','render_height'],['get','height'],8]}})
 };map.on('style.load',setup);if(map.isStyleLoaded())setup();return()=>{map.off('style.load',setup)}},[ready,theme])
 useEffect(()=>{if(!ready||compact||reduced||!state.playing||!state.following||!frame)return;ref.current?.easeTo({center:frame.point,pitch:35,duration:0,padding:{top:40,right:40,bottom:bottom+40,left:40}})},[state.progress,state.playing,state.following,ready])
 useEffect(()=>{if(!ready||!state.playing||state.progress!==0||!state.following||reduced)return;ref.current?.easeTo({pitch:35,duration:700})},[state.playing])
 if(!world)return null
 const markers=[...world.places.flatMap(p=>p.point?[{id:`place:${p.id}`,kind:'place' as const,record:p,point:p.point}]:[]),...world.people.flatMap(p=>{const point=personPoint(p,world);return point?[{id:`person:${p.id}`,kind:'person' as const,record:p,point}]:[]})]
 const groups=ready?unclutter(markers,item=>{const p=ref.current?.project(item.point);return p?[p.x,p.y]:[0,0]},compact?40:64):[]
 const select=(marker:typeof markers[number])=>{controller.select({kind:marker.kind,id:marker.record.id});setCluster(null)}
 function drop(personId:string,place:Place){if(world?.people.some(p=>p.id===personId))void controller.route(personId,place.id)}
 function dragged(personId:string,point:Point){const projected=ref.current?.project(point);if(projected){const target=world?.places.find(place=>{if(!place.point)return false;const q=ref.current!.project(place.point);return Math.hypot(projected.x-q.x,projected.y-q.y)<55});if(target)drop(personId,target)}setDragEpoch(e=>e+1)}
 const line=(coordinates:Point[])=>({type:'Feature' as const,properties:{},geometry:{type:'LineString' as const,coordinates}})
 const selectedEvent=state.selection?.kind==='event'?world.events.find(e=>e.id===state.selection!.id):null
 const anchors:LabelAnchor[]=[],obstacles=groups.map(group=>{
  const point=ref.current?.project(group[0].point)??{x:0,y:0}
  const selected=group.find(m=>m.record.id===state.selection?.id||m.record.id===selectedEvent?.placeId)
  const destination=group.find(m=>m.record.id===route?.toId)
  const caption=selected??destination??(group.length===1?group[0]:undefined)
  if(caption)anchors.push({id:group[0].id,x:point.x,y:point.y,text:caption.record.name,priority:selected?2:destination?1:0})
  return {x:point.x-32,y:point.y-32,width:64,height:64}
 })
 const container=ref.current?.getContainer()
 const labels=compact?new globalThis.Map():layoutLabels(anchors,obstacles,{x:8,y:135,width:Math.max(0,(container?.clientWidth??0)-16),height:Math.max(0,(container?.clientHeight??0)-bottom-175)})
 const restricted=world.people.some(p=>!personPoint(p,world))||world.places.some(p=>!p.point)
 const dayPoints=world.events.filter(e=>e.day===state.day&&e.status.toUpperCase()!=='CANCELLED').sort((a,b)=>a.at.localeCompare(b.at)).flatMap(e=>{const point=world.places.find(p=>p.id===e.placeId)?.point;return point?[point]:[]})
 if(failed||markers.length===0)return <section className="vm-map-fallback" data-map-state={failed?'unavailable':'restricted'} role="region" aria-label="Map list fallback"><h2>{failed?'Map unavailable':'Map restricted'}</h2><p>{failed?'Use the places and timeline below. Routing controls still work.':'No mappable coordinates are available to this view. Authorized labels are shown below; no substitute pins or routes are drawn.'}</p><ul>{world.places.map(p=><li key={p.id}><button onClick={()=>controller.select({kind:'place',id:p.id})}>{p.name}</button></li>)}</ul><ol>{world.events.filter(e=>e.day===state.day).map(e=><li key={e.id}>{e.title} · {eventPlaceLabel(e,world)}</li>)}</ol></section>
 return <div className={`vm-canvas ${compact?'is-mini':''}`} data-map-state={restricted?'restricted':'available'} data-camera={camera} style={{viewTransitionName:'village-map'}}>
 {restricted&&!compact&&<p className="vm-restricted-note">Some locations aren't mapped · labels remain in the planner</p>}
 {!ready&&<div className="vm-tile-skeleton" role="status">Loading the map…</div>}
 <Map ref={ref} initialViewState={{longitude:-83.079,latitude:42.352,zoom:12.1}} mapStyle={styleUrls[theme]} attributionControl={{compact:true}} interactive={!compact} onLoad={()=>setReady(true)} onError={()=>setFailed(true)} onMove={()=>setCamera(n=>n+1)} onDragStart={()=>controller.manualMove()} onMoveStart={event=>{if(event.originalEvent)controller.manualMove()}} onZoomStart={event=>{if(event.originalEvent)controller.manualMove()}}>
 {ready&&groups.map(group=>{const marker=group[0];if(group.length>1)return <Marker key={group.map(m=>m.id).join(':')} longitude={marker.point[0]} latitude={marker.point[1]}><button className={`vm-cluster ${group.some(m=>m.record.id===state.selection?.id)?'is-selected':''}`} data-place-id={group.find(m=>m.kind==='place')?.record.id} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const places=group.filter(m=>m.kind==='place');if(places.length===1&&places[0].kind==='place')drop(e.dataTransfer.getData('text/plain'),places[0].record);else setCluster(marker.id)}} aria-label={`${group.length} overlapping people and places: ${group.map(m=>m.record.name).join(', ')}`} onClick={()=>setCluster(cluster===marker.id?null:marker.id)}>{group.some(m=>m.kind==='person')?<><img src={portraitFor({personId:group.find(m=>m.kind==='person')!.record.id})} alt=""/><b>{group.length}</b></>:group.length}</button>{group.some(m=>m.record.id===state.selection?.id)&&<span className="vm-cluster-destination">{group.find(m=>m.record.id===state.selection?.id)?.record.name}</span>}{group.some(m=>m.record.id===route?.toId)&&!group.some(m=>m.record.id===state.selection?.id)&&<span className="vm-cluster-destination">{world.places.find(p=>p.id===route?.toId)?.name}</span>}{cluster===marker.id&&<div className="vm-cluster-menu fg-glass" style={{left:Math.max(8,Math.min((ref.current?.project(marker.point).x??0)-80,(container?.clientWidth??390)-208))-(ref.current?.project(marker.point).x??0)+23}}>{group.map(m=><button key={m.id} onClick={()=>select(m)} onDragOver={e=>e.preventDefault()} onDrop={e=>{if(m.kind==='place')drop(e.dataTransfer.getData('text/plain'),m.record)}}>{m.record.name}</button>)}</div>}</Marker>
 const chosen=state.selection?.id===marker.record.id||selectedEvent?.placeId===marker.record.id
 if(marker.kind==='person')return <Marker key={`${marker.id}:${dragEpoch}`} longitude={marker.point[0]} latitude={marker.point[1]} draggable={!compact} onDragEnd={e=>dragged(marker.record.id,[e.lngLat.lng,e.lngLat.lat])}><button className={`vm-person-marker ${chosen?'is-selected':''}`} aria-label={`Select ${marker.record.name} · ${marker.record.position.label}`} onClick={()=>select(marker)}><img src={portraitFor({personId:marker.record.id})} alt=""/><span>{marker.record.name.split(' ')[0]}</span></button></Marker>
 const Icon=icons[marker.record.kind],number=world.events.filter(e=>e.day===state.day&&e.status.toUpperCase()!=='CANCELLED').sort((a,b)=>a.at.localeCompare(b.at)).findIndex(e=>e.placeId===marker.record.id)+1
 return <Marker key={marker.id} longitude={marker.point[0]} latitude={marker.point[1]}><button className={`vm-place-marker ${chosen?'is-selected':''}`} data-place-id={marker.record.id} aria-label={`Route destination ${marker.record.name}`} onClick={()=>select(marker)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();drop(e.dataTransfer.getData('text/plain'),marker.record)}}><Icon size={19}/>{number>0&&<b>{number}</b>}<span>{marker.record.name}</span></button></Marker>
 })}
 {dayPoints.length>1&&!route&&<Source id="vm-day-order" type="geojson" data={line(dayPoints)}><Layer id="vm-day-order-line" type="line" paint={{'line-color':ready?token(mapAccent):'transparent','line-width':2,'line-opacity':.4,'line-dasharray':[2,3]}}/></Source>}
 {route&&<Source id="vm-route" type="geojson" data={line(replayFrame(route,draw).travelled)}><Layer id="vm-route-glow" type="line" paint={{'line-color':ready?token(mapAccent):'rgba(0,0,0,0)','line-width':14,'line-opacity':.12,'line-blur':5}}/><Layer id="vm-route-remaining" type="line" paint={{'line-color':ready?token(mapAccent):'rgba(0,0,0,0)','line-width':5,'line-opacity':state.proposal==='approved'?.25:.85,'line-opacity-transition':{duration:reduced?0:400}}}/></Source>}
 {route&&frame&&state.proposal==='approved'&&<Source id="vm-travelled" type="geojson" data={line(frame.travelled)}><Layer id="vm-route-progress" type="line" paint={{'line-color':ready?token(mapAccent):'rgba(0,0,0,0)','line-width':6}}/></Source>}
 {frame&&state.proposal==='approved'&&!reduced&&<Marker longitude={frame.point[0]} latitude={frame.point[1]} style={{zIndex:10}}><span className={`vm-replay-marker ${state.playing?'is-playing':''}`} aria-label="Simulated route position"><img src={portraitFor({personId:route!.fromId})} alt=""/></span></Marker>}
 </Map>
 <div className="vm-map-labels">{anchors.map(anchor=>{
  const box=labels.get(anchor.id);if(!box)return null
  const group=groups.find(g=>g[0].id===anchor.id)!
  return <button key={anchor.id} className="vm-map-label" style={{left:box.x,top:box.y,width:box.width,height:box.height}} onClick={()=>group.length>1?setCluster(group[0].id):select(group[0])}>{anchor.text}</button>
 })}</div>
 {!compact&&<div className="vm-map-controls fg-glass"><button aria-label="Zoom in" onClick={()=>{controller.manualMove();ref.current?.zoomIn({duration:reduced?0:200})}}>+</button><button aria-label="Zoom out" onClick={()=>{controller.manualMove();ref.current?.zoomOut({duration:reduced?0:200})}}>−</button><button aria-label="Recenter map" onClick={()=>controller.follow()}><MapPin size={18}/></button></div>}
 {!state.following&&!compact&&<button className="vm-follow" onClick={()=>controller.follow()}>Follow route</button>}
 {compact&&<button className="vm-mini-expand" onClick={onExpand}>Expand map</button>}
 <div className="vm-map-credit">© <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></div>
 </div>
}
