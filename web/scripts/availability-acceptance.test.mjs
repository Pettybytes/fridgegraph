import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {availabilityConsistent} from './availability-acceptance.mjs'
const unknown=[{person:{displayName:'Evelyn Carter'},availability:'UNKNOWN'}]
test('accepts the original failed receipt as absent records, not a promise',async()=>{
 const receipt=JSON.parse(await readFile(new URL('../evidence/demo-login/current/main38-matcher-failure.json',import.meta.url),'utf8'))
 assert.equal(receipt.proof.passed,false) // Preserve the historical failure; never relabel it.
 const {reply,actualCandidates}=receipt.proof.active
 assert.equal(availabilityConsistent(reply,actualCandidates),true)
})
test('accepts equivalent uncertainty and explicit limits on FREE',()=>{
 for(const reply of ['Availability is unknown.','Availability is not recorded.','I cannot confirm availability.','No availability recorded does not mean nobody is available.','No availability recorded. FREE does not mean confirmed willingness to help.','No availability recorded. FREE is recorded free time, not willingness to help.'])assert.equal(availabilityConsistent(reply,unknown),true,reply)
})
test('absent records cannot establish that nobody is available',()=>{
 for(const reply of ['Availability is unknown. Nobody is available.','No availability recorded, so no one is available.','No availability recorded. None of the caregivers are available.'])assert.equal(availabilityConsistent(reply,unknown),false,reply)
})
test('absent records without a candidate row still cannot mean nobody is available',()=>{
 assert.equal(availabilityConsistent('No availability recorded. Nobody is available.',[]),false)
})
test('UNKNOWN cannot become a positive availability claim',()=>{
 assert.equal(availabilityConsistent('Availability is unknown. Evelyn Carter is available.',unknown),false)
 assert.equal(availabilityConsistent('No availability recorded. Evelyn is confirmed available.',unknown),false)
})
test('FREE cannot establish willingness even alongside a correct disclaimer',()=>{
 for(const reply of ['No availability recorded. A FREE slot means confirmed willingness to help.','Availability is unknown. FREE means she will help.','She is willing to help because she is marked FREE.'])assert.equal(availabilityConsistent(reply,unknown),false,reply)
 for(const reply of ['A FREE slot confirms willingness to help.',"Her calendar says FREE, so she's willing to help.",'FREE time is recorded; therefore she will help.','FREE means she can help.','A FREE slot means she is available to help.'])assert.equal(availabilityConsistent(reply,[]),false,reply)
})
test('recorded availability is distinct from willingness',()=>{
 assert.equal(availabilityConsistent('Evelyn Carter is available.',[{person:{displayName:'Evelyn Carter'},availability:'AVAILABLE'}]),true)
 assert.equal(availabilityConsistent('FREE is recorded free time; willingness is not confirmed.',[]),true)
})
