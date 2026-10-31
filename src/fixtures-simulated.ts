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
  fixture: true;
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
  fixture: true;
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
        fixture: true,
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
        fixture: true,
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
        fixture: true,
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
  events: Record<string, unknown>[];
};

/**
 * A NON-SANDBOX record the Demo guide must NOT see. It lives in the same village as Nora so the
 * only reason the guide is refused is the sandbox flag — that is the seam being audited.
 */
export type SimulatedPrivate = {
  households: Record<string, unknown>[];
  people: Record<string, unknown>[];
  children: Record<string, unknown>[];
  household_members: Record<string, unknown>[];
};

export function createSimulatedPrivate(): SimulatedPrivate {
  return {
    households: [{ id: 'fx_audit_hh', village_id: 'v_nora', sandbox: false }],
    people: [
      { id: 'fx_audit_parent', display_name: 'Audit Parent', birth_date: '1985-04-04' },
      { id: 'fx_audit_child', display_name: 'Audit Child', birth_date: '2016-09-09' },
    ],
    children: [{ person_id: 'fx_audit_child' }],
    household_members: [
      { person_id: 'fx_audit_parent', household_id: 'fx_audit_hh', role: 'parent' },
      { person_id: 'fx_audit_child', household_id: 'fx_audit_hh', role: 'child' },
    ],
  };
}

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
        fixture: true,
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
        fixture: true,
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
        fixture: true,
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
        fixture: true,
      },
    ],
    events: [
      {
        id: 'fx_ev_nora_recital_cancelled',
        child_id: 'p_nora',
        title: 'Recital (cancelled)',
        start_at: '2026-11-21T18:00:00Z',
        end_at: '2026-11-21T20:00:00Z',
        location: 'Community hall',
        status: 'cancelled',
        fixture: true,
      },
      {
        id: 'fx_ev_audit_private',
        child_id: 'fx_audit_child',
        title: 'Private appointment',
        start_at: '2026-11-21T09:00:00Z',
        end_at: '2026-11-21T10:00:00Z',
        location: null,
        status: 'confirmed',
        fixture: true,
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
        fixture: true,
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
        fixture: true,
      },
    ],
  };
}

// ---------------------------------------------------------------- orbit (Task O)

/**
 * The Ellison `orbit_notify_eligible` policy — Scenario 8 requires Andre (the co-parent) in the
 * audience. It is a FIXTURE row: `household_policies` has no marker column, so this rule name is the
 * handle, and cleanup removes exactly this rule (Group 4 will take ownership of the canonical seed).
 */
export type SimulatedOrbit = {
  label: typeof SIMULATED_LABEL;
  household_policies: Record<string, unknown>[];
  policy_rule: string;
};

export function createSimulatedOrbit(): SimulatedOrbit {
  return {
    label: SIMULATED_LABEL,
    policy_rule: 'orbit_notify_eligible',
    household_policies: [
      // h_a is the Ellison household where Nora's record is anchored.
      { household_id: 'h_a', rule: 'orbit_notify_eligible', value: 'p_dad,p_gma,p_bryan' },
    ],
  };
}

// ---------------------------------------------------------------- expected check-in (Orbit trigger)

/**
 * "Nora home by 4:00" with NOTHING recorded: the signal Rosina notices and offers Orbit for.
 * The read reports "check-in not recorded" — never missing, never in danger — and only to parents.
 */
export type SimulatedCheckIn = {
  label: typeof SIMULATED_LABEL;
  expected_checkins: Record<string, unknown>[];
};

export function createSimulatedCheckIn(): SimulatedCheckIn {
  return {
    label: SIMULATED_LABEL,
    expected_checkins: [
      {
        id: 'fx_chk_nora_home_by_four',
        child_id: 'p_nora',
        label: 'home by 4:00',
        due_at: '2026-10-31T20:00:00Z',
        active: true,
        sandbox: true,
        fixture: true,
      },
    ],
  };
}

// ---------------------------------------------------------------- care facts (Group 4)

/**
 * Priya's three questions, each answered by a fact WITH a source and a verifier: PB-safe snack,
 * TV limit, bedtime. A fact without a source is not a fact, so nothing here is bare.
 */
export type SimulatedCareFacts = {
  label: typeof SIMULATED_LABEL;
  care_facts: Record<string, unknown>[];
};

export function createSimulatedCareFacts(): SimulatedCareFacts {
  const source = { source_kind: 'PARENT_CONVERSATION', source_ref: 'Kendra, care conversation 2026-10-12' };
  const verified = { verified_by: 'p_mom', verified_at: '2026-10-12T18:00:00Z', confidence: 'CONFIRMED' };
  return {
    label: SIMULATED_LABEL,
    care_facts: [
      { id: 'fx_cf_nora_snack', child_id: 'p_nora', key: 'snack',
        value: 'Peanut-free snack only — no nuts, no shared utensils', ...source, ...verified,
        sandbox: true, fixture: true },
      { id: 'fx_cf_nora_tv', child_id: 'p_nora', key: 'tv',
        value: '30 minutes after homework; screens off by 8pm', ...source, ...verified,
        sandbox: true, fixture: true },
      { id: 'fx_cf_nora_bedtime', child_id: 'p_nora', key: 'bedtime',
        value: 'Lights out 8:30pm on school nights', ...source, ...verified,
        sandbox: true, fixture: true },
    ],
  };
}
