// Browser verification fixture. No live session, requests, writes or fallback in the production app.
import { createRoot } from 'react-dom/client'
import { ApolloLink, Observable } from '@apollo/client'
import { GraphQLError } from 'graphql'
import { DataProvider } from '../../src/lib/frontendData/provider'
import { createGraphClient, createGraphqlAdapter } from '../../src/lib/frontendData/graphqlAdapter'
import { demoScope } from '../../src/lib/frontendData/mockAdapter'
import { MissionControl } from '../../src/features/mission-control/MissionControl'
import { Shell } from '../../src/app/Shell'
import '../../src/index.css'
const denied = new URLSearchParams(location.search).has('denied')
const client = createGraphClient(async () => 'fictional-browser-fixture', new ApolloLink(operation => new Observable(observer => {
  observer.next(denied ? { errors: [new GraphQLError('Denied', { extensions: { code: 'UNAUTHORIZED' } })] } : { data: operation.operationName === 'WebCoordinationJobs' ? { coordinationJobs: [{ id: 'fixture-job', status: 'awaiting_approval', version: 3, idempotencyKey: 'pickup:p_nora:2026-10-28:afternoon', overLimitCandidate: null, confirmation: null, candidateEvaluations: [{ candidate: { id: 'p_tasha', displayName: 'Tasha Ellison' }, reasonCode: 'APPROVAL_PENDING', available: true, acceptedVia: 'WEBHOOK_CALLBACK', costCalculatedAt: null, distanceMiles: 4.5, estimatedRideCostUsd: null, costBasis: null }] }] } : { attempts: [{ id: 'fixture-attempt', channel: 'SMS', at: '2026-10-28T14:58:16Z' }] } }); observer.complete()
})))
createRoot(document.getElementById('root')!).render(<DataProvider adapter={createGraphqlAdapter(client)} scope={demoScope}><Shell slots={{ 'mission-control': <MissionControl /> }} /></DataProvider>)
