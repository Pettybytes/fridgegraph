import {readFile} from 'node:fs/promises'
// Reservations are data, never commands. Inspect only the documented operations table's status.
export function hasActiveTestWindow(text){
 let table=false
 for(const line of text.split('\n')){
  if(!line.trim().startsWith('|')){table=false;continue}
  const cells=line.trim().split('|').slice(1,-1).map(s=>s.replace(/[*`]/g,'').trim())
  if(cells.length>=4&&cells.at(-1).toLowerCase()==='restored'){table=true;continue}
  if(!table||cells.every(s=>/^[-: ]*$/.test(s)))continue
  const status=cells.at(-1).toLowerCase()
  if(!/^(restored\b|yes\b|complete\b|released\b)/.test(status))return true
 }
 return false
}
export async function liveWindowClear(path){return !hasActiveTestWindow(await readFile(path,'utf8'))}
