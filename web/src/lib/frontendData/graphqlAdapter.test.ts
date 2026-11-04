/// <reference types="node" />
import { ApolloLink, Observable } from '@apollo/client'
import { GraphQLError, buildSchema, validate } from 'graphql'
import { readFileSync } from 'node:fs'
const coordinationSDL = readFileSync('../schema/coordination.graphql', 'utf8')
const villageSDL = readFileSync('../schema/village.graphql', 'utf8')
import { describe, expect, it } from 'vitest'
import { ATTEMPTS, JOBS, VILLAGE, createGraphClient, createGraphqlAdapter, deriveMissionControl } from './graphqlAdapter'
import type { JobRead } from './graphqlAdapter'
import { demoScope } from './mockAdapter'
const job: JobRead = { id: 'job', status: 'discovering', version: 2, candidateEvaluations: [{ candidate: { id: 'person', displayName: 'Recorded person' }, reasonCode: null, available: true, acceptedVia: 'WEBHOOK_CALLBACK', costCalculatedAt: null, distanceMiles: null, estimatedRideCostUsd: null, costBasis: null }], confirmation: null }
describe('read-only graphql adapter', () => {
  it('derives no timed event from an untimed status or acceptance and keeps channel unknown', () => {
    const data = deriveMissionControl([job], new Map())
    expect(data.events).toEqual([])
    expect(data.currentFacts?.join(' ')).toContain('Available to help. A response was recorded.')
    expect(data.candidates[0]).toMatchObject({ channel: '—', reasonCode: null })
    expect(data.provenance).toBe('derived')
  })
  it('orders only timestamped facts and does not timestamp an acceptance at cost calculation', () => {
    const costJob = structuredClone(job)
    costJob.candidateEvaluations[0].costCalculatedAt = '2026-10-28T15:00:00Z'
    const data = deriveMissionControl([costJob], new Map([['job', [{ id: 'a', channel: 'CALL', at: '2026-10-28T14:00:00Z' }]]]))
    expect(data.events.map(e => e.kind)).toEqual(['attempt', 'cost_calculated'])
    expect(data.events[1].summary).toBe('Travel cost calculated for Recorded person')
    expect(data.events.some(e => /accepted|available/i.test(e.summary))).toBe(false)
  })
  it('uses the user bearer token, composes attempts by job id, and has no write or parent chat method', async () => {
    const operations: string[] = []
    const link = new ApolloLink(operation => new Observable(observer => {
      operations.push(operation.operationName ?? '')
      expect(operation.getContext().headers.authorization).toBe('Bearer fictional-test-session')
      expect(operation.getContext().headers).not.toHaveProperty('x-demo-user')
      observer.next({ data: operation.operationName === 'WebCoordinationJobs' ? { coordinationJobs: [job] } : { attempts: [] } }); observer.complete()
    }))
    const client = createGraphClient(async () => 'fictional-test-session', link)
    const adapter = createGraphqlAdapter(client)
    expect((await adapter.readMissionControl(demoScope)).candidates[0].channel).toBe('—')
    expect(operations).toEqual(['WebCoordinationJobs', 'WebAttempts'])
    expect(adapter.readParentChat).toBeUndefined()
    expect(typeof adapter.approvePickup).toBe('function');expect(typeof adapter.requestPickup).toBe('function') // parent-gated by the graph itself (Bryan 2026-11-03 one-tap approve)
  })
  it('refuses a missing session before making a graph request', async () => {
    const adapter = createGraphqlAdapter(createGraphClient(async () => null, new ApolloLink(() => { throw new Error('Must not request') })))
    await expect(adapter.readMissionControl(demoScope)).rejects.toThrow('UNAUTHENTICATED')
  })
  it('preserves UNAUTHORIZED even when the graph message contains no code', async () => {
    const client = createGraphClient(async () => 'fictional-test-session', new ApolloLink(() => new Observable(observer => {
      observer.next({ errors: [new GraphQLError('Denied', { extensions: { code: 'UNAUTHORIZED' } })] }); observer.complete()
    })))
    await expect(createGraphqlAdapter(client).readMissionControl(demoScope)).rejects.toThrow('UNAUTHORIZED')
  })
  it('validates every operation against the existing schema rather than inventing fields', () => {
    // Each source is an independently generated subgraph SDL. Validate the selected fields
    // against its owner, adding only the federated Person fields used by the UI.
    const coordination = coordinationSDL.replace('type Person @key(fields: "id") {\n  id: ID!\n}', 'type Person @key(fields: "id") {\n  id: ID!\n displayName: String!\n}')
    const village = villageSDL
    for (const doc of [JOBS, ATTEMPTS]) expect(validate(buildSchema(coordination), doc)).toEqual([])
    expect(validate(buildSchema(village), VILLAGE)).toEqual([])
  })
})
it('rejects a late response before it can enter the Apollo cache after a perspective switch',async()=>{
 let generation=1,deliver=()=>{}
 const client=createGraphClient(async()=> 'test-only-bearer',new ApolloLink(()=>new Observable(observer=>{deliver=()=>{observer.next({data:{coordinationJobs:[]}});observer.complete()}})),()=>generation)
 const pending=client.query({query:JOBS,variables:{childId:'p_nora'}})
 await new Promise(resolve=>setTimeout(resolve,0));generation++;deliver()
 await expect(pending).rejects.toThrow('SESSION_CHANGED');expect(client.cache.extract()).toEqual({});client.stop()
})
it('does not forward a bearer lookup that resolves after leaving the perspective',async()=>{
 let generation=1,resolve!:(value:string|null)=>void,forwarded=false
 const client=createGraphClient(()=>new Promise(r=>{resolve=r}),new ApolloLink(()=>new Observable(observer=>{forwarded=true;observer.complete()})),()=>generation)
 const pending=client.query({query:JOBS,variables:{childId:'p_nora'}})
 generation++;resolve('test-only-bearer')
 await expect(pending).rejects.toThrow('SESSION_CHANGED');expect(forwarded).toBe(false);client.stop()
})
