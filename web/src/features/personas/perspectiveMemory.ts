import {personas} from './auth'
import type {PersonaId} from './auth'
/**
 * Per-tab memory of the chosen perspective so a reload can re-run the server-side
 * persona pick (#28: no access or refresh token ever reaches browser storage — the
 * value is the persona id and nothing else). sessionStorage keeps tabs isolated:
 * two tabs exploring different personas never see each other's choice.
 */
const KEY='fg:perspective'
export function rememberPerspective(id:PersonaId){try{sessionStorage.setItem(KEY,id)}catch{/* Private mode: the session simply won't survive a reload. */}}
export function clearRememberedPerspective(){try{sessionStorage.removeItem(KEY)}catch{/* Nothing stored. */}}
export function rememberedPerspective():PersonaId|null{
 try{
  const id=sessionStorage.getItem(KEY)
  return personas.some(p=>p.id===id)?id as PersonaId:null
 }catch{return null}
}
