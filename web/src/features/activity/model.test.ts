import {describe,it,expect} from 'vitest'
import {activityEntries,localMoment,mayReadFamilyActivity,orbitStatusCopy} from './model'
import type {StoredMissionControl} from '@/lib/frontendData/deliveredAdapter'
const at='2026-11-01T15:00:00Z'
const data={candidates:[],events:[],recordedRuns:[{job:{id:'job',status:'CONFIRMED',version:1,candidateEvaluations:[],confirmation:null},attempts:[{id:'attempt',channel:'TEXT',at,candidate:{id:'caregiver',displayName:'Tasha'},destinationMode:'TEST_RESPONDER',closedAt:at,closedReason:'TIMEOUT'}],timeline:[{at,kind:'JOB_CREATED',attemptId:null,candidate:null,detail:null},{at,kind:'ATTEMPT_OPENED',attemptId:'attempt',candidate:{id:'caregiver',displayName:'Tasha'},detail:'TEXT'},{at,kind:'ATTEMPT_CLOSED',attemptId:'attempt',candidate:{id:'caregiver',displayName:'Tasha'},detail:'TIMEOUT'},{at,kind:'CONFIRMATION',attemptId:null,candidate:{id:'caregiver',displayName:'Tasha'},detail:null}]}]} as StoredMissionControl
describe('activity certainty',()=>{
 it('refuses Priya and limits closed Orbit copy to outcome and thank-you',()=>{
  expect(mayReadFamilyActivity(false,false)).toBe(false)
  expect(orbitStatusCopy({status:'CLOSED',closeOutcome:'FOUND_SAFE',thankyou:'Thank you for helping.'})).toBe('Found safe. Thank you for helping.')
 })
 it('distinguishes proposals, simulated outreach, reports, recorded confirmations and consent decisions',()=>{
  const entries=activityEntries(data,[{id:'slip',title:'Trip',history:[{decision:'APPROVED',at,approver:{id:'mom'}},{decision:'DECLINED',at,approver:{id:'mom'}}]}],{mom:'Kendra'})
  expect(entries.map(e=>e.kind).sort()).toEqual(['APPROVED','CONFIRMED','DECLINED','PROPOSED','RECORDED','SIMULATED'])
  expect(entries.find(e=>e.kind==='SIMULATED')?.what).toMatch(/simulated.*Notified does not mean delivered/)
  expect(entries.find(e=>e.kind==='RECORDED')?.what).toContain('No reply in time')
  expect(entries.find(e=>e.kind==='CONFIRMED')?.what).toContain('confirmation was recorded')
 })
 it('renders source-prefixed school reports as plain dated reports, never confirmations',()=>{
  const reports=activityEntries(data,[],{},[{id:'job:0',kind:'health',text:'Nora said <script>alert(1)</script>',at:'2026-11-01'},{id:'later',kind:'health',text:'Teacher noted rest',at:'2026-11-01',reportedAt:'2026-11-01T15:00:00Z'}])
  const school=reports.filter(e=>e.id.startsWith('school:'))
  expect(school.map(e=>e.id)).toEqual(['school:later','school:job:0'])
  expect(school.every(e=>e.kind==='REPORTED'&&e.who==='School report'&&!e.href)).toBe(true)
  expect(school[1].what).toBe('Nora said <script>alert(1)</script>')
  expect(school[1].at).toBe('2026-11-01')
  expect(localMoment(school[1].at)).toBe('Time not recorded')
  expect(localMoment(school[0].at)).toMatch(/AM|PM/)
 })
 it('marks an unverified real contact attempt RECORDED, not REPORTED',()=>{
  const changed=structuredClone(data);changed.recordedRuns[0].attempts[0].destinationMode='REAL_CONSENTED'
  const opened=activityEntries(changed,[]).find(e=>e.id==='job:job:1')
  expect(opened?.kind).toBe('RECORDED')
  expect(opened?.what).toContain('Delivery is not verified')
 })
 it('never promotes a caregiver report to confirmation',()=>{
  const changed=structuredClone(data);changed.recordedRuns[0].timeline=changed.recordedRuns[0].timeline.filter(e=>e.kind!=='CONFIRMATION');changed.recordedRuns[0].timeline.push({at,kind:'WITH_ME',attemptId:null,candidate:null,detail:null})
  expect(activityEntries(changed,[]).some(e=>e.kind==='CONFIRMED')).toBe(false)
 })
})
