import { gql, type ApolloClient } from '@apollo/client'

export type SchoolReportProposal = { id: string; version: number; childId: string; kind: string; text: string; createdAt: string; expiresAt: string }
export type ConfirmedSchoolReport = { id: string; child: { id: string }; kind: string; text: string; at: string; reportedAt: string | null }
export type ConfirmSchoolReport = (proposal: SchoolReportProposal, signal?: AbortSignal) => Promise<ConfirmedSchoolReport>

export const CONFIRM_SCHOOL_DAY_REPORT = gql`mutation ConfirmSchoolDayReport($proposalId: ID!, $version: Int!) {
  confirmSchoolDayReport(proposalId: $proposalId, version: $version) {
    id child { id } kind text at reportedAt
  }
}`

export function parseSchoolReportProposal(value: unknown): SchoolReportProposal | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || !row.id || !Number.isSafeInteger(row.version) || (row.version as number) < 1 ||
      typeof row.childId !== 'string' || !row.childId || typeof row.kind !== 'string' || !row.kind.trim() ||
      typeof row.text !== 'string' || !row.text.trim() || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) ||
      typeof row.expiresAt !== 'string' || !Number.isFinite(Date.parse(row.expiresAt))) return null
  return { id: row.id, version: row.version as number, childId: row.childId, kind: row.kind, text: row.text, createdAt: row.createdAt, expiresAt: row.expiresAt }
}

export function schoolReportError(error: unknown): 'expired' | 'stale' | 'refused' | 'sign-in' | 'uncertain' {
  const codes = (error as { errors?: Array<{ extensions?: { code?: unknown }; message?: unknown }> })?.errors ??
    (error as { graphQLErrors?: Array<{ extensions?: { code?: unknown }; message?: unknown }> })?.graphQLErrors ?? []
  const values = codes.flatMap(item => [item.extensions?.code, item.message]).filter((item): item is string => typeof item === 'string')
  if (values.some(value => value.includes('PROPOSAL_EXPIRED'))) return 'expired'
  if (values.some(value => value.includes('PROPOSAL_STALE'))) return 'stale'
  if (values.some(value => value.includes('UNAUTHENTICATED'))) return 'sign-in'
  if (values.some(value => /UNAUTHORIZED|DEMO_GUIDE_READ_ONLY|PROPOSAL_NOT_FOUND/.test(value))) return 'refused'
  return 'uncertain'
}

export function createLiveSchoolReportConfirm(client: ApolloClient): ConfirmSchoolReport {
  return async (proposal, signal) => {
    const result = await client.mutate<{ confirmSchoolDayReport: ConfirmedSchoolReport }>({
      mutation: CONFIRM_SCHOOL_DAY_REPORT,
      variables: { proposalId: proposal.id, version: proposal.version },
      context: { fetchOptions: { signal } },
      fetchPolicy: 'no-cache',
    })
    const report = result.data?.confirmSchoolDayReport
    if (!report || report.child?.id !== proposal.childId || typeof report.id !== 'string' || !report.id ||
        report.kind !== proposal.kind || report.text !== proposal.text) throw new Error('Invalid report response')
    return report
  }
}

// Offline presentation only. Never issues a network call or creates a school record.
export function createMockSchoolReportConfirm(): ConfirmSchoolReport {
  const reports = new Map<string, ConfirmedSchoolReport>()
  return async proposal => {
    const key = `${proposal.id}:${proposal.version}`
    const existing = reports.get(key)
    if (existing) return existing
    const report = { id: `sample-${proposal.id}`, child: { id: proposal.childId }, kind: proposal.kind, text: proposal.text, at: '2026-11-01', reportedAt: null }
    reports.set(key, report)
    return report
  }
}
