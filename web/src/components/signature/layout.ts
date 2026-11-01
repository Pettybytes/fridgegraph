import {pointRadial} from 'd3'
import type {VillagePerson} from './types'
// Descriptive grouping only. Geometry encodes neither authority nor emotional proximity.
const categories:Record<string,string>={parent:'Family',mother:'Family',father:'Family',brother:'Family',sister:'Family',grandmother:'Family',grandfather:'Family',aunt:'Family',uncle:'Family',godmother:'Family',stepfather:'Family',stepmother:'Family',guardian:'Family',sitter:'Care',teacher:'School & activities',substitute_teacher:'School & activities',school_nurse:'School & activities',bus_driver:'School & activities',coach:'School & activities',parent_friend:'Connections',friend_parent:'Connections'}
export function relationshipGroup(type:string){return categories[type]??'Connections'}
export function relationshipLabel(type:string){return type.replaceAll('_',' ')}
export function orderedPeople(people:VillagePerson[]){return [...people].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id))}
/** Stable equal-radius slots. Input order is alphabetical, never a ranking. */
export function ringSlots(count:number){return Array.from({length:count},(_,i)=>{const angle=count===1?-Math.PI/2:count===2?i*Math.PI:-Math.PI/2+Math.PI/count+i*2*Math.PI/count;const [x,y]=pointRadial(angle+Math.PI/2,1);return {x:50+x*36,y:48+y*34}})}

/** Three concentric categories; radius describes the record type, never authority or closeness.
 * Overflow is explicit instead of shrinking portraits. Mobile crops concentric ellipses into arcs below the child, with one
 * portrait per category and explicit overflow, so names retain a readable measure. */
export function concentricLayout(people:VillagePerson[],narrow:boolean,compact=false,audience=false){
 const width=narrow?360:1000,height=audience?(narrow?700:640):compact?460:narrow?1140:840
 const centerY=narrow&&!compact&&!audience?150:height/2
 const buckets=audience?[{label:'Frozen audience',people:orderedPeople(people)}]:compact?[{label:'Shared connections',people:orderedPeople(people)}]:[
  {label:'Household',people:people.filter(p=>p.group==='Household')},
  {label:'Family',people:people.filter(p=>p.group==='Family')},
  {label:'Caregivers, school & activities',people:people.filter(p=>!['Household','Family'].includes(p.group))},
 ]
 const nodes:{person:VillagePerson;x:number;y:number}[]=[]
 const rings=buckets.map((bucket,index)=>{
  const rx=audience?(narrow?100:350):compact?(narrow?110:310):narrow?[110,140,160][index]:[210,315,430][index]
  const ry=audience?(narrow?250:235):compact?155:narrow?[450,650,850][index]:[140,300,330][index]
  const capacity=audience?(narrow?2:6):compact?2:narrow?1:[2,2,4][index]
  const visible=orderedPeople(bucket.people).slice(0,capacity),overflow=orderedPeople(bucket.people).slice(capacity)
  visible.forEach((person,i)=>{
   const angle=audience?(narrow?i*Math.PI:(visible.length===2?Math.PI/2:0)+i*2*Math.PI/visible.length):compact?(i===0?-.8:Math.PI-.8):narrow?[-2.3,2.3,Math.PI][index]:(index===0?Math.PI/2+i*Math.PI:index===1?i*Math.PI:Math.PI/4+i*Math.PI/2)
   nodes.push({person,x:50+Math.sin(angle)*rx/width*100,y:(centerY-Math.cos(angle)*ry)/height*100})
  })
  return {index,label:bucket.label,rx,ry,overflow,moreX:narrow?89:50-rx/width*100,moreY:50+(index-1)*(narrow?10:4)}
 })
 return {width,height,centerY,nodes,rings}
}
