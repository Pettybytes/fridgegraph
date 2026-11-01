import {useEffect,useRef,useState} from 'react'
import Map,{Marker,Source,Layer,type MapRef} from 'react-map-gl/maplibre'
import {useReducedMotion} from 'motion/react'
import {MapPin,School,House,Trees,Flag,Building2} from 'lucide-react'
import {portraitFor} from '@/components/fg/portraits'
import type {MapController,MapState} from './controller'
import type {Point,Place} from './types'
import {replayFrame,unclutter} from './model'
import 'maplibre-gl/dist/maplibre-gl.css'
const styleUrls={light:'https://tiles.openfreemap.org/styles/positron',dark:'https://tiles.openfreemap.org/styles/dark'}
const icons={school:School,home:House,park:Trees,field:Flag,venue:Building2}
export function MapCanvas({controller,state,theme,compact=false,bottom=0,onExpand}:{controller:MapController;state:MapState;theme:'light'|'dark';compact?:boolean;bottom?:number;onExpand?:()=>void}){
 const ref=useRef<MapRef>(null),reduced=useReducedMotion(),[ready,setReady]=useState(false),[failed,setFailed]=useState(false),[camera,setCamera]=useState(0),[cluster,setCluster]=useState<string|null>(null),[dragEpoch,setDragEpoch]=useState(0)
 const {world,route}=state,frame=route?replayFrame(route,state.progress):null
 const token=(name:string)=>{const canvas=document.createElement('canvas'),context=canvas.getContext('2d')!;context.fillStyle=getComputedStyle(document.documentElement).getPropertyValue(name);context.fillRect(0,0,1,1);const [r,g,b]=context.getImageData(0,0,1,1).data;return `rgb(${r},${g},${b})`}
 useEffect(()=>{if(!ready||!ref.current||compact)return;const map=ref.current;const points=route?.geometry??world?.places.map(p=>p.point)??[];if(!points.length)return;const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);map.fitBounds([[Math.min(...xs),Math.min(...ys)],[Math.max(...xs),Math.max(...ys)]],{padding:{top:90,right:85,bottom:bottom+85,left:85},duration:reduced?0:650,maxZoom:14.5})},[ready,state.fitRevision]) // Explicit user route/day/recenter only, not polls or layout changes.
 useEffect(()=>{const map=ref.current?.getMap();if(!map)return;const setup=()=>{
  for(const layer of map.getStyle().layers??[]){if(layer.type==='symbol'&&/poi|housenumber|minor|transit/.test(layer.id))map.setLayoutProperty(layer.id,'visibility','none');if(layer.type==='background')map.setPaintProperty(layer.id,'background-color',token('--fg-canvas'));if(layer.type==='fill'&&/^water/.test(layer.id))map.setPaintProperty(layer.id,'fill-color',token('--fg-selection'))}
  const building=map.getStyle().layers.find(l=>l.type==='fill'&&'source-layer' in l&&l['source-layer']==='building');if(building&&'source' in building&&!map.getLayer('vm-buildings'))map.addLayer({id:'vm-buildings',type:'fill-extrusion',source:building.source,'source-layer':'building',minzoom:15.5,paint:{'fill-extrusion-color':token('--fg-muted'),'fill-extrusion-opacity':.18,'fill-extrusion-height':['coalesce',['get','render_height'],['get','height'],8]}})
 };map.on('style.load',setup);if(map.isStyleLoaded())setup();return()=>{map.off('style.load',setup)}},[ready,theme])
 useEffect(()=>{if(!ready||compact||reduced||!state.playing||!state.following||!frame)return;ref.current?.easeTo({center:frame.point,pitch:35,duration:0,padding:{top:40,right:40,bottom:bottom+40,left:40}})},[state.progress,state.playing,state.following,ready])
 useEffect(()=>{if(!ready||!state.playing||state.progress!==0||!state.following||reduced)return;ref.current?.easeTo({pitch:35,duration:700})},[state.playing])
 if(!world)return null
 const markers=[...world.places.map(p=>({id:`place:${p.id}`,kind:'place' as const,record:p,point:p.point})),...world.people.map(p=>({id:`person:${p.id}`,kind:'person' as const,record:p,point:p.position.point}))]
 const groups=ready?unclutter(markers,item=>{const p=ref.current?.project(item.point);return p?[p.x,p.y]:[0,0]},compact?24:40):[]
 const select=(marker:typeof markers[number])=>{controller.select({kind:marker.kind,id:marker.record.id});setCluster(null)}
 function drop(personId:string,place:Place){if(world?.people.some(p=>p.id===personId))void controller.route(personId,place.id)}
 function dragged(personId:string,point:Point){const projected=ref.current?.project(point);if(projected){const target=world?.places.find(place=>{const q=ref.current!.project(place.point);return Math.hypot(projected.x-q.x,projected.y-q.y)<55});if(target)drop(personId,target)}setDragEpoch(e=>e+1)}
 const line=(coordinates:Point[])=>({type:'Feature' as const,properties:{},geometry:{type:'LineString' as const,coordinates}})
 const selectedEvent=state.selection?.kind==='event'?world.events.find(e=>e.id===state.selection!.id):null
 if(failed)return <section className="vm-map-fallback" role="region" aria-label="Map list fallback"><h2>Map unavailable</h2><p>Use the places and timeline below. Routing controls still work.</p><ul>{world.places.map(p=><li key={p.id}><button onClick={()=>controller.select({kind:'place',id:p.id})}>{p.name}</button></li>)}</ul><ol>{world.events.filter(e=>e.day===state.day).map(e=><li key={e.id}>{e.title} · {world.places.find(p=>p.id===e.placeId)?.name??'Place not recorded'}</li>)}</ol></section>
 return <div className={`vm-canvas ${compact?'is-mini':''}`} data-camera={camera} style={{viewTransitionName:'village-map'}}>
 {!ready&&<div className="vm-tile-skeleton" role="status">Loading the map…</div>}
 <Map ref={ref} initialViewState={{longitude:-83.079,latitude:42.352,zoom:12.1}} mapStyle={styleUrls[theme]} attributionControl={{compact:true}} interactive={!compact} onLoad={()=>setReady(true)} onError={()=>setFailed(true)} onMove={()=>setCamera(n=>n+1)} onMoveStart={event=>{if(event.originalEvent)controller.manualMove()}} onZoomStart={event=>{if(event.originalEvent)controller.manualMove()}}>
 {ready&&groups.map(group=>{const marker=group[0];if(group.length>1)return <Marker key={group.map(m=>m.id).join(':')} longitude={marker.point[0]} latitude={marker.point[1]}><button className="vm-cluster" aria-label={`${group.length} overlapping people and places`} onClick={()=>setCluster(cluster===marker.id?null:marker.id)}>{group.length}</button>{cluster===marker.id&&<div className="vm-cluster-menu fg-glass">{group.map(m=><button key={m.id} onClick={()=>select(m)} onDragOver={e=>e.preventDefault()} onDrop={e=>{if(m.kind==='place')drop(e.dataTransfer.getData('text/plain'),m.record)}}>{m.record.name}</button>)}</div>}</Marker>
 const chosen=state.selection?.id===marker.record.id||selectedEvent?.placeId===marker.record.id
 if(marker.kind==='person')return <Marker key={`${marker.id}:${dragEpoch}`} longitude={marker.point[0]} latitude={marker.point[1]} draggable={!compact} onDragEnd={e=>dragged(marker.record.id,[e.lngLat.lng,e.lngLat.lat])}><button className={`vm-person-marker ${chosen?'is-selected':''}`} aria-label={`Select ${marker.record.name} · ${marker.record.position.label}`} onClick={()=>select(marker)}><img src={portraitFor({personId:marker.record.id})} alt=""/><span>{marker.record.name.split(' ')[0]}</span></button></Marker>
 const Icon=icons[marker.record.kind],number=world.events.filter(e=>e.day===state.day&&e.status!=='CANCELLED').sort((a,b)=>a.at.localeCompare(b.at)).findIndex(e=>e.placeId===marker.record.id)+1
 return <Marker key={marker.id} longitude={marker.point[0]} latitude={marker.point[1]}><button className={`vm-place-marker ${chosen?'is-selected':''}`} data-place-id={marker.record.id} aria-label={`Route destination ${marker.record.name}`} onClick={()=>select(marker)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();drop(e.dataTransfer.getData('text/plain'),marker.record)}}><Icon size={19}/>{number>0&&<b>{number}</b>}<span>{marker.record.name}</span></button></Marker>
 })}
 {route&&<Source id="vm-route" type="geojson" data={line(route.geometry)}><Layer id="vm-route-glow" type="line" paint={{'line-color':ready?token('--fg-primary'):'rgba(0,0,0,0)','line-width':14,'line-opacity':.12,'line-blur':5}}/><Layer id="vm-route-remaining" type="line" paint={{'line-color':ready?token('--fg-primary'):'rgba(0,0,0,0)','line-width':5,'line-opacity':state.proposal==='approved'?.25:.85,'line-opacity-transition':{duration:reduced?0:400}}}/></Source>}
 {route&&frame&&state.proposal==='approved'&&<Source id="vm-travelled" type="geojson" data={line(frame.travelled)}><Layer id="vm-route-progress" type="line" paint={{'line-color':ready?token('--fg-primary'):'rgba(0,0,0,0)','line-width':6}}/></Source>}
 {frame&&state.proposal==='approved'&&!reduced&&<Marker longitude={frame.point[0]} latitude={frame.point[1]}><span className={`vm-replay-marker ${state.playing?'is-playing':''}`} aria-label="Simulated route position"><img src={portraitFor({personId:route!.fromId})} alt=""/></span></Marker>}
 </Map>
 {!compact&&<div className="vm-map-controls fg-glass"><button aria-label="Zoom in" onClick={()=>ref.current?.zoomIn({duration:reduced?0:200})}>+</button><button aria-label="Zoom out" onClick={()=>ref.current?.zoomOut({duration:reduced?0:200})}>−</button><button aria-label="Recenter map" onClick={()=>controller.follow()}><MapPin size={18}/></button></div>}
 {!state.following&&!compact&&<button className="vm-follow" onClick={()=>controller.follow()}>Follow route</button>}
 {compact&&<button className="vm-mini-expand" onClick={onExpand}>Expand map</button>}
 <div className="vm-map-credit">© <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></div>
 </div>
}
