import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { Dialog } from 'radix-ui'
import { X, ShieldCheck, Users } from 'lucide-react'
import { useSession } from '@/features/personas/Session'
import { connections, readVillage, villageChildren, GUIDE_ID } from './adapter'
import './village-v2.css'
import { DemoGuide } from './DemoGuide'
import { DadStatusChip } from '@/features/shared-status/DadStatusChip'
import { sampleDadStatus } from '@/features/shared-status/sampleStatus'
const colors=['#7559a1','#397d79','#a46b44','#52689a']
export function VillageV2() {
 const {session}=useSession()
 if(!session) return null
 if(session.persona.personId===GUIDE_ID)return <DemoGuide/>
 return <ScopedVillage key={session.generation} personId={session.persona.personId} />
}
export function ScopedVillage({personId, initialChild}:{personId:string;initialChild?:string}) {
 const children=useMemo(()=>villageChildren(personId),[personId])
 const [childId,setChild]=useState(()=>{const id=new URLSearchParams(location.hash.split('?')[1]??'').get('childId'); return initialChild??children.find(p=>p.id===id)?.id??children[0]?.id??''})
 const [selected,setSelected]=useState<string|null>(null)
 const box=useRef<HTMLDivElement>(null)
 const [width,setWidth]=useState(700)
 useEffect(()=>{if(!box.current || typeof ResizeObserver==='undefined')return; const observer=new ResizeObserver(entries=>setWidth(entries[0].contentRect.width));observer.observe(box.current);return()=>observer.disconnect()},[])
 const data=useMemo(()=>childId?readVillage(personId,childId):null,[personId,childId])
 useEffect(()=>{
  const follow=()=>{const id=new URLSearchParams(location.hash.split('?')[1]??'').get('person'); if(id)setSelected(data?.people.some(p=>p.id===id)||data?.directories.some(d=>d.adult.id===id)?id:null)}
  follow();window.addEventListener('hashchange',follow);return()=>window.removeEventListener('hashchange',follow)
 },[data])
 const graph=useMemo(()=>{
  if(!data)return {nodes:[],links:[]}
  const others=[...data.people.filter(p=>p.id!==childId),...data.directories.map(d=>({id:d.id,name:d.name,households:[] as string[]}))]
  return {nodes:[{id:childId,name:data.child.name,fx:0,fy:0,color:'#7559a1',center:true},...others.map((p,i)=>{const angle=i/others.length*Math.PI*2;return {id:p.id,name:p.name,fx:Math.cos(angle)*Math.min(190,width*.28),fy:Math.sin(angle)*135,color:colors[Math.max(0,data.households.findIndex(h=>p.households.includes(h.id)))%colors.length],center:false}})],links:others.map(p=>({source:childId,target:p.id}))}
 },[data,childId,width])
 if(!data)return <section className="vv-empty"><h2>No village shared yet</h2><p>This person's village is not connected to the demo view yet.</p></section>
 const selectedPerson=data.people.find(p=>p.id===selected)
 const selectedGroup=data.directories.find(p=>p.id===selected || p.adult.id===selected)
 const selectedName=selectedPerson?.name ?? selectedGroup?.name ?? ''
 const personButton=(id:string)=>{const p=data.people.find(p=>p.id===id)!;return <button className="vv-person" key={p.id} onClick={()=>setSelected(p.id)}><span className="vv-initial" aria-hidden="true">{p.name.split(' ').map(w=>w[0]).slice(0,2).join('')}</span><span><strong>{p.name}</strong><small>{p.id===childId?'Selected child':p.relationship}</small>{p.sharedCount&&<small>{p.sharedCount}</small>}</span>{p.canApprove&&<span className="vv-authority"><ShieldCheck size={13}/>can approve</span>}</button>}
 return <section className="village-v2" aria-label="Authorized Living Village" data-state="unavailable" data-projection="derived" data-mode="mock">
  <div className="vv-toolbar"><label>Village for<select value={childId} onChange={e=>{setSelected(null);setChild(e.target.value);location.hash=`#/village?childId=${encodeURIComponent(e.target.value)}`}}>{children.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><span>Demo village · sample connections</span></div>
  <p className="vv-intro">A village around {data.child.name.split(' ')[0]}. Explore the people and places shared with you.</p>
  <div className="vv-map" ref={box} aria-label={`${data.child.name}'s connection map`}>
   <ForceGraph2D width={width} height={380} graphData={graph} enableNodeDrag={false} enableZoomInteraction={false} enablePanInteraction={false} cooldownTicks={0} nodeCanvasObject={(node,ctx)=>{const n=node as typeof graph.nodes[number]; const x=node.x??n.fx,y=node.y??n.fy;ctx.beginPath();ctx.arc(x,y,n.center?25:15,0,Math.PI*2);ctx.fillStyle=n.color;ctx.fill();ctx.fillStyle='#fff';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillText(n.name.split(' ').map(w=>w[0]).slice(0,2).join(''),x,y+4);ctx.fillStyle='#26344c';ctx.font='12px sans-serif';ctx.fillText(n.name,x,y+(n.center?43:31))}} onNodeClick={node=>setSelected(String(node.id))} linkColor={()=>'#d6cce4'} linkWidth={1.5} minZoom={.4} maxZoom={1} d3VelocityDecay={1}/>
   <p>Every connection below can be opened by keyboard.</p>
  </div>
  <div className="vv-clusters">{data.households.map((h,i)=><section key={h.id} className="vv-household" style={{borderTopColor:colors[i%colors.length]}}><h2><Users size={17}/>{h.label}</h2>{data.people.filter(p=>p.households.includes(h.id)).map(p=>personButton(p.id))}</section>)}
   {!!data.people.filter(p=>!p.households.length).length&&<section className="vv-household vv-support"><h2>People in this village</h2>{data.people.filter(p=>!p.households.length).map(p=>personButton(p.id))}</section>}
  </div>
  {!!data.directories.length&&<section className="vv-directory"><h2>Shared connections</h2><p>Shared groups connect people. They do not share private family records.</p><div>{data.directories.map(d=><article key={d.id}><button onClick={()=>setSelected(d.id)}><small>{d.kind}</small><strong>{d.name}</strong><span className="vv-count">{d.countLabel}</span></button><button className="vv-directory-adult" onClick={()=>setSelected(d.adult.id)}>{d.adult.name}<span>{d.adult.relationship}</span></button></article>)}</div></section>}
  {!data.directoryAccess&&<p className="vv-boundary">Only this child's connection to you is shared in this view. A grant for one child does not open another household.</p>}
  <Dialog.Root open={!!selected} onOpenChange={open=>{if(!open)setSelected(null)}}><Dialog.Portal><Dialog.Overlay className="vv-overlay"/><Dialog.Content className="vv-sheet"><Dialog.Title>{selectedName}</Dialog.Title><Dialog.Description>Connections shared with you in {data.child.name.split(' ')[0]}'s village.</Dialog.Description><Dialog.Close aria-label="Close connection" className="vv-close"><X size={20}/></Dialog.Close>{selectedPerson&&<DadStatusChip personId={selectedPerson.id} sharedStatus={sampleDadStatus(selectedPerson.id)} mode="mock" />}{selectedPerson?.canApprove&&<p className="vv-authority">Can approve for {data.child.name.split(' ')[0]} · recorded household authority</p>}<p className="vv-count">{selectedGroup?.countLabel ?? selectedPerson?.sharedCount}</p><ul>{connections(data,selected??'').map((p,i)=><li key={i}><strong>{p.name}</strong><span>{p.relationship}</span>{p.note&&<p>{p.note}</p>}</li>)}</ul>{selectedGroup&&<p className="vv-boundary">Directory information only. Other children's care plans, schedules, contact information and private villages are not shared here.</p>}</Dialog.Content></Dialog.Portal></Dialog.Root>
 </section>
}
