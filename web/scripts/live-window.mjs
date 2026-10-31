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
// The generic guard intentionally blocks every reserved window. Orbit may use ONLY its own
// explicitly OPEN, named-runtime reservation, after the operator confirms the recorded deadline.
export function orbitWindowOpen(text,{runtime,until,now=Date.now()}){
 if(!/^[a-f0-9]{7,40}$/.test(runtime??''))return false
 const end=Date.parse(until??'');if(!Number.isFinite(end)||end<=now||end-now>45*60*1000)return false
 const section=text.slice(text.lastIndexOf('## Stack reservations'))
 const row=section.split('\n').filter(line=>line.startsWith('| ')).at(-1)
 if(!row)return false
 const cells=row.split('|').slice(1,-1).map(cell=>cell.replace(/\*/g,'').trim())
 return cells.length>=5&&/W-ORBIT window (?:OPEN|REOPENED)\b/.test(cells[1])&&cells[2].includes('`'+runtime+'`')&&/^(?:OPEN|REOPENED) to W-ORBIT until /.test(cells.at(-1))
}

// Reset mutates the shared sandbox: only the owner's restored and explicitly opened window.
export function resetWindowOpen(text,{runtime,until,now=Date.now()}){
 if(!/^[a-f0-9]{7,40}$/.test(runtime??''))return false
 const end=Date.parse(until??'');if(!Number.isFinite(end)||end<=now||end-now>45*60*1000)return false
 const section=text.slice(text.lastIndexOf('## Stack reservations'))
 const row=section.split('\n').filter(line=>line.startsWith('| ')).at(-1)
 if(!row)return false
 const cells=row.split('|').slice(1,-1).map(cell=>cell.replace(/\*/g,'').trim())
 return cells.length>=5&&/W-RESET (?:window )?(?:OPEN|REOPENED)\b/.test(cells[1])&&cells[2].includes('`'+runtime+'`')&&/^(?:OPEN|REOPENED) to W-RESET until /.test(cells.at(-1))
}

// Signature capture uses only Bentley's explicitly restored W-UI window.
export function signatureWindowOpen(text,{runtime,until,now=Date.now()}){
 if(!/^[a-f0-9]{7,40}$/.test(runtime??''))return false
 const end=Date.parse(until??'');if(!Number.isFinite(end)||end<=now||end-now>45*60*1000)return false
 const section=text.slice(text.lastIndexOf('## Stack reservations'))
 const row=section.split('\n').filter(line=>line.startsWith('| ')).at(-1)
 if(!row)return false
 const cells=row.split('|').slice(1,-1).map(cell=>cell.replace(/\*/g,'').trim())
 return cells.length>=5&&/restored|restoration verified/i.test(cells[1])&&!/NOT listening|BLOCKED|awaiting.*(?:restart|restoration)/i.test(cells[1])&&/W-UI (?:window )?(?:OPEN|REOPENED)\b/.test(cells[1])&&cells[2].includes('`'+runtime+'`')&&/^(?:OPEN|REOPENED) (?:to|—) W-UI until /.test(cells.at(-1))&&cells.at(-1).includes(until)
}
