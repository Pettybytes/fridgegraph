import {ApolloLink,Observable} from '@apollo/client'
import {expect,it} from 'vitest'
import {createGraphClient} from './graphqlAdapter'
import {createDeliveredAdapter} from './deliveredAdapter'
import type {StoredMissionControl} from './deliveredAdapter'
const scope={childId:'p_nora',childName:'Nora',parentName:'Kendra',villageId:'v_nora'}
it('joins only persisted attempts and timeline records, keeping missing candidate and timestamps explicit',async()=>{
 const operations:string[]=[]
 const client=createGraphClient(async()=> 'test-only-bearer',new ApolloLink(op=>new Observable(observer=>{
  operations.push(op.operationName??'')
  const data=op.operationName==='WebCoordinationJobs'?{coordinationJobs:[{id:'stored-job',status:'AWAITING_APPROVAL',version:1,idempotencyKey:'stored-key',overLimitCandidate:null,candidateEvaluations:[],confirmation:null}]}:op.operationName==='WebStoredRecords'?{a0:[{id:'attempt',channel:'CALL',at:'2026-10-30T20:00:00Z',candidate:null,destinationMode:'TEST_RESPONDER',closedAt:null,closedReason:null}],t0:[{at:'2026-10-30T20:00:00Z',kind:'ATTEMPT_OPENED',attemptId:'attempt',candidate:null,detail:'CALL'},{at:'2026-10-30T19:59:00Z',kind:'JOB_CREATED',attemptId:null,candidate:null,detail:null}]}:{}
  observer.next({data});observer.complete()
 })))
 const adapter=createDeliveredAdapter(client,read=>read()),data=await adapter.readMissionControl(scope) as StoredMissionControl
 expect(operations).toEqual(['WebCoordinationJobs','WebStoredRecords']);expect(data.provenance).toBe('live')
 expect(data.recordedRuns[0].attempts[0].candidate).toBeNull();expect(data.recordedRuns[0].timeline.map(e=>e.kind)).toEqual(['JOB_CREATED','ATTEMPT_OPENED']);expect(data.events).toEqual([]);expect(data.candidates).toEqual([])
 await adapter.clearStore?.()
})
it('does not invent a run or issue attempt/timeline reads when no stored job exists',async()=>{
 const operations:string[]=[]
 const client=createGraphClient(async()=> 'test-only-bearer',new ApolloLink(op=>new Observable(observer=>{operations.push(op.operationName??'');observer.next({data:{coordinationJobs:[]}});observer.complete()})))
 const data=await createDeliveredAdapter(client,read=>read()).readMissionControl(scope) as StoredMissionControl
 expect(data.recordedRuns).toEqual([]);expect(operations).toEqual(['WebCoordinationJobs']);client.stop()
})
