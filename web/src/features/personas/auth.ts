import type { DemoResetReceipt } from './demoReset'
import type { Scope } from '@/lib/frontendData/types'
export type PersonaId = 'kendra' | 'andre' | 'loretta' | 'priya' | 'dana' | 'jax-family' | 'rosa' | 'dwayne' | 'felicia' | 'simone' | 'whitfield' | 'demo-guide'
export type Persona = { id: PersonaId; personId: string; name: string; role: string; childId: string; childName: string; villageId: string; grants: readonly string[]; parent: boolean; guardian?: boolean; initialRoute?: 'calendar' | 'village' }
// Mock identity/scope examples from src/fixtures.ts and coordination-v2 Cast; never credentials or production authorization.
export const personas: readonly Persona[] = [
  { id:'demo-guide', personId:'p_demo_guide', name:'Demo guide', role:'Demo guide: sees the whole fictional ecosystem. No real family would have this view.', childId:'p_nora', childName:'Nora Ellison', villageId:'v_nora', grants:[], parent:false, initialRoute:'village' },
  { id: 'kendra', personId: 'p_mom', name: 'Kendra', role: "Nora's mom", childId: 'p_nora', childName: 'Nora Ellison', villageId: 'v_nora', grants: [], parent: true },
  { id: 'andre', personId: 'p_dad', name: 'Andre', role: "Nora's dad", childId: 'p_nora', childName: 'Nora Ellison', villageId: 'v_nora', grants: [], parent: true },
  { id: 'loretta', personId: 'p_gma', name: 'Loretta', role: "Nora's grandma · pickup, schedule and goals", childId: 'p_nora', childName: 'Nora Ellison', villageId: 'v_nora', grants: ['pickup.request', 'schedule.read', 'goals.read'], parent: false },
  { id: 'priya', personId: 'p_priya', name: 'Priya', role: "Nora's sitter · schedule and care information", childId: 'p_nora', childName: 'Nora Ellison', villageId: 'v_nora', grants: ['supervise.request', 'schedule.read', 'careplan.read'], parent: false },
  { id: 'dana', personId: 'p_dana', name: 'Dana', role: "New to Nora's village · Jax's mom", childId: 'p_jax', childName: 'Jax Coleman', villageId: 'v_jax', grants: [], parent: true },
  { id: 'jax-family', personId: 'p_ray', name: "Jax's family", role: "Ray · Jax's dad", childId: 'p_jax', childName: 'Jax Coleman', villageId: 'v_jax', grants: [], parent: true },
  { id: 'rosa', personId: 'p_rosa', name: 'Rosa Castellano', role: "Emma's grandmother and guardian", childId: 'p_emma', childName: 'Emma', villageId: 'v_emma', grants: [], parent: false, guardian: true, initialRoute: 'calendar' },
  { id: 'felicia', personId: 'p_felicia', name: 'Felicia Reyes', role: "Taylor's mom", childId: 'p_taylor', childName: 'Taylor', villageId: 'v_taylor', grants: [], parent: true, initialRoute: 'village' },
  { id: 'simone', personId: 'p_simone', name: 'Simone Lee', role: "Micah and Avery’s mom", childId: 'p_micah', childName: 'Micah', villageId: 'v_micah', grants: [], parent: true, initialRoute: 'village' },
  { id: 'dwayne', personId: 'p_dwayne', name: 'Dwayne Ferris', role: "Malik's dad", childId: 'p_malik', childName: 'Malik', villageId: 'v_malik', grants: [], parent: true, initialRoute: 'calendar' },
  { id: 'whitfield', personId: 'p_whitfield', name: 'Ms. Whitfield', role: "Nora's 3rd-grade teacher · school-day reports only", childId: 'p_nora', childName: 'Nora Ellison', villageId: 'v_nora', grants: ['school.read', 'school.report'], parent: false },
]
// Presentation groups are explicit so future households can be added without changing the grid.
// A village group includes relatives and caregivers, not a claim that they share one address.
export const personaGroups = [
  { id: 'nora-village', label: "Nora's village", personaIds: ['kendra', 'andre', 'loretta', 'priya'] },
  { id: 'jax-family', label: "Jax's family", personaIds: ['dana', 'jax-family'] },
  { id: 'castellano-family', label: "Emma's family", personaIds: ['rosa'] },
  { id: 'vance-reyes-family', label: "Taylor's family", personaIds: ['felicia'] },
  { id: 'lee-family', label: "Micah & Avery's family", personaIds: ['simone'] },
  { id: 'ferris-family', label: "Malik's family", personaIds: ['dwayne'] },
  { id: 'nora-school', label: "Nora's school", personaIds: ['whitfield'] },
] as const
export type DemoFamilyInput = { parentName: string; childName: string }
export type DemoFamily = DemoFamilyInput & { id: string; childId: string }
export type AuthSession = { persona: Persona; scope: Scope; generation: number; accessToken?: string; expiresAt?: number; marks?: {demo:boolean;demoGuide:boolean} }
// Reset is limited to seeded parents and guardians. The guide is read-only everywhere.
export function canResetDemo(persona:Persona|undefined){
 const seeded=persona&&personas.find(candidate=>candidate.id===persona.id&&candidate.personId===persona.personId)
 return !!seeded&&(seeded.parent||seeded.guardian===true)
}
export interface AuthAdapter {
  readonly mode: 'mock' | 'live'
  signInAsPersona(personaId: PersonaId, signal?: AbortSignal): Promise<Omit<AuthSession, 'generation'>>
  unavailablePersonas?(signal:AbortSignal):Promise<PersonaId[]>
  resetDemo(accessToken?:string,signal?:AbortSignal,personaId?:PersonaId): Promise<DemoResetReceipt|void>
  createDemoFamily(input: DemoFamilyInput): Promise<DemoFamily>
}
export function createMockAuthAdapter(): AuthAdapter {
  let nextFamily = 0
  return {
    mode: 'mock',
    async signInAsPersona(id) {
      const persona = personas.find(person => person.id === id)
      if (!persona) throw new Error('Unknown demo person')
      return { persona, scope: { childId: persona.childId, childName: persona.childName, parentName: persona.name, villageId: persona.villageId } }
    },
    async resetDemo() { nextFamily = 0 },
    async createDemoFamily(input) {
      const parentName = input.parentName.trim(), childName = input.childName.trim()
      if (!parentName || !childName || parentName.length > 80 || childName.length > 80) throw new Error('Enter a parent and child name, each under 81 characters.')
      const id = `mock-family-${++nextFamily}`
      return { id, childId: `${id}-child`, parentName, childName }
    },
  }
}
