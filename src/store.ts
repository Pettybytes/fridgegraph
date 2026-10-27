import { createSeed, type Seed } from './fixtures';

/** The single in-memory store shared by all seven subgraphs (Supabase replaces it later). */
export const store: Seed = createSeed();

let approvalSeq = 0;
let grantSeq = 0;

/** Restore every table to the fixtures. Arrays are replaced on the shared object in place. */
export function resetStore(): void {
  const fresh = createSeed();
  for (const key of Object.keys(fresh) as (keyof Seed)[]) {
    (store as Record<string, unknown>)[key as string] = fresh[key];
  }
  approvalSeq = 0;
  grantSeq = 0;
}

/**
 * Written by both `village.approveRelationship` and `access.grantAccess`.
 * This is the one intentional cross-table write in Milestone 1: Step 3 requires each of those
 * mutations to record an Approval row, and `access` owns the approvals table.
 */
export function recordApproval(input: {
  approverId: string;
  subjectType: string;
  subjectId: string;
  decision: string;
  at: string;
}): void {
  approvalSeq += 1;
  store.approvals.push({
    id: `ap_${approvalSeq}`,
    approverId: input.approverId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    decision: input.decision,
    at: input.at,
  });
}

export function nextGrantId(): string {
  grantSeq += 1;
  return `g_new_${grantSeq}`;
}
