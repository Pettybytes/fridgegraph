import { describe,it,expect } from 'vitest'
import { createMockRosinaAdapter } from '@/features/rosina/adapter'
import { createMockAuthAdapter } from '@/features/personas/auth'
import { networks } from './fixture'
import { connections,readVillage,villageChildren } from './adapter'
describe('Cast v2 scoped village projections',()=>{
 it('contains six networks and ten family children, with cross-household support facts',()=>{
  expect(networks).toHaveLength(6)
  expect(networks.flatMap(n=>n.children)).toHaveLength(10)
  expect(networks.filter(n=>n.members.some(p=>p.id==='p_priya')).map(n=>n.id)).toEqual(['ellison','ferris'])
  expect(networks.filter(n=>n.members.some(p=>p.id==='p_gma')).map(n=>n.id)).toEqual(['ellison','lee'])
  expect(networks.find(n=>n.id==='vance-reyes')?.households).toHaveLength(3)
 })
 it.each([['p_mom',['p_nora']],['p_priya',['p_nora','p_malik']],['p_dana',['p_jax']],['p_rosa',['p_emma']]])('%s cannot select an unauthorized child',(person,ids)=>{
  expect(villageChildren(person as string).map(p=>p.id)).toEqual(ids)
  expect(()=>readVillage(person as string,person==='p_rosa'?'p_nora':'p_emma')).toThrow('UNAUTHORIZED')
 })
 it('Kendra can see the team directory but cannot traverse to another private village',()=>{
  const data=readVillage('p_mom','p_nora')
  expect(connections(data,'g_tigers').map(p=>p.name)).toEqual(['Nora Ellison','Jax Coleman','Micah','Zion','Marcus Reyes'])
  expect(data.people.some(p=>p.id==='p_jax')).toBe(false)
  expect(connections(data,'p_jax')).toEqual([])
  expect(()=>readVillage('p_mom','p_jax')).toThrow('UNAUTHORIZED')
 })
 it('teacher and bus projections contain only the selected child, not other household connections',()=>{
  const data=readVillage('p_dana','p_jax')
  expect(connections(data,'p_price').map(p=>p.name)).toEqual(['Jax Coleman','Angela Price'])
  expect(connections(data,'p_holt').map(p=>p.name)).toEqual(['Jax Coleman','Gary Holt'])
  expect(data.directories.find(d=>d.id==='g_route14')?.children).toEqual(['p_jax'])
 })
 it('Rosa has guardian approval without parent inference, and no foreign family records',()=>{
  const data=readVillage('p_rosa','p_emma')
  expect(data.people.find(p=>p.id==='p_rosa')).toMatchObject({relationship:'grandmother',canApprove:true})
  expect(JSON.stringify(data)).not.toMatch(/p_nora|p_jax|p_malik|p_simone|p_felicia/)
  expect(connections(data,'p_price').map(p=>p.name)).toEqual(['Emma','Angela Price'])
 })
 it('Priya’s household contexts remain independent and exclude other helpers and directory facts',()=>{
  const nora=readVillage('p_priya','p_nora'),malik=readVillage('p_priya','p_malik')
  expect(nora.people.map(p=>p.id)).toEqual(['p_nora','p_priya'])
  expect(malik.people.map(p=>p.id)).toEqual(['p_malik','p_priya'])
  expect(JSON.stringify(malik)).not.toMatch(/Nora|Kendra|careplan/)
  expect(nora.directories).toEqual([])
  expect(connections(malik,'p_mom')).toEqual([])
 })
 it('keeps Skye existence-only for Felicia and never infers stepfather approval',()=>{
  const data=readVillage('p_felicia','p_taylor')
  expect(data.people.find(p=>p.id==='p_skye')).toMatchObject({households:[],canApprove:false})
  expect(data.people.find(p=>p.id==='p_marcusv')).toMatchObject({relationship:'stepfather',canApprove:false})
  expect(JSON.stringify(data)).not.toMatch(/Imani|h_f3/)
 })
 it('coequal Lee mothers approve and Ferris support roles confer no approval',()=>{
  expect(readVillage('p_simone','p_avery').people.filter(p=>p.canApprove).map(p=>p.id)).toEqual(['p_simone','p_denise'])
  expect(readVillage('p_dwayne','p_malik').people.filter(p=>p.canApprove).map(p=>p.id)).toEqual(['p_dwayne'])
  expect(villageChildren('p_gma').map(p=>p.id)).toEqual(['p_nora','p_avery'])
 })
})

it('does not answer with Nora care information in Priya’s Malik village context',async()=>{
 const session=await createMockAuthAdapter().signInAsPersona('priya')
 const reply=await createMockRosinaAdapter({...session,generation:1}).send({message:'Can this child have a peanut snack?',currentRoute:'#/village?childId=p_malik',history:[]})
 expect(reply.reply).toContain("I can't confirm that yet")
 expect(reply.reply).not.toMatch(/Nora|Peanut allergy/)
})
