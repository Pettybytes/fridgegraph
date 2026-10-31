/**
 * SIMULATED fixtures — additive, and deliberately SEPARATE from the v1 baseline.
 *
 * WHY SEPARATE: the v1 seed (`src/fixtures.ts` + `scripts/db.ts#baseline()`) has an agreed checksum
 * over 29 tables. Demo rows are useful, but folding them into that baseline would silently move the
 * number every other proof compares against. So they live here, seed with their own command
 * (`npx tsx scripts/db.ts seed:simulated`), and carry their own checksum.
 *
 * WHAT IS SIMULATED: simulated outreach (TEST_RESPONDER attempts only), a school closure, two
 * routine definitions, one recorded Busy window with a private reason, and two approved holiday
 * arrangements. NOTHING here creates a real-call authorization, a consent, or a spend.
 *
 * NO EVENT ROWS: `events` is a v1 BASELINE table that already holds a row, so a fixture row there
 * would move its checksum — the one thing this separation must prevent. Status filtering is
 * therefore exercised by the resolver, not by seeded data (recorded as PENDING in evidence 41).
 *
 * `db:reset` removes all of it (that is what restores v1); re-apply with `seed:simulated`.
 */

export const SIMULATED_LABEL = 'SIMULATED';

// ---------------------------------------------------------------- coordination

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

// ---------------------------------------------------------------- calendar (Group 3)

export type SimulatedCalendar = {
  label: typeof SIMULATED_LABEL;
  holidays: Record<string, unknown>[];
  routines: Record<string, unknown>[];
  adult_availability: Record<string, unknown>[];
  holiday_arrangements: Record<string, unknown>[];
};

export function createSimulatedCalendar(): SimulatedCalendar {
  return {
    label: SIMULATED_LABEL,
    holidays: [
      {
        id: 'hol_nora_thanksgiving',
        child_id: 'p_nora',
        name: 'Thanksgiving break',
        start_date: '2026-11-25',
        end_date: '2026-11-27',
      },
    ],
    routines: [
      {
        id: 'rt_nora_school_run',
        child_id: 'p_nora',
        title: 'School run',
        weekdays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
        start_time: '08:00',
        end_time: '08:30',
        location: 'Nora\u2019s school',
        applies_on: 'SCHOOL_DAY',
      },
      {
        id: 'rt_nora_bedtime',
        child_id: 'p_nora',
        title: 'Bedtime',
        weekdays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
        start_time: '20:30',
        end_time: '21:00',
        location: null,
        applies_on: 'ANY_DAY',
      },
    ],
    adult_availability: [
      {
        id: 'av_kendra_shift',
        person_id: 'p_mom',
        start_at: '2026-11-25T14:00:00Z',
        end_at: '2026-11-25T22:00:00Z',
        state: 'BUSY',
        reason: 'late shift',
      },
    ],
    holiday_arrangements: [
      {
        id: 'ha_nora_thanksgiving',
        child_id: 'p_nora',
        holiday_name: 'Thanksgiving',
        date_start: '2026-11-25',
        date_end: '2026-11-27',
        assigned_parent_id: 'p_dad',
        pickup_duty_parent_id: 'p_dad',
        dropoff_duty_parent_id: 'p_dad',
        status: 'APPROVED',
        proposed_by_id: 'p_dad',
      },
      {
        id: 'ha_nora_thanksgiving_overlap',
        child_id: 'p_nora',
        holiday_name: 'Thanksgiving (duplicate)',
        date_start: '2026-11-26',
        date_end: '2026-11-27',
        assigned_parent_id: 'p_dad',
        pickup_duty_parent_id: 'p_dad',
        dropoff_duty_parent_id: 'p_dad',
        status: 'APPROVED',
        proposed_by_id: 'p_mom',
      },
    ],
  };
}
