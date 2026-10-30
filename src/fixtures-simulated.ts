/**
 * SIMULATED coordination fixture — additive, and deliberately SEPARATE from the v1 baseline.
 *
 * WHY SEPARATE: the v1 seed (`src/fixtures.ts` + `scripts/db.ts#baseline()`) has an agreed 28-table
 * checksum. Coordinating demo rows are useful to the demo, but folding them into that baseline would
 * silently move the number every other proof compares against. So they live here, seed by their own
 * command (`tsx scripts/db.ts seed:simulated`), and carry their own checksum.
 *
 * WHAT IT IS: one closed-loop pickup job on Nora with two attempts — one accepted via Loretta, one
 * declined via Tasha. Every attempt is `TEST_RESPONDER`: simulated outreach in the shared sandbox.
 * This creates NO real-call authorization, no consent, no spend, and nothing that can dial or text.
 *
 * WHAT IT IS NOT: it is not baseline. `db:reset` removes it (that is what restores the v1 baseline);
 * re-apply it with `seed:simulated` when the demo needs the coordination reads to show a record.
 */

export const SIMULATED_LABEL = 'SIMULATED';

export type SimulatedJob = {
  id: string;
  idempotency_key: string;
  type: 'PICKUP' | 'INVITATION' | 'ONBOARDING';
  child_id: string;
  status: string;
  version: number;
  as_of: string;
  created_at: string;
};

export type SimulatedAttempt = {
  id: string;
  job_id: string;
  channel: 'SMS' | 'CALL';
  at: string;
  candidate_id: string;
  destination_mode: 'TEST_RESPONDER';
  closed_at: string;
  closed_reason: string;
};

export type SimulatedCoordination = {
  label: typeof SIMULATED_LABEL;
  coordination_jobs: SimulatedJob[];
  attempts: SimulatedAttempt[];
};

export function createSimulatedCoordination(): SimulatedCoordination {
  return {
    label: SIMULATED_LABEL,
    coordination_jobs: [
      {
        id: 'job_nora_oct16',
        idempotency_key: 'pickup:p_nora:2026-10-16:afternoon',
        type: 'PICKUP',
        child_id: 'p_nora',
        status: 'awaiting_approval',
        version: 3,
        as_of: '2026-10-16',
        created_at: '2026-10-16T15:00:00Z',
      },
    ],
    attempts: [
      {
        id: 'att_nora_oct16_gma',
        job_id: 'job_nora_oct16',
        channel: 'CALL',
        at: '2026-10-16T15:02:00Z',
        candidate_id: 'p_gma',
        destination_mode: 'TEST_RESPONDER',
        closed_at: '2026-10-16T15:02:40Z',
        closed_reason: 'ACCEPTED',
      },
      {
        id: 'att_nora_oct16_tasha',
        job_id: 'job_nora_oct16',
        channel: 'SMS',
        at: '2026-10-16T15:03:00Z',
        candidate_id: 'p_tasha',
        destination_mode: 'TEST_RESPONDER',
        closed_at: '2026-10-16T15:03:35Z',
        closed_reason: 'DECLINED',
      },
    ],
  };
}
