/**
 * The 30-day demo pickup-coordination history (v1, PROPOSED). Full design:
 * docs/contracts/demo-history.md + docs/contracts/demo-history.schema.json.
 *
 * Deterministic and versioned: every date is computed from the single fixed anchor `ANCHOR`
 * (2026-11-02, America/Detroit) — never from `Date.now()` — so this function returns byte-for-byte
 * the same rows every time it is called, exactly like `src/fixtures.ts`'s own baseline seed.
 *
 * `D-1 = 2026-11-01` is deliberately the fall-back DST boundary itself (Detroit's clocks repeat
 * 01:00-02:00 local that morning) — see STORY_SPECS' `hist_19`/`hist_20`.
 *
 * Child: p_nora. Confirmation approver is whichever parent is ON DUTY per Nora's real weekly
 * schedule (0002_seed.sql parenting_schedules: p_mom MON/TUE/WED, p_dad THU/FRI/SAT/SUN), NOT
 * always Kendra — see `approverOnDetroitDate`. Caregivers: drawn ONLY from people who already hold
 * a real grant for Nora in src/fixtures.ts (p_gma/Loretta, p_tasha, p_priya, p_walter, p_gloria) —
 * no new person is invented.
 *
 * destination_mode is always TEST_RESPONDER. request_pickup/accept_pickup/approve_pickup are
 * NEVER called by this seed — every row is inserted directly, so no SMS/call/webhook/Orbit
 * notification is ever triggered by inserting this dataset (docs/contracts/demo-history.md §7).
 */

const ANCHOR = '2026-11-02'; // America/Detroit calendar date, D.
const DETROIT_OFFSET_BEFORE_FALLBACK = '-04:00'; // EDT, through 2026-11-01 01:59:59 local
const DETROIT_OFFSET_AFTER_FALLBACK = '-05:00'; // EST, from 2026-11-01 02:00:00 local onward (and all of 11-02)

/** Days before the anchor, 1-indexed offset table keyed to each story spec below. */
function detroitDateOffset(daysBeforeAnchor: number): string {
  const d = new Date(`${ANCHOR}T12:00:00${DETROIT_OFFSET_AFTER_FALLBACK}`);
  d.setUTCDate(d.getUTCDate() - daysBeforeAnchor);
  return d.toISOString().slice(0, 10);
}

/** A Detroit local wall-clock instant -> real UTC ISO string, offset chosen explicitly per call
 * (never inferred) so the one story that straddles the fall-back boundary is unambiguous. */
function detroit(dateIso: string, hhmm: string, offset: typeof DETROIT_OFFSET_BEFORE_FALLBACK | typeof DETROIT_OFFSET_AFTER_FALLBACK): string {
  return new Date(`${dateIso}T${hhmm}:00${offset}`).toISOString();
}

type Row = Record<string, unknown>;

/**
 * Nora's real weekly schedule (0002_seed.sql: parenting_schedules — p_mom MON/TUE/WED, p_dad
 * THU/FRI/SAT/SUN) is the SAME rule effective_schedule_for (0028) falls back to once no approved
 * holiday_arrangements row covers the date — and none does for p_nora across this dataset's window
 * (2026-10-04..2026-11-02; the only fixture arrangement, ha_nora_thanksgiving, covers 11-25..11-27).
 * So the weekly rule alone decides every confirmation's approver here; mirrors the SQL exactly
 * rather than hardcoding one parent.
 */
const WEEKDAY_APPROVER: Record<string, string> = {
  MON: 'p_mom', TUE: 'p_mom', WED: 'p_mom',
  THU: 'p_dad', FRI: 'p_dad', SAT: 'p_dad', SUN: 'p_dad',
};
const WEEKDAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/** effective_schedule_for's WEEKLY branch, evaluated in TS against the same source rows. */
function approverOnDetroitDate(dateIso: string): string {
  const code = WEEKDAY_CODES[new Date(`${dateIso}T12:00:00Z`).getUTCDay()];
  return WEEKDAY_APPROVER[code];
}

type CandidateResponse = {
  candidateId: string;
  attemptChannel: 'SMS' | 'CALL';
  attemptAt: string; // UTC ISO
  closedAt?: string; // UTC ISO — set for TIMEOUT/NO_ANSWER closures, or alongside a response
  closedReason?: string;
  respondedAt?: string; // UTC ISO — only when a real human answered
  responseKind?: 'ACCEPTED' | 'DECLINED';
  declineReason?: 'BUSY' | 'NO_TRANSPORT' | 'OTHER';
  /** A DRAFT line this PR wrote to describe what the story needs to say — not a delivered
   * transcript. Stored as voice_notes.proposed_script, status PENDING, until Bentley supplies
   * the real audio/transcript/duration/hash. */
  proposedVoiceNote?: { script: string; estimatedDurationSeconds: number };
};

type StorySpec = {
  n: number; // 1..20, -> job_hist_NN
  daysBeforeAnchor: number;
  requestedAt: string; // UTC ISO — JOB_CREATED
  status: 'pending' | 'discovering' | 'awaiting_approval' | 'confirmed' | 'failed';
  candidates: CandidateResponse[];
  confirmedCandidateId?: string;
  confirmedAt?: string; // UTC ISO
  declinedAt?: string; // UTC ISO — approve_pickup's DECLINED branch
  failureReason?: string;
};

// prettier-ignore
const STORY_SPECS: StorySpec[] = [
  // --- D-29..D-26: pending / no attempt yet (4 of these across the set) ---
  { n: 1, daysBeforeAnchor: 29, requestedAt: detroit(detroitDateOffset(29), '15:00', DETROIT_OFFSET_BEFORE_FALLBACK), status: 'pending', candidates: [] },
  { n: 2, daysBeforeAnchor: 28, requestedAt: detroit(detroitDateOffset(28), '08:30', DETROIT_OFFSET_BEFORE_FALLBACK), status: 'pending', candidates: [] },

  // --- D-28: two timed-out attempts on the SAME day (cluster, not evenly spaced) ---
  {
    n: 3, daysBeforeAnchor: 28, requestedAt: detroit(detroitDateOffset(28), '15:10', DETROIT_OFFSET_BEFORE_FALLBACK),
    status: 'failed', failureReason: 'DISCOVERY_WINDOW_EXPIRED',
    candidates: [
      { candidateId: 'p_gma', attemptChannel: 'SMS', attemptAt: detroit(detroitDateOffset(28), '15:12', DETROIT_OFFSET_BEFORE_FALLBACK), closedAt: detroit(detroitDateOffset(28), '16:12', DETROIT_OFFSET_BEFORE_FALLBACK), closedReason: 'TIMEOUT' },
      { candidateId: 'p_tasha', attemptChannel: 'SMS', attemptAt: detroit(detroitDateOffset(28), '15:14', DETROIT_OFFSET_BEFORE_FALLBACK), closedAt: detroit(detroitDateOffset(28), '16:14', DETROIT_OFFSET_BEFORE_FALLBACK), closedReason: 'TIMEOUT' },
    ],
  },

  // --- D-25: both contact attempts closed no-answer ---
  {
    n: 4, daysBeforeAnchor: 25, requestedAt: detroit(detroitDateOffset(25), '14:00', DETROIT_OFFSET_BEFORE_FALLBACK),
    status: 'failed', failureReason: 'no_answer_both',
    candidates: [
      { candidateId: 'p_priya', attemptChannel: 'CALL', attemptAt: detroit(detroitDateOffset(25), '14:02', DETROIT_OFFSET_BEFORE_FALLBACK), closedAt: detroit(detroitDateOffset(25), '14:05', DETROIT_OFFSET_BEFORE_FALLBACK), closedReason: 'NO_ANSWER' },
      { candidateId: 'p_walter', attemptChannel: 'CALL', attemptAt: detroit(detroitDateOffset(25), '14:06', DETROIT_OFFSET_BEFORE_FALLBACK), closedAt: detroit(detroitDateOffset(25), '14:09', DETROIT_OFFSET_BEFORE_FALLBACK), closedReason: 'NO_ANSWER' },
    ],
  },
  { n: 5, daysBeforeAnchor: 26, requestedAt: detroit(detroitDateOffset(26), '09:00', DETROIT_OFFSET_BEFORE_FALLBACK), status: 'pending', candidates: [] },

  // --- D-24: a real decline, with a second attempt opened and still awaiting a reply ---
  {
    n: 6, daysBeforeAnchor: 24, requestedAt: detroit(detroitDateOffset(24), '13:00', DETROIT_OFFSET_BEFORE_FALLBACK),
    status: 'discovering',
    candidates: [
      { candidateId: 'p_gloria', attemptChannel: 'SMS', attemptAt: detroit(detroitDateOffset(24), '13:02', DETROIT_OFFSET_BEFORE_FALLBACK), respondedAt: detroit(detroitDateOffset(24), '13:11', DETROIT_OFFSET_BEFORE_FALLBACK), responseKind: 'DECLINED', declineReason: 'BUSY' },
      { candidateId: 'p_tasha', attemptChannel: 'SMS', attemptAt: detroit(detroitDateOffset(24), '13:12', DETROIT_OFFSET_BEFORE_FALLBACK) },
    ],
  },

  // --- D-21: pending approval (response recorded, parent hasn't decided) ---
  {
    n: 7, daysBeforeAnchor: 21, requestedAt: detroit(detroitDateOffset(21), '11:00', DETROIT_OFFSET_BEFORE_FALLBACK),
    status: 'awaiting_approval',
    candidates: [
      { candidateId: 'p_gma', attemptChannel: 'CALL', attemptAt: detroit(detroitDateOffset(21), '11:03', DETROIT_OFFSET_BEFORE_FALLBACK), respondedAt: detroit(detroitDateOffset(21), '11:09', DETROIT_OFFSET_BEFORE_FALLBACK), responseKind: 'ACCEPTED' },
    ],
  },
  // --- D-21: a second, unrelated story the same day — approved and confirmed, completion unknown, WITH a voice note (complete voice-to-resolution story #1) ---
  {
    n: 8, daysBeforeAnchor: 21, requestedAt: detroit(detroitDateOffset(21), '16:00', DETROIT_OFFSET_BEFORE_FALLBACK),
    status: 'confirmed', confirmedCandidateId: 'p_priya', confirmedAt: detroit(detroitDateOffset(21), '16:40', DETROIT_OFFSET_BEFORE_FALLBACK),
    candidates: [
      {
        candidateId: 'p_priya', attemptChannel: 'CALL', attemptAt: detroit(detroitDateOffset(21), '16:02', DETROIT_OFFSET_BEFORE_FALLBACK),
        respondedAt: detroit(detroitDateOffset(21), '16:08', DETROIT_OFFSET_BEFORE_FALLBACK), responseKind: 'ACCEPTED',
        // 4:20 PM EDT — after her own 4:08 PM response and before the 4:40 PM confirmation; the
        // original draft's "3:30" was already in the past at the moment she's recorded as
        // answering. Proposed to Bentley on #167 for the same fix in his script sheet.
        proposedVoiceNote: { script: "Hi — yes, I can grab Nora at 4:20, I'm already headed that way for my own pickup. See you at the gate.", estimatedDurationSeconds: 11.4 },
      },
    ],
  },

  // --- D-20: complete voice-to-resolution story #2 ---
  {
    n: 9, daysBeforeAnchor: 20, requestedAt: detroit(detroitDateOffset(20), '12:30', DETROIT_OFFSET_BEFORE_FALLBACK),
    status: 'confirmed', confirmedCandidateId: 'p_gma', confirmedAt: detroit(detroitDateOffset(20), '13:15', DETROIT_OFFSET_BEFORE_FALLBACK),
    candidates: [
      {
        candidateId: 'p_gma', attemptChannel: 'SMS', attemptAt: detroit(detroitDateOffset(20), '12:32', DETROIT_OFFSET_BEFORE_FALLBACK),
        respondedAt: detroit(detroitDateOffset(20), '12:47', DETROIT_OFFSET_BEFORE_FALLBACK), responseKind: 'ACCEPTED',
        // No parent named — whoever is on duty that day survives the parenting-schedule fix
        // without the script going stale (same reasoning Bentley applied on #167).
        proposedVoiceNote: { script: "Of course, sweetheart. I'll leave a little early and bring her the snack she likes. Tell them not to worry about a thing.", estimatedDurationSeconds: 9.8 },
      },
    ],
  },

  // --- D-17: approved, completion unknown (village-pulse-data.md's own D-17 row) ---
  {
    n: 10, daysBeforeAnchor: 17, requestedAt: detroit(detroitDateOffset(17), '15:00', DETROIT_OFFSET_BEFORE_FALLBACK),
    status: 'confirmed', confirmedCandidateId: 'p_walter', confirmedAt: detroit(detroitDateOffset(17), '15:35', DETROIT_OFFSET_BEFORE_FALLBACK),
    candidates: [
      { candidateId: 'p_walter', attemptChannel: 'CALL', attemptAt: detroit(detroitDateOffset(17), '15:02', DETROIT_OFFSET_BEFORE_FALLBACK), respondedAt: detroit(detroitDateOffset(17), '15:09', DETROIT_OFFSET_BEFORE_FALLBACK), responseKind: 'ACCEPTED' },
    ],
  },
  // --- D-17: a second story, same day — decline with further coordination ---
  {
    n: 11, daysBeforeAnchor: 17, requestedAt: detroit(detroitDateOffset(17), '09:00', DETROIT_OFFSET_BEFORE_FALLBACK),
    status: 'discovering',
    candidates: [
      { candidateId: 'p_tasha', attemptChannel: 'SMS', attemptAt: detroit(detroitDateOffset(17), '09:03', DETROIT_OFFSET_BEFORE_FALLBACK), respondedAt: detroit(detroitDateOffset(17), '09:19', DETROIT_OFFSET_BEFORE_FALLBACK), responseKind: 'DECLINED', declineReason: 'NO_TRANSPORT' },
      { candidateId: 'p_gloria', attemptChannel: 'SMS', attemptAt: detroit(detroitDateOffset(17), '09:20', DETROIT_OFFSET_BEFORE_FALLBACK) },
    ],
  },

  // --- D-15: complete voice-to-resolution story #3 ---
  {
    n: 12, daysBeforeAnchor: 15, requestedAt: detroit(detroitDateOffset(15), '14:00', DETROIT_OFFSET_BEFORE_FALLBACK),
    status: 'confirmed', confirmedCandidateId: 'p_gloria', confirmedAt: detroit(detroitDateOffset(15), '14:50', DETROIT_OFFSET_BEFORE_FALLBACK),
    candidates: [
      {
        candidateId: 'p_gloria', attemptChannel: 'CALL', attemptAt: detroit(detroitDateOffset(15), '14:03', DETROIT_OFFSET_BEFORE_FALLBACK),
        respondedAt: detroit(detroitDateOffset(15), '14:21', DETROIT_OFFSET_BEFORE_FALLBACK), responseKind: 'ACCEPTED',
        proposedVoiceNote: { script: "Hi, this is Gloria. Walter and I can take turns this week, I'm free at three today, just let the front office know I'm coming.", estimatedDurationSeconds: 12.6 },
      },
    ],
  },

  // --- D-12: decline with further coordination, second attempt still open (village-pulse-data.md D-12) ---
  {
    n: 13, daysBeforeAnchor: 12, requestedAt: detroit(detroitDateOffset(12), '10:00', DETROIT_OFFSET_BEFORE_FALLBACK),
    status: 'discovering',
    candidates: [
      { candidateId: 'p_priya', attemptChannel: 'SMS', attemptAt: detroit(detroitDateOffset(12), '10:02', DETROIT_OFFSET_BEFORE_FALLBACK), respondedAt: detroit(detroitDateOffset(12), '10:14', DETROIT_OFFSET_BEFORE_FALLBACK), responseKind: 'DECLINED', declineReason: 'OTHER' },
      { candidateId: 'p_walter', attemptChannel: 'SMS', attemptAt: detroit(detroitDateOffset(12), '10:15', DETROIT_OFFSET_BEFORE_FALLBACK) },
    ],
  },
  { n: 14, daysBeforeAnchor: 13, requestedAt: detroit(detroitDateOffset(13), '07:45', DETROIT_OFFSET_BEFORE_FALLBACK), status: 'pending', candidates: [] },

  // --- D-9: an explicit parent decline/cancellation (JOB_DECLINED) ---
  {
    n: 15, daysBeforeAnchor: 9, requestedAt: detroit(detroitDateOffset(9), '08:00', DETROIT_OFFSET_BEFORE_FALLBACK),
    status: 'failed', declinedAt: detroit(detroitDateOffset(9), '08:40', DETROIT_OFFSET_BEFORE_FALLBACK), failureReason: 'approver_declined',
    candidates: [
      { candidateId: 'p_tasha', attemptChannel: 'CALL', attemptAt: detroit(detroitDateOffset(9), '08:02', DETROIT_OFFSET_BEFORE_FALLBACK), respondedAt: detroit(detroitDateOffset(9), '08:11', DETROIT_OFFSET_BEFORE_FALLBACK), responseKind: 'ACCEPTED' },
    ],
  },

  // --- D-7: in-progress, no reply yet (village-pulse-data.md D-7) ---
  {
    n: 16, daysBeforeAnchor: 7, requestedAt: detroit(detroitDateOffset(7), '16:20', DETROIT_OFFSET_BEFORE_FALLBACK),
    status: 'discovering',
    candidates: [
      { candidateId: 'p_gma', attemptChannel: 'SMS', attemptAt: detroit(detroitDateOffset(7), '16:22', DETROIT_OFFSET_BEFORE_FALLBACK) },
    ],
  },

  // --- D-4: a second explicit cancellation, this one with no prior attempt at all ---
  {
    n: 17, daysBeforeAnchor: 4, requestedAt: detroit(detroitDateOffset(4), '12:00', DETROIT_OFFSET_BEFORE_FALLBACK),
    status: 'failed', declinedAt: detroit(detroitDateOffset(4), '12:05', DETROIT_OFFSET_BEFORE_FALLBACK), failureReason: 'parent_cancelled_plans_changed',
    candidates: [],
  },

  // --- D-3: an explicit refusal recorded, with its own event time (village-pulse-data.md D-3) ---
  {
    n: 18, daysBeforeAnchor: 3, requestedAt: detroit(detroitDateOffset(3), '13:30', DETROIT_OFFSET_BEFORE_FALLBACK),
    status: 'failed', declinedAt: detroit(detroitDateOffset(3), '14:10', DETROIT_OFFSET_BEFORE_FALLBACK), failureReason: 'approver_declined',
    candidates: [
      { candidateId: 'p_priya', attemptChannel: 'SMS', attemptAt: detroit(detroitDateOffset(3), '13:32', DETROIT_OFFSET_BEFORE_FALLBACK), respondedAt: detroit(detroitDateOffset(3), '13:50', DETROIT_OFFSET_BEFORE_FALLBACK), responseKind: 'ACCEPTED' },
    ],
  },

  // --- D-1 = 2026-11-01, the DST fall-back day: request + response + pending approval ---
  // The attempt is sent at 01:30 local BEFORE the fall-back (EDT, -04:00); the response arrives at
  // 01:30 local AFTER the fall-back (EST, -05:00) — the SAME wall-clock reading, an hour apart in
  // real UTC time. Both instants are recorded unambiguously.
  {
    n: 19, daysBeforeAnchor: 1, requestedAt: detroit(detroitDateOffset(1), '01:15', DETROIT_OFFSET_BEFORE_FALLBACK),
    status: 'awaiting_approval',
    candidates: [
      {
        candidateId: 'p_walter', attemptChannel: 'SMS',
        attemptAt: detroit(detroitDateOffset(1), '01:30', DETROIT_OFFSET_BEFORE_FALLBACK), // 2026-11-01T05:30:00Z
        respondedAt: detroit(detroitDateOffset(1), '01:30', DETROIT_OFFSET_AFTER_FALLBACK), // 2026-11-01T06:30:00Z — one real hour later
        responseKind: 'ACCEPTED',
      },
    ],
  },
  // --- D-1: a second story the same day, ordinary (not DST-adjacent), confirmed, completion unknown ---
  {
    n: 20, daysBeforeAnchor: 1, requestedAt: detroit(detroitDateOffset(1), '15:00', DETROIT_OFFSET_AFTER_FALLBACK),
    status: 'confirmed', confirmedCandidateId: 'p_gma', confirmedAt: detroit(detroitDateOffset(1), '15:30', DETROIT_OFFSET_AFTER_FALLBACK),
    candidates: [
      { candidateId: 'p_gma', attemptChannel: 'CALL', attemptAt: detroit(detroitDateOffset(1), '15:02', DETROIT_OFFSET_AFTER_FALLBACK), respondedAt: detroit(detroitDateOffset(1), '15:08', DETROIT_OFFSET_AFTER_FALLBACK), responseKind: 'ACCEPTED' },
    ],
  },
];

export type DemoHistory = {
  coordination_jobs: Row[];
  attempts: Row[];
  candidate_evaluations: Row[];
  confirmations: Row[];
  voice_notes: Row[];
};

export function createDemoHistory(): DemoHistory {
  const coordination_jobs: Row[] = [];
  const attempts: Row[] = [];
  const candidate_evaluations: Row[] = [];
  const confirmations: Row[] = [];
  const voice_notes: Row[] = [];

  for (const spec of STORY_SPECS) {
    const jobId = `job_hist_${String(spec.n).padStart(2, '0')}`;
    const asOf = detroitDateOffset(spec.daysBeforeAnchor);
    coordination_jobs.push({
      id: jobId,
      idempotency_key: `pickup:p_nora:${asOf}:hist${spec.n}`,
      type: 'PICKUP',
      child_id: 'p_nora',
      status: spec.status,
      version: 1,
      // request_version deliberately omitted (not `1`): upsertRows (src/demo/reset.ts) unions the
      // column set across ALL coordination_jobs fixture rows, including the existing sim rows
      // (fixtures-simulated.ts), which also omit it — explicitly including it here would make
      // upsertRows insert NULL for every row that doesn't name it, violating request_version's
      // own NOT NULL constraint on those other rows. Found live while building this proof.
      as_of: asOf,
      created_at: spec.requestedAt,
      // sandbox also deliberately omitted, same reasoning as request_version above — the sim
      // fixture rows omit it too, and the column default (true) is correct for every row here.
      fixture: true,
      decided_at: spec.declinedAt ?? null,
      failure_reason: spec.failureReason ?? null,
    });

    spec.candidates.forEach((c, ci) => {
      const attemptId = `att_hist_${String(spec.n).padStart(2, '0')}_${ci + 1}`;
      attempts.push({
        id: attemptId,
        job_id: jobId,
        channel: c.attemptChannel,
        at: c.attemptAt,
        candidate_id: c.candidateId,
        destination_mode: 'TEST_RESPONDER',
        // An attempt that got a real human reply closes at that same instant (the real system has
        // no separate "close" step distinct from the response for an answered attempt) — also
        // required by attempts_one_open_per_contact (0021): a caregiver can hold only ONE open
        // (closed_at is null) attempt system-wide at a time, and this dataset reuses the same five
        // caregivers across 20 stories, so any answered attempt MUST close or a later story's
        // attempt for the same person collides with it. Found live while building this proof.
        closed_at: c.closedAt ?? c.respondedAt ?? null,
        closed_reason: c.closedReason ?? null,
        // sandbox omitted — same reasoning as coordination_jobs above.
        fixture: true,
      });

      const responseId = `ce_hist_${String(spec.n).padStart(2, '0')}_${ci + 1}`;
      candidate_evaluations.push({
        id: responseId,
        job_id: jobId,
        request_version: 1,
        candidate_id: c.candidateId,
        reason_code: c.responseKind === 'ACCEPTED' ? 'RECOMMENDED' : c.responseKind === 'DECLINED' ? null : 'PENDING',
        available: c.responseKind === 'ACCEPTED' ? true : c.responseKind === 'DECLINED' ? false : null,
        decline_reason: c.declineReason ?? null,
        accepted_via: c.responseKind ? 'CANDIDATE_JWT' : null,
        responded_at: c.respondedAt ?? null,
        response_kind: c.responseKind ?? null,
      });

      if (c.proposedVoiceNote) {
        // PENDING, not delivered: this is a proposed script this PR drafted to describe what the
        // story needs to say, not a real recording. Bentley has not yet supplied the actual audio,
        // its Muse transcript, its measured duration or its real sha256 — those four columns stay
        // NULL (never a fabricated stand-in, never a placeholder hash) until he does, and
        // voice_note_access (0084) refuses playback for every PENDING row regardless of who asks.
        voice_notes.push({
          id: `vn_hist_${String(spec.n).padStart(2, '0')}_${ci + 1}`,
          response_id: responseId,
          speaker_person_id: c.candidateId,
          status: 'PENDING',
          proposed_script: c.proposedVoiceNote.script,
          transcript: null,
          duration_seconds: null,
          turn_timings: null,
          storage_path: null,
          sha256: null,
        });
      }
    });

    if (spec.confirmedCandidateId && spec.confirmedAt) {
      confirmations.push({
        id: `cf_hist_${String(spec.n).padStart(2, '0')}`,
        job_id: jobId,
        received_at: spec.confirmedAt,
        candidate_id: spec.confirmedCandidateId,
        approved_by: approverOnDetroitDate(asOf),
        over_limit_approved: false,
      });
    }
  }

  return { coordination_jobs, attempts, candidate_evaluations, confirmations, voice_notes };
}
