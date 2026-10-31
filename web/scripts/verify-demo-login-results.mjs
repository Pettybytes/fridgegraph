// Local receipt audit. Evidence 37/40/41: directory reads are public to authenticated callers;
// private operation gates and authorized-empty results retain their individual contracts.
import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const file=new URL('../evidence/demo-login/current/results.json',import.meta.url)
const receipt=JSON.parse(await readFile(file,'utf8'))
export function verify(proof){
 assert.equal(proof.contexts,'pass')
 const parents=new Set(['kendra','andre','dana','jax-family'])
 assert.equal(proof.rows.length,7)
 for(const row of proof.rows){
  assert.equal(row.picker,'READY',row.persona+' picker')
  const l=row.liveReads.legacy,guide=row.persona==='demo-guide',parent=parents.has(row.persona)
  const expected={own:true,foreign:true,household:parent,pickup:parent||guide,schedule:true,care:parent||guide||row.persona==='priya',goals:parent||row.persona==='loretta',foreignHousehold:false,foreignPickup:false,foreignSchedule:false,foreignCare:false,foreignGoals:false}
  for(const [name,allowed] of Object.entries(expected))assert.equal(allowed?l[name].ok:l[name].refused,true,row.persona+' '+name)
  assert.equal(l.jobs.ok,true,row.persona+' jobs read')
  const jobs=l.jobs.data.coordinationJobs
  assert.equal(jobs.length,parent&&['kendra','andre'].includes(row.persona)||guide?1:0,row.persona+' scoped jobs')
  if(row.persona==='loretta')assert(l.goals.data.goals.every(goal=>goal.status==='APPROVED'))
  const c=row.liveReads.calendar
  for(const read of [c.own,c.conflicts,c.adults,c.defaults,c.cancelled,...c.daily])assert.equal(read.outcome,'ready',row.persona+' own calendar read')
  for(const boundary of c.boundaries)for(const read of Object.values(boundary))assert.equal(read.outcome,'refused',row.persona+' private calendar')
  for(const read of c.unavailableAdults){assert.equal(read.outcome,'ready');assert.deepEqual(read.data.adultAvailability,[])}
 }
}
// Prove the audit rejects a forged successful private read, without changing the real receipt.
const bad=structuredClone(receipt.proof);bad.rows[0].liveReads.legacy.foreignCare={ok:true,data:{carePlan:{}}}
assert.throws(()=>verify(bad))
verify(receipt.proof)
assert.equal(receipt.scan.pass,true)
console.log('PASS: seven persona operation contracts, cross-context isolation and token-leak receipt; forbidden-read negative control rejected')
