import { gql, type ApolloClient } from '@apollo/client'

export type AddVillagerProposal = {
  id: string; version: number; childId: string; personId: string; personDisplayName: string | null
  relationshipType: string; scopes: string[]; validFrom: string | null; validUntil: string | null
  createdAt: string; expiresAt: string
}
export type AddVillagerResult = {
  relationship: { id: string; from: { id: string }; to: { id: string }; type: string; status: string }
  grant: { id: string; actor: { id: string }; child: { id: string }; scopes: string[]; validFrom: string | null; validUntil: string | null; grantedBy: { id: string } }
}
export type ConfirmAddVillager = (proposal: AddVillagerProposal, signal?: AbortSignal) => Promise<AddVillagerResult>

export const CONFIRM_ADD_VILLAGER = gql`mutation WebConfirmAddVillager($proposalId: ID!, $version: Int!) {
  confirmAddVillager(proposalId: $proposalId, version: $version) {
    relationship { id from { id } to { id } type status }
    grant { id actor { id } child { id } scopes validFrom validUntil grantedBy { id } }
  }
}`

export function parseAddVillagerProposal(value: unknown): AddVillagerProposal | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || !row.id || !Number.isSafeInteger(row.version) || (row.version as number) < 1 ||
      typeof row.childId !== 'string' || !row.childId || typeof row.personId !== 'string' || !row.personId ||
      typeof row.relationshipType !== 'string' || !row.relationshipType || /^(parent|guardian)$/i.test(row.relationshipType) || !Array.isArray(row.scopes) ||
      row.scopes.length === 0 || !row.scopes.every(scope => scope === 'pickup.request' || scope === 'schedule.read') ||
      new Set(row.scopes).size !== row.scopes.length ||
      (row.personDisplayName !== null && typeof row.personDisplayName !== 'string') ||
      (row.validFrom !== null && typeof row.validFrom !== 'string') ||
      (row.validUntil !== null && typeof row.validUntil !== 'string') ||
      typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) ||
      typeof row.expiresAt !== 'string' || !Number.isFinite(Date.parse(row.expiresAt))) return null
  return row as AddVillagerProposal
}

export function addVillagerError(error: unknown): 'expired' | 'stale' | 'refused' | 'sign-in' | 'uncertain' {
  const codes = (error as { errors?: Array<{ extensions?: { code?: unknown }; message?: unknown }> })?.errors ??
    (error as { graphQLErrors?: Array<{ extensions?: { code?: unknown }; message?: unknown }> })?.graphQLErrors ?? []
  const values = codes.flatMap(item => [item.extensions?.code, item.message]).filter((item): item is string => typeof item === 'string')
  if (values.some(value => value.includes('PROPOSAL_EXPIRED'))) return 'expired'
  if (values.some(value => value.includes('PROPOSAL_STALE'))) return 'stale'
  if (values.some(value => value.includes('UNAUTHENTICATED'))) return 'sign-in'
  if (values.some(value => /UNAUTHORIZED|DEMO_GUIDE_READ_ONLY|PROPOSAL_NOT_FOUND|NOT_FOUND|VILLAGER_PROPOSAL_INVALID/.test(value))) return 'refused'
  return 'uncertain'
}

export function createLiveAddVillagerConfirm(client: ApolloClient): ConfirmAddVillager {
  return async (proposal, signal) => {
    const response = await client.mutate<{ confirmAddVillager: AddVillagerResult }>({
      mutation: CONFIRM_ADD_VILLAGER,
      variables: { proposalId: proposal.id, version: proposal.version },
      context: { fetchOptions: { signal } },
      fetchPolicy: 'no-cache',
    })
    const result = response.data?.confirmAddVillager
    if (!result || !result.relationship?.id || !result.grant?.id ||
        result.relationship.from?.id !== proposal.personId || result.relationship.to?.id !== proposal.childId ||
        result.grant.actor?.id !== proposal.personId || result.grant.child?.id !== proposal.childId ||
        result.relationship.type !== proposal.relationshipType || result.relationship.status !== 'ACTIVE' ||
        result.grant.scopes.length !== proposal.scopes.length ||
        !proposal.scopes.every(scope => result.grant.scopes.includes(scope)) ||
        result.grant.validFrom !== proposal.validFrom || result.grant.validUntil !== proposal.validUntil) {
      throw new Error('Invalid add-villager confirmation response')
    }
    return result
  }
}

// Presentation-only fixture. No graph call and no relationship or grant is written.
export function createMockAddVillagerConfirm(): ConfirmAddVillager {
  const results = new Map<string, AddVillagerResult>()
  return async proposal => {
    const key = `${proposal.id}:${proposal.version}`
    const existing = results.get(key)
    if (existing) return existing
    const result: AddVillagerResult = {
      relationship: { id: `sample-relationship-${proposal.id}`, from: { id: proposal.personId }, to: { id: proposal.childId }, type: proposal.relationshipType, status: 'SAMPLE_ONLY' },
      grant: { id: `sample-grant-${proposal.id}`, actor: { id: proposal.personId }, child: { id: proposal.childId }, scopes: [...proposal.scopes], validFrom: proposal.validFrom, validUntil: proposal.validUntil, grantedBy: { id: 'sample-parent' } },
    }
    results.set(key, result)
    return result
  }
}
