import { useMemo, useRef, useEffect, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import type {ForceGraphMethods,NodeObject,LinkObject} from 'react-force-graph-2d'
import { ecosystem, GUIDE_ID } from './adapter'
import { ScopedVillage } from './VillageV2'
const palette=['#7559a1','#397d79','#a46b44','#52689a','#8b5880','#527b53']
export function DemoGuide() {
 const source=useMemo(ecosystem,[])
 const [child,setChild]=useState<string|null>(null)
 const [shared,setShared]=useState<string|null>(null)
 const ref=useRef<HTMLDivElement>(null)
 const [width,setWidth]=useState(800)
 useEffect(()=>{if(!ref.current||typeof ResizeObserver==='undefined')return;const o=new ResizeObserver(e=>setWidth(e[0].contentRect.width));o.observe(ref.current);return()=>o.disconnect()},[])
 const graph=useMemo(()=>{
  const spacing=Math.min(Math.max(660,width)*.3,290)
  const families=source.networks.map((n,i)=>({id:n.id,name:n.title,kind:'family',fx:(i%3-1)*spacing,fy:i<3?-160:160,color:palette[i]}))
  const sharedNodes=source.shared.map((s,i)=>({id:s.id,name:s.name,kind:'shared',fx:(i-2)*spacing*.45,fy:0,color:'#64738b'}))
  return {nodes:[...families,...sharedNodes],links:source.shared.flatMap(s=>s.networkIds.map(id=>({source:s.id,target:id})))}
 },[source,width])
 const graphRef=useRef<ForceGraphMethods<NodeObject<(typeof graph.nodes)[number]>,LinkObject<(typeof graph.nodes)[number],(typeof graph.links)[number]>>>(undefined)
 function open(id:string) {const network=source.networks.find(n=>n.id===id);if(network){setChild(network.children[0]);setShared(null)}else setShared(id)}
 return <section className="vv-guide" aria-label="Demo guide ecosystem" data-state="unavailable" data-mode="mock" data-projection="derived">
  <div className="vv-guide-notice"><strong>Demo guide · read-only mock</strong><p>Demo guide: sees the whole fictional ecosystem. No real family would have this view.</p></div>
  {child?<><button className="vv-guide-back" onClick={()=>{setChild(null);setShared(null)}}>Back to all six networks</button><ScopedVillage key={child} personId={GUIDE_ID} initialChild={child}/></>:<>
   <h2>Six family networks</h2><p className="vv-intro">Explore a family cluster, or follow the shared team, class, bus and caregivers between them.</p>
   <div className="vv-map vv-ecosystem-map" ref={ref}><ForceGraph2D ref={graphRef} onEngineStop={()=>{graphRef.current?.zoom(.9,0);graphRef.current?.centerAt(0,0,0)}} width={Math.max(660,width)} height={480} graphData={graph} cooldownTicks={0} enableNodeDrag={false} enableZoomInteraction={false} enablePanInteraction={false} nodeCanvasObject={(node,ctx)=>{const n=node as typeof graph.nodes[number],x=node.x??n.fx,y=node.y??n.fy;ctx.fillStyle=n.color;ctx.beginPath();ctx.roundRect(x-(n.kind==='family'?58:12),y-20,n.kind==='family'?116:24,40,n.kind==='family'?10:12);ctx.fill();ctx.textAlign='center';ctx.font=n.kind==='family'?'bold 12px sans-serif':'11px sans-serif';ctx.fillStyle=n.kind==='family'?'#fff':'#26344c';ctx.fillText(n.name,x,y+(n.kind==='family'?4:37))}} onNodeClick={node=>open(String(node.id))} linkColor={()=>'#c6b5da'} linkWidth={2}/><p>Lines show recorded mock connections between networks. Use the matching buttons below to explore.</p></div>
   <div className="vv-guide-networks">{source.networks.map((n,i)=><button key={n.id} style={{borderTopColor:palette[i]}} onClick={()=>open(n.id)}><strong>{n.title}</strong><span>{n.members.filter(p=>n.children.includes(p.id)).map(p=>p.name).join(', ')}</span><small>{n.households.length} household{n.households.length===1?'':'s'} · Open village</small>{!source.shared.some(s=>s.networkIds.includes(n.id))&&<small>No shared connections recorded</small>}</button>)}</div>
   <section className="vv-directory"><h2>Connections across families</h2><div>{source.shared.map(s=><article key={s.id}><button onClick={()=>open(s.id)}><strong>{s.name}</strong><span className="vv-count">{s.countLabel}</span></button></article>)}</div></section>
   {shared&&<section className="vv-guide-shared" aria-label="Shared network detail"><h2>{source.shared.find(s=>s.id===shared)?.name}</h2><p>Connected family networks in this fictional demo:</p>{source.shared.find(s=>s.id===shared)?.networkIds.map(id=><button key={id} onClick={()=>open(id)}>{source.networks.find(n=>n.id===id)?.title} · Open village</button>)}</section>}
  </>}
 </section>
}
