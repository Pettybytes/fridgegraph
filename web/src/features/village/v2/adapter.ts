import { directories, networks } from './fixture'
import type { Member } from './fixture'
export type VillagePerson = Member & { canApprove: boolean; note?: string; sharedCount?: string }
export const GUIDE_ID='p_demo_guide'
type SharedConnection = Omit<(typeof directories)[number], 'roster'> & { roster?: {id:string;name:string}[]; countLabel:string }
export type VillageProjection = { state:'mock'; child: VillagePerson; households:{id:string;label:string}[]; people:VillagePerson[]; directories:SharedConnection[]; directoryAccess:boolean }
// Mock upstream boundary. Real resolver authorization must replace these projections at integration.
const scope: Record<string,string[]> = {p_mom:['p_nora'],p_dad:['p_nora'],p_gma:['p_nora','p_avery'],p_priya:['p_nora','p_malik'],p_dana:['p_jax'],p_ray:['p_jax'],p_rosa:['p_emma'],p_felicia:['p_taylor'],p_simone:['p_micah','p_avery'],p_dwayne:['p_malik']}
const full = new Set(['p_mom','p_dad','p_dana','p_ray','p_rosa','p_felicia','p_simone','p_dwayne'])
export function villageChildren(personId:string) { return networks.flatMap(n=>n.members.filter(p=>n.children.includes(p.id) && (personId===GUIDE_ID || scope[personId]?.includes(p.id))).map(p=>({id:p.id,name:p.name}))) }
export function readVillage(personId:string,childId:string):VillageProjection {
 if (personId!==GUIDE_ID && !scope[personId]?.includes(childId)) throw new Error('UNAUTHORIZED')
 const network=networks.find(n=>n.children.includes(childId))!
 const authority=personId===GUIDE_ID || full.has(personId)
 const people=network.members.filter(p=>authority ? !(personId==='p_felicia' && p.id==='p_imani') : p.id===childId || p.id===personId).map(p=>({ ...p, ...(networks.filter(n=>n.members.some(m=>m.id===p.id)).length>1 ? {sharedCount:`${networks.filter(n=>n.members.some(m=>m.id===p.id)).length} family networks`} : {}), households:!authority ? [] : personId==='p_felicia' && p.id==='p_skye' ? [] : p.households, canApprove:authority && network.approvers.includes(p.id), ...(p.id==='p_skye' && personId==='p_felicia' ? {note:'Shared half-sibling relationship only. Other details are not shared with you.'}:{}), ...(p.id==='p_marcusv'?{note:'Pickup and schedule shared for Taylor. Consent authority is not delegated.'}:{}), ...(p.id==='p_oscar'?{note:'May supervise Malik. No driving or consent authority.'}:{}), ...(p.id==='p_gma' && childId==='p_avery'?{note:'Pickup help for Avery only; no calendar or care information shared.'}:{}) }))
 // Directory payloads are scoped BEFORE reaching the view. No hidden roster names are retained.
 const shared=directories.filter(d=>d.children.includes(childId) && authority).map(d=>({
  id:d.id,name:d.name,kind:d.kind,adult:d.adult,children:[childId],
  countLabel:connectionCount(d.id),
  // Aggregates are separate from identity projection: no hidden roster IDs reach normal viewers.
  ...('roster' in d ? {roster:d.roster?.filter(p=>personId===GUIDE_ID || scope[personId]?.includes(p.id))} : {}),
 }))
 return {state:'mock', child:people.find(p=>p.id===childId)!,people,households:network.households.filter(h=>people.some(p=>p.households.includes(h.id))),directories:shared,directoryAccess:authority}
}
export function connections(data:VillageProjection,id:string):{name:string;relationship:string;note?:string}[] {
 const group=data.directories.find(d=>d.id===id || d.adult.id===id)
 if(group) return group.kind==='Team' && group.roster ? [...group.roster.map(p=>({name:p.name,relationship:'Team roster'})),{name:group.adult.name,relationship:group.adult.relationship}] : [{name:data.child.name,relationship:group.name},{name:group.adult.name,relationship:group.adult.relationship}]
 const person=data.people.find(p=>p.id===id)
 return person ? [{name:person.name,relationship:person.relationship,note:person.note},{name:data.child.name,relationship:'Selected child'}] : []
}

export function connectionCount(id:string):string {
 const group=directories.find(d=>d.id===id)
 if(!group)return ''
 const count=group.roster?.length ?? group.children.length
 // Zion has no family mapping in the source. Do not manufacture a fourth family.
 const families=group.children.map(id=>networks.find(n=>n.children.includes(id))?.id)
 const familyCount=group.roster && group.roster.some(p=>!networks.some(n=>n.children.includes(p.id))) ? null : new Set(families.filter(Boolean)).size
 return group.kind==='School' ? `${count} students` : `${count} children${familyCount ? ` from ${familyCount} families` : ''}`
}
export function ecosystem() {
 const shared=directories.map(d=>({id:d.id,name:d.name,countLabel:connectionCount(d.id),networkIds:networks.filter(n=>n.children.some(c=>d.children.includes(c))).map(n=>n.id)}))
 const helpers=['p_priya','p_gma'].map(id=>({id,name:networks.flatMap(n=>n.members).find(p=>p.id===id)!.name,countLabel:'2 family networks',networkIds:networks.filter(n=>n.members.some(p=>p.id===id)).map(n=>n.id)}))
 return {networks:structuredClone(networks),shared:[...shared,...helpers]}
}
