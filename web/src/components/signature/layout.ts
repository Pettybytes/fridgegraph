import {pointRadial} from 'd3'
import type {VillagePerson} from './types'
// Descriptive grouping only. Geometry encodes neither authority nor emotional proximity.
const categories:Record<string,string>={parent:'Family',mother:'Family',father:'Family',brother:'Family',sister:'Family',grandmother:'Family',grandfather:'Family',aunt:'Family',uncle:'Family',godmother:'Family',stepfather:'Family',stepmother:'Family',guardian:'Family',sitter:'Care',teacher:'School & activities',substitute_teacher:'School & activities',school_nurse:'School & activities',bus_driver:'School & activities',coach:'School & activities',parent_friend:'Connections',friend_parent:'Connections'}
export function relationshipGroup(type:string){return categories[type]??'Connections'}
export function relationshipLabel(type:string){return type.replaceAll('_',' ')}
export function orderedPeople(people:VillagePerson[]){return [...people].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id))}
/** Stable equal-radius slots. Input order is alphabetical, never a ranking. */
export function ringSlots(count:number){return Array.from({length:count},(_,i)=>{const angle=count===1?-Math.PI/2:count===2?i*Math.PI:-Math.PI/2+Math.PI/count+i*2*Math.PI/count;const [x,y]=pointRadial(angle+Math.PI/2,1);return {x:50+x*36,y:48+y*34}})}
