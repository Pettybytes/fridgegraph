import { directories, networks } from './fixture'
import type { Member } from './fixture'
export type VillagePerson = Member & { canApprove: boolean; note?: string }
export type VillageProjection = { state:'mock'; child: VillagePerson; households:{id:string;label:string}[]; people:VillagePerson[]; directories:typeof directories; directoryAccess:boolean }
// Mock upstream boundary. Real resolver authorization must replace these projections at integration.
const scope: Record<string,string[]> = {p_mom:['p_nora'],p_dad:['p_nora'],p_gma:['p_nora','p_avery'],p_priya:['p_nora','p_malik'],p_dana:['p_jax'],p_ray:['p_jax'],p_rosa:['p_emma'],p_felicia:['p_taylor'],p_simone:['p_micah','p_avery'],p_dwayne:['p_malik']}
const full = new Set(['p_mom','p_dad','p_dana','p_ray','p_rosa','p_felicia','p_simone','p_dwayne'])
export function villageChildren(personId:string) { return networks.flatMap(n=>n.members.filter(p=>n.children.includes(p.id) && scope[personId]?.includes(p.id)).map(p=>({id:p.id,name:p.name}))) }
export function readVillage(personId:string,childId:string):VillageProjection {
 if (!scope[personId]?.includes(childId)) throw new Error('UNAUTHORIZED')
 const network=networks.find(n=>n.children.includes(childId))!
 const authority=full.has(personId)
 const people=network.members.filter(p=>authority ? !(personId==='p_felicia' && p.id==='p_imani') : p.id===childId || p.id===personId).map(p=>({ ...p, households:!authority ? [] : personId==='p_felicia' && p.id==='p_skye' ? [] : p.households, canApprove:authority && network.approvers.includes(p.id), ...(p.id==='p_skye' && personId==='p_felicia' ? {note:'Shared half-sibling relationship only. Other details are not shared with you.'}:{}), ...(p.id==='p_marcusv'?{note:'Pickup and schedule shared for Taylor. Consent authority is not delegated.'}:{}), ...(p.id==='p_oscar'?{note:'May supervise Malik. No driving or consent authority.'}:{}), ...(p.id==='p_gma' && childId==='p_avery'?{note:'Pickup help for Avery only; no calendar or care information shared.'}:{}) }))
 // Directory payloads are scoped BEFORE reaching the view. No hidden roster names are retained.
 const shared=directories.filter(d=>d.children.includes(childId) && authority).map(d=>({...d,children:[childId],...('roster' in d?{roster:d.roster}:{} )}))
 return {state:'mock', child:people.find(p=>p.id===childId)!,people,households:network.households.filter(h=>people.some(p=>p.households.includes(h.id))),directories:shared,directoryAccess:authority}
}
export function connections(data:VillageProjection,id:string):{name:string;relationship:string;note?:string}[] {
 const group=data.directories.find(d=>d.id===id || d.adult.id===id)
 if(group) return group.kind==='Team' && group.roster ? [...group.roster.map(p=>({name:p.name,relationship:'Team roster'})),{name:group.adult.name,relationship:group.adult.relationship}] : [{name:data.child.name,relationship:group.name},{name:group.adult.name,relationship:group.adult.relationship}]
 const person=data.people.find(p=>p.id===id)
 return person ? [{name:person.name,relationship:person.relationship,note:person.note},{name:data.child.name,relationship:'Selected child'}] : []
}
