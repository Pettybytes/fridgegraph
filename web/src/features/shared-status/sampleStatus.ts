import type {SharedStatus} from './DadStatusChip'

/** Fictional demo sample from the approved Dad status seed. It is never a live read. */
export function sampleDadStatus(personId:string, now=Date.now()):SharedStatus|null {
  if(personId!=='p_dad')return null
  return {personId,emoji:'🍼',text:'Changing a diaper',etaText:'unknown',setAt:new Date(now).toISOString(),expiresAt:new Date(now+24*60*60*1000).toISOString()}
}
