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

/**
 * Pristine enrichment (Bryan, 2026-11-03, QA item 8): the Village pulse must show a month of
 * activity, not a single request. Everything below is RECORDED history — terminal or
 * parent-gated statuses only (confirmed / failed / awaiting_approval), TEST_RESPONDER attempts
 * with closed_at set — so no sweeper or outreach path can treat a row as live work to dispatch.
 */
const PRISTINE_JOBS: SimulatedJob[] = ([
  ['p_nora', '2026-10-08', 'confirmed'], ['p_nora', '2026-10-13', 'confirmed'],
  ['p_nora', '2026-10-20', 'failed'], ['p_nora', '2026-10-22', 'confirmed'],
  ['p_nora', '2026-10-29', 'confirmed'], ['p_nora', '2026-11-02', 'confirmed'],
  ['p_jax', '2026-10-09', 'confirmed'], ['p_jax', '2026-10-19', 'confirmed'],
  ['p_jax', '2026-10-30', 'confirmed'], ['p_jax', '2026-11-02', 'awaiting_approval'],
] as const).map(([child, day, status]) => ({
  id: `fx_job_${child}_${day}`,
  idempotency_key: `pickup:${child}:${day}:afternoon`,
  type: 'PICKUP' as const,
  child_id: child,
  status,
  version: 1,
  as_of: day,
  created_at: `${day}T19:30:00Z`,
  fixture: true as const,
}));

const PRISTINE_ATTEMPT_CANDIDATES: Record<string, string[]> = {
  p_nora: ['p_gma', 'p_tasha', 'p_bryan', 'p_monique'],
  p_jax: ['p_ray', 'p_evelyn'],
};

const PRISTINE_ATTEMPTS: SimulatedAttempt[] = PRISTINE_JOBS.flatMap((job, i) => {
  const pool = PRISTINE_ATTEMPT_CANDIDATES[job.child_id] ?? [];
  if (!pool.length) return [];
  const first = pool[i % pool.length];
  const attempts: SimulatedAttempt[] = [{
    id: `fx_att_${job.id}_1`,
    job_id: job.id,
    channel: i % 2 === 0 ? 'CALL' : 'SMS',
    at: `${job.as_of}T19:32:00Z`,
    candidate_id: first,
    destination_mode: 'TEST_RESPONDER',
    closed_at: `${job.as_of}T19:33:00Z`,
    closed_reason: job.status === 'failed' ? 'DECLINED' : 'ACCEPTED',
    fixture: true,
  }];
  if (job.status === 'failed') {
    attempts.push({
      id: `fx_att_${job.id}_2`,
      job_id: job.id,
      channel: 'SMS',
      at: `${job.as_of}T19:40:00Z`,
      candidate_id: pool[(i + 1) % pool.length],
      destination_mode: 'TEST_RESPONDER',
      closed_at: `${job.as_of}T19:45:00Z`,
      closed_reason: 'DECLINED',
      fixture: true,
    });
  }
  return attempts;
});

export function createSimulatedCoordination(): SimulatedCoordination {
  return {
    label: SIMULATED_LABEL,
    coordination_jobs: [
      ...PRISTINE_JOBS,
      {
        id: 'job_emma_nov05',
        idempotency_key: 'pickup:p_emma:2026-11-05:afternoon',
        type: 'PICKUP',
        child_id: 'p_emma',
        status: 'awaiting_approval',
        version: 1,
        as_of: '2026-11-05',
        created_at: '2026-11-05T15:00:00Z',
        fixture: true,
      },
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
      ...PRISTINE_ATTEMPTS,
      {
        id: 'att_emma_nov05_rosa',
        job_id: 'job_emma_nov05',
        channel: 'CALL',
        at: '2026-11-05T15:02:00Z',
        candidate_id: 'p_rosa',
        destination_mode: 'TEST_RESPONDER',
        closed_at: '2026-11-05T15:02:30Z',
        closed_reason: 'ACCEPTED',
        fixture: true,
      },
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

// Pristine enrichment: recorded Busy/Free windows for every parent and active caregiver, so the
// calendar's "Recorded busy/free time" panel is never an empty state for a parent family.
// Reasons stay private-by-design (owner-only column); FREE windows carry no reason.
const PRISTINE_AVAILABILITY: Record<string, unknown>[] = ([
  ['p_mom', '2026-11-05T13:00:00Z', '2026-11-05T21:00:00Z', 'BUSY', 'work shift'],
  ['p_mom', '2026-11-08T15:00:00Z', '2026-11-08T19:00:00Z', 'FREE', null],
  ['p_dad', '2026-11-06T14:00:00Z', '2026-11-06T18:00:00Z', 'FREE', null],
  ['p_dad', '2026-11-10T13:00:00Z', '2026-11-10T22:00:00Z', 'BUSY', 'site visit'],
  ['p_gma', '2026-11-04T16:00:00Z', '2026-11-04T20:00:00Z', 'FREE', null],
  ['p_gma', '2026-11-12T16:00:00Z', '2026-11-12T20:00:00Z', 'FREE', null],
  ['p_priya', '2026-11-06T20:00:00Z', '2026-11-06T23:00:00Z', 'FREE', null],
  ['p_dana', '2026-11-05T12:00:00Z', '2026-11-05T20:00:00Z', 'BUSY', 'clinic rotation'],
  ['p_dana', '2026-11-07T14:00:00Z', '2026-11-07T18:00:00Z', 'FREE', null],
  ['p_ray', '2026-11-06T21:00:00Z', '2026-11-06T23:30:00Z', 'FREE', null],
  ['p_evelyn', '2026-11-09T15:00:00Z', '2026-11-09T19:00:00Z', 'FREE', null],
  ['p_rosa', '2026-11-05T14:00:00Z', '2026-11-05T18:00:00Z', 'FREE', null],
  ['p_felicia', '2026-11-06T13:00:00Z', '2026-11-06T21:00:00Z', 'BUSY', 'work shift'],
  ['p_simone', '2026-11-11T15:00:00Z', '2026-11-11T19:00:00Z', 'FREE', null],
  ['p_dwayne', '2026-11-10T12:00:00Z', '2026-11-10T20:00:00Z', 'BUSY', 'depot shift'],
] as const).map(([person, start, end, state, reason], i) => ({
  id: `fx_av_pristine_${i}_${person}`,
  person_id: person,
  start_at: start,
  end_at: end,
  state,
  reason,
  fixture: true,
}));

const PRISTINE_CAL_CHILDREN = ['p_nora', 'p_jax', 'p_emma', 'p_taylor', 'p_micah', 'p_malik', 'p_leo', 'p_max'];

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
      // Veterans Day school closure for every school-age cast child (pristine enrichment).
      ...PRISTINE_CAL_CHILDREN.map((child) => ({
        id: `fx_hol_${child}_veterans`,
        child_id: child,
        name: 'Veterans Day — no school',
        start_date: '2026-11-11',
        end_date: '2026-11-11',
        fixture: true,
      })),
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
      ...PRISTINE_AVAILABILITY,
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
      // Pristine enrichment: the Coleman family's Veterans Day is arranged (Dana's calendar
      // shows an approved band), and Rosa has a pending Thanksgiving proposal for Emma.
      {
        id: 'fx_ha_jax_veterans',
        child_id: 'p_jax',
        holiday_name: 'Veterans Day',
        date_start: '2026-11-11',
        date_end: '2026-11-11',
        assigned_parent_id: 'p_ray',
        pickup_duty_parent_id: 'p_ray',
        dropoff_duty_parent_id: 'p_ray',
        status: 'APPROVED',
        proposed_by_id: 'p_dana',
        fixture: true,
      },
      {
        id: 'fx_ha_emma_thanksgiving',
        child_id: 'p_emma',
        holiday_name: 'Thanksgiving',
        date_start: '2026-11-25',
        date_end: '2026-11-27',
        assigned_parent_id: 'p_tomas',
        pickup_duty_parent_id: 'p_tomas',
        dropoff_duty_parent_id: 'p_tomas',
        status: 'PROPOSED',
        proposed_by_id: 'p_rosa',
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
      {
        id: 'fx_cf_emma_snack', child_id: 'p_emma', key: 'snack',
        value: 'Nut-free classroom; fruit or cheese for snack',
        source_kind: 'PARENT_CONVERSATION', source_ref: 'Rosa, care conversation 2026-10-22',
        verified_by: 'p_rosa', verified_at: '2026-10-22T16:00:00Z', confidence: 'CONFIRMED',
        sandbox: true, fixture: true,
      },
      {
        id: 'fx_cf_emma_tv', child_id: 'p_emma', key: 'tv',
        value: 'One 20-minute programme after homework only',
        source_kind: 'PARENT_CONVERSATION', source_ref: 'Rosa, care conversation 2026-10-22',
        verified_by: 'p_rosa', verified_at: '2026-10-22T16:00:00Z', confidence: 'CONFIRMED',
        sandbox: true, fixture: true,
      },
      {
        id: 'fx_cf_emma_bedtime', child_id: 'p_emma', key: 'bedtime',
        value: 'Story at 7:30pm, lights out 8:00pm',
        source_kind: 'PARENT_CONVERSATION', source_ref: 'Rosa, care conversation 2026-10-22',
        verified_by: 'p_rosa', verified_at: '2026-10-22T16:00:00Z', confidence: 'CONFIRMED',
        sandbox: true, fixture: true,
      },
      { id: 'fx_cf_nora_bedtime', child_id: 'p_nora', key: 'bedtime',
        value: 'Lights out 8:30pm on school nights', ...source, ...verified,
        sandbox: true, fixture: true },
    ],
  };
}
