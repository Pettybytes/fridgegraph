import { ApolloClient, ApolloLink, HttpLink, InMemoryCache, Observable, gql } from '@apollo/client'
import { contactChannelLabel, pickupStatusLabel } from './displayCopy'
import { reasonLabel } from './types'
import type { Confirmation, CoordinationJob, FrontendAdapter, MissionControlData, ReasonCode, Scope, VillageData } from './types'

export const JOBS = gql`query WebCoordinationJobs($childId: ID!) {
  coordinationJobs(childId: $childId) {
    id type status version idempotencyKey overLimitCandidate { id displayName }
    candidateEvaluations { candidate { id displayName } reasonCode available acceptedVia costCalculatedAt distanceMiles estimatedRideCostUsd costBasis }
    confirmation { id job { id } receivedAt candidate { id displayName } approvedBy { id displayName } overLimitApproved }
  }
}`
export const ATTEMPTS = gql`query WebAttempts($jobId: ID!) { attempts(jobId: $jobId) { id channel at } }`
export const APPROVE_PICKUP = gql`mutation WebApprovePickup($jobId: ID!, $version: Int!, $decision: ApprovalDecision!, $declineReason: String, $acceptOverLimit: Boolean) {
  approvePickup(jobId: $jobId, version: $version, decision: $decision, declineReason: $declineReason, acceptOverLimit: $acceptOverLimit) {
    id type status version idempotencyKey overLimitCandidate { id displayName }
    candidateEvaluations { candidate { id displayName } reasonCode available acceptedVia costCalculatedAt distanceMiles estimatedRideCostUsd costBasis }
    confirmation { id job { id } receivedAt candidate { id displayName } approvedBy { id displayName } overLimitApproved }
  }
}`
export const REQUEST_PICKUP = gql`mutation WebRequestPickup($childId: ID!, $asOf: String, $window: String) { requestPickup(childId: $childId, asOf: $asOf, window: $window) { id status } }`
export const VILLAGE = gql`query WebVillage($childId: ID!, $villageId: ID!) {
  village(id: $villageId) { id name }
  child(id: $childId) { person { id displayName } }
  householdMembers(childId: $childId) { person { id displayName } household { id } role }
  relationships(childId: $childId) { id from { id displayName } to { id person { id displayName } } type status }
}`
type Evaluation = { candidate: { id: string; displayName: string }; reasonCode: ReasonCode | null; available: boolean | null; acceptedVia: string | null; costCalculatedAt: string | null; distanceMiles: number | null; estimatedRideCostUsd: number | null; costBasis: string | null }
export type JobRead = CoordinationJob & { type?: 'PICKUP' | 'INVITATION' | 'ONBOARDING'; candidateEvaluations: Evaluation[]; confirmation: Confirmation | null }
type Attempt = { id: string; channel: string; at: string }
// Derived, not a historical job timeline: only the fact described by a timestamp belongs at it.
// In particular costCalculatedAt timestamps a cost calculation, never acceptance or a state change.
export function deriveMissionControl(jobs: JobRead[], attempts: Map<string, Attempt[]>): MissionControlData {
  const events: MissionControlData['events'] = []
  const currentFacts: string[] = []
  for (const job of jobs) {
    currentFacts.push(pickupStatusLabel(job.status))
    for (const evaluation of job.candidateEvaluations) {
      currentFacts.push(`${evaluation.candidate.displayName}: ${reasonLabel(evaluation.reasonCode)}. ${evaluation.available === true ? 'Available to help.' : evaluation.available === false ? 'Not available.' : 'Availability not recorded.'} ${evaluation.acceptedVia ? 'A response was recorded.' : 'No response recorded.'}`)
      if (evaluation.costCalculatedAt) events.push({ id: `${job.id}:${evaluation.candidate.id}:cost`, at: evaluation.costCalculatedAt, kind: 'cost_calculated', summary: `Travel cost calculated for ${evaluation.candidate.displayName}`, stage: 'RECORDED', job })
    }
    for (const attempt of attempts.get(job.id) ?? []) events.push({ id: attempt.id, at: attempt.at, kind: 'attempt', summary: `${contactChannelLabel(attempt.channel)} recorded. Caregiver not recorded.`, stage: 'RECORDED', job })
    if (job.confirmation) events.push({ id: job.confirmation.id, at: job.confirmation.receivedAt, kind: 'confirmation', summary: `Approval by ${job.confirmation.approvedBy.displayName} for ${job.confirmation.candidate.displayName}`, stage: 'RECORDED', job })
  }
  // The review panel is explicitly scoped to the first returned job, never a mix of candidates from jobs.
  return { provenance: 'derived', currentFacts, candidates: (jobs[0]?.candidateEvaluations ?? []).map(e => ({ id: e.candidate.id, name: e.candidate.displayName, channel: '—', reasonCode: e.reasonCode, distanceMiles: e.distanceMiles, estimatedRideCostUsd: e.estimatedRideCostUsd, costBasis: e.costBasis })), events: events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), coordinationJobs: jobs, confirmations: jobs.flatMap(job => job.confirmation ? [job.confirmation] : []) }
}
export function createGraphClient(getAccessToken: () => Promise<string | null>, link: ApolloLink = new HttpLink({ uri: '/graphql' }), getGeneration:()=>number=()=>0) {
  const auth = new ApolloLink((operation, forward) => new Observable(observer => {
    let active = true
    const generation=getGeneration()
    let subscription: { unsubscribe(): void } | undefined
    getAccessToken().then(token => {
      if (!active) return
      if(generation!==getGeneration()){observer.error(new Error('SESSION_CHANGED'));return}
      if (!token) { observer.error(new Error('UNAUTHENTICATED')); return }
      operation.setContext(({ headers = {} }) => ({ headers: { ...headers, authorization: `Bearer ${token}` } }))
      subscription = forward(operation).subscribe({next:value=>{if(active && generation===getGeneration())observer.next(value);else observer.error(new Error('SESSION_CHANGED'))},error:error=>{if(active)observer.error(generation===getGeneration()?error:new Error('SESSION_CHANGED'))},complete:()=>observer.complete()})
    }, error => { if (active) observer.error(error) })
    return () => { active = false; subscription?.unsubscribe() }
  }))
  return new ApolloClient({ cache: new InMemoryCache(), link: ApolloLink.from([auth, link]) })
}
export function createGraphqlAdapter(client: ReturnType<typeof createGraphClient>): FrontendAdapter {
  async function read<T>(query: Parameters<typeof client.query>[0]['query'], variables: Record<string, string>): Promise<T> {
    try {
      const result = await client.query<T>({ query, variables, fetchPolicy: 'network-only' })
      if (!result.data) throw new Error('No data returned')
      return result.data
    } catch (error) {
      // Apollo's error message can omit extension codes. Preserve the code for the UI boundary.
      const errors = (error as { errors?: { extensions?: { code?: string } }[] }).errors
      const code = errors?.find(e => ['UNAUTHORIZED', 'UNAUTHENTICATED', 'AUTH_ERROR'].includes(e.extensions?.code ?? ''))?.extensions?.code
      throw code ? new Error(code) : error
    }
  }
  async function write<T>(mutation: Parameters<typeof client.mutate>[0]['mutation'], variables: Record<string, unknown>): Promise<T> {
    try {
      const result = await client.mutate<T>({ mutation, variables })
      if (!result.data) throw new Error('No data returned')
      return result.data
    } catch (error) {
      const errors = (error as { errors?: { extensions?: { code?: string } }[] }).errors
      const code = errors?.find(e => ['UNAUTHORIZED', 'UNAUTHENTICATED', 'AUTH_ERROR'].includes(e.extensions?.code ?? ''))?.extensions?.code
      throw code ? new Error(code) : error
    }
  }
  return {
    mode: 'graphql',
    clearStore: () => client.clearStore(),
    // Parent-gated by the graph itself (approve_pickup / request_pickup refuse non-parents);
    // exposing them here grants nothing. The UI renders them only behind the parent's confirm.
    async approvePickup(_scope: Scope, input) {
      const data = await write<{ approvePickup: JobRead }>(APPROVE_PICKUP, { ...input })
      return data.approvePickup
    },
    async requestPickup(_scope: Scope, input) {
      const data = await write<{ requestPickup: { id: string; status: string } }>(REQUEST_PICKUP, { childId: input.childId, asOf: input.date, window: input.window })
      return data.requestPickup
    },
    async readMissionControl(scope: Scope) {
      const { coordinationJobs } = await read<{ coordinationJobs: JobRead[] }>(JOBS, { childId: scope.childId })
      const attempts = await Promise.all(coordinationJobs.map(async job => [job.id, (await read<{ attempts: Attempt[] }>(ATTEMPTS, { jobId: job.id })).attempts] as const))
      return deriveMissionControl(coordinationJobs, new Map(attempts))
    },
    async readVillage(scope: Scope) {
      type Person = { id: string; displayName: string }
      const data = await read<{ village: { id: string } | null; child: { person: Person | null } | null; householdMembers: VillageData['nodes']; relationships: { id: string; from: Person; to: { id: string; person: Person | null }; type: string; status: string }[] }>(VILLAGE, { childId: scope.childId, villageId: scope.villageId })
      const nodes = new Map(data.householdMembers.map(node => [node.person.id, node]))
      if (data.child?.person && !nodes.has(data.child.person.id)) nodes.set(data.child.person.id, { person: data.child.person, household: null, role: 'child' })
      for (const relationship of data.relationships) {
        if (!nodes.has(relationship.from.id)) nodes.set(relationship.from.id, { person: relationship.from, household: null, role: relationship.type })
        if (relationship.to.person && !nodes.has(relationship.to.id)) nodes.set(relationship.to.id, { person: relationship.to.person, household: null, role: 'child' })
      }
      return { nodes: [...nodes.values()], edges: data.relationships.filter(r => nodes.has(r.from.id) && nodes.has(r.to.id)).map(r => ({ from: { id: r.from.id }, to: { id: r.to.id }, relationship: { id: r.id, type: r.type, status: r.status } })) }
    },
  }
}
