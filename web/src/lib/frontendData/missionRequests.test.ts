import { ApolloLink, Observable } from '@apollo/client'
import { expect, it } from 'vitest'
import { createGraphClient } from './graphqlAdapter'
import { createDeliveredAdapter } from './deliveredAdapter'
import type { StoredMissionControl } from './deliveredAdapter'

it('loads sixty stored jobs in at most four requests without dropping their history', async () => {
  let requests = 0
  const jobs = Array.from({ length: 60 }, (_, i) => ({ id: `job-${i}`, type: 'PICKUP', status: 'pending', version: 1, idempotencyKey: `key-${i}`, overLimitCandidate: null, candidateEvaluations: [], confirmation: null }))
  const client = createGraphClient(async () => 'test-bearer', new ApolloLink(operation => new Observable(observer => {
    requests++
    const data: Record<string, unknown> = {}
    if (operation.operationName === 'WebCoordinationJobs') data.coordinationJobs = jobs
    else {
      const definition = operation.query.definitions.find(d => d.kind === 'OperationDefinition')!
      if (definition.kind === 'OperationDefinition') for (const field of definition.selectionSet.selections) {
        if (field.kind !== 'Field') continue
        data[field.alias?.value ?? field.name.value] = field.name.value === 'attempts' ? [] : [{ at: '2026-11-03T12:00:00Z', kind: 'JOB_CREATED', attemptId: null, candidate: null, detail: null }]
      }
    }
    observer.next({ data }); observer.complete()
  })))
  try {
    const result = await createDeliveredAdapter(client, read => read()).readMissionControl({ childId: 'nora', childName: 'Nora', parentName: 'Kendra', villageId: 'village' }) as StoredMissionControl
    expect(result.recordedRuns).toHaveLength(60)
    expect(result.recordedRuns.every(run => run.timeline.length === 1)).toBe(true)
    expect(requests).toBeLessThanOrEqual(4)
  } finally { client.stop() }
})
