import { parse } from 'graphql';
import { GraphQLError } from 'graphql';
import { requireCaller, refuseDemoGuideWrite, isParentOf, authorizeChild, householdIdsOfChild, SCOPE, type Ctx } from '../authz';
import { prewarmForPickupRequest, trackRidePrewarm, awaitRidePrewarm, type PrewarmReport } from '../village/ridePrewarm';
import { dbFor, rows } from '../db';

/**
 * Coordination owns the job machinery for pickups, invitations and onboarding.
 *
 * Station 06: the graph now projects what the database already holds — the per-candidate
 * evaluations, the over-limit alternative and the confirmation — and exposes the three
 * mutations Mission Control needs. Every read and write goes through the caller's own JWT
 * (dbFor), so Row Level Security decides visibility; there is no service-role client here.
 */
const typeDefs = parse(`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])

  type Query {
    coordinationJobs(childId: ID): [CoordinationJob!]!
    """
    The STORED paid-ride estimate for one candidate on one job, with the household cap that judges it.
    Parent/guardian of the job's child, or the server-verified demo guide, only. Null when the stored
    evaluation carries no price (drivers / non-paid paths). A hidden or nonexistent job is refused with
    the same generic UNAUTHORIZED — never an empty answer that reveals existence.
    """
    pickupRideEstimate(jobId: ID!, candidateId: ID!): PickupRideEstimate
    attempts(jobId: ID): [Attempt!]!
    informationRequests(childId: ID): [InformationRequest!]!
    confirmations(childId: ID): [Confirmation!]!
    """
    The recorded lifecycle of one job, oldest first. Additive (E3).

    Every entry is derived from a stored timestamp — there is no synthesized or presented time. A job
    the caller cannot see returns an empty list rather than an error, so the response never tells a
    stranger that a job id exists.
    """
    jobTimeline(jobId: ID!): [TimelineEntry!]!

    """
    Metadata only (transcript/duration/turn timings/speaker) — never the audio bytes, which are a
    separate HTTP fetch (GET /api/demo/voice-note/:id, re-checked on every request, no signed URL;
    docs/contracts/demo-history.md §6). voice_notes_read decides visibility; a caller who may not
    see it receives null, identical to a nonexistent id — no existence oracle, same shape as every
    other RLS-governed read in this file.
    """
    voiceNote(id: ID!): VoiceNote

    """
    One Orbit alert. A caller who may not see it receives null — identical to a nonexistent id, so
    the read is not an existence oracle.
    """
    orbitAlert(alertId: ID!): OrbitAlert

    """
    Orbit state for a child. A parent/guardian sees the full view; an audience member sees only their
    own row; everyone else sees an empty status, never an error that would reveal the alert.
    """
    orbitStatus(childId: ID!, alertId: ID): OrbitStatus!

    """
    The expected-check-in signal, parent view only: reports "check-in not recorded" — never
    "missing", never "in danger". Carries the 911 guidance text.
    """
    checkInStatus(childId: ID!): CheckInStatus!

    """
    The controlled descriptor vocabulary — the closed list every Orbit share value must come from.
    Public and versioned: an authenticated read, no oracle concern.
    """
    orbitVocabulary(version: Int): [OrbitVocabularyEntry!]!

    """
    The child's family's recorded places. Parent/guardian only, checked against the child — a place
    from another family is never reachable here, and a stranger gets the same empty list a
    nonexistent child gets.
    """
    orbitPlaces(childId: ID!): [RecordedPlace!]!

    """
    Care facts for a child, each with its source and its verification. RLS decides visibility:
    parent/guardian, a caregiver holding careplan.read, or the guide on sandbox rows.
    """
    careFacts(childId: ID!): [CareFact!]!
  }

  type Mutation {
    requestPickup(childId: ID!, asOf: String, window: String): CoordinationJob!
    acceptPickup(attemptId: ID!, available: Boolean!, declineReason: DeclineReason): CandidateEvaluation!
    approvePickup(
      jobId: ID!
      version: Int!
      decision: ApprovalDecision!
      declineReason: String
      acceptOverLimit: Boolean = false
    ): CoordinationJob!

    """
    Invites (slim), money-adjacent (AGENTS.md §1.6: senior-only, human review required before any
    apply — this mutation is STAGED, never applied live by this PR). Reserves cost against the
    CHILD's per-day budget (0085) atomically — concurrent callers for the same child cannot both
    pass. Parent/guardian of the child only, same generic UNAUTHORIZED as every other money-
    adjacent read here. Never returns another family's data, a model name, a prompt, or a raw
    cost figure — only whether this reservation was allowed and what remains today.

    Cost is decided SERVER-SIDE ONLY — there is no costUsd argument. The per-generation price
    (Muse Image, $0.01/image, Meta's published figure) is a fixed constant inside the 0085 RPC;
    a caller cannot set or influence it.
    """
    reserveInviteBudget(childId: ID!, source: String!, promptHash: String!): InviteBudgetReservation!

    """
    Settles a reservation after the image call resolves. The caller reports FACTS it observed —
    which of the three closed outcomes occurred, and whether this was a cache hit — never a
    price: the actual charged cost is computed server-side from (status, cached), never from an
    argument (0085). SUCCEEDED + cached charges $0.00 (no new provider call was made); SUCCEEDED
    + not cached charges the real reserved amount; UNCERTAIN keeps the reserved amount charged
    (the provider may have billed even though this process got no usable result — never refunded
    by default); FAILED charges $0.00 (a CONFIRMED pre-generation refusal only). Caller must own
    the reservation, and a reservation settles exactly once — replaying or overriding a prior
    outcome is refused.
    """
    settleInviteBudget(generationId: ID!, status: InviteGenerationOutcome!, model: String, outputSha256: String, cached: Boolean!): Boolean!

    """Creates or updates a PENDING_ACTIVATION draft. Parent/guardian only; sends nothing."""
    orbitDraft(
      childId: ID!
      wearColor: String
      wearGarment: String
      hair: String
      carryColor: String
      carryItem: String
      photoId: ID
      """A place id from the child's own family. Not a label: nothing caller-supplied is stored."""
      lastSeenPlaceId: ID
      """When the child was last seen there. Both this and the place are bound by the message hash."""
      lastSeenAt: String
    ): OrbitDraft!

    """The exact notification the village would receive, plus the binding version and hash."""
    orbitPreview(draftId: ID!): OrbitPreview!

    """The parent's explicit confirmation. Refuses a stale version, a changed preview or a changed audience."""
    orbitActivate(draftId: ID!, draftVersion: Int!, messageHash: String!): OrbitAlert!

    """A frozen audience member responds. Appends history; never closes the alert."""
    orbitRespond(alertId: ID!, response: String!): OrbitResponseResult!

    """Parent/guardian only. No response closes the alert by itself. Idempotent under retry."""
    orbitClose(alertId: ID!, outcome: String): OrbitAlert!
  }

  type CareFactSource {
    kind: String!
    ref: String!
  }

  type CareFact {
    id: ID!
    key: String!
    value: String!
    source: CareFactSource!
    verifiedBy: Person
    verifiedAt: String
    """CONFIRMED (verified by a person) or PROVISIONAL (visible, explicitly unverified)."""
    confidence: String!
  }

  type OrbitVocabularyEntry {
    kind: String!
    value: String!
    version: Int!
  }

  type OrbitShare {
    wearColor: String
    wearGarment: String
    hair: String
    carryColor: String
    carryItem: String
    photoId: ID
    """Generated ONLY from controlled vocabulary values."""
    description: String!
  }

  """
  A curated place from the child's own family. A label and a kind — never an address, never free
  text. The only labels that exist are seeded ones, so a caller cannot introduce a place name.
  """
  type RecordedPlace {
    id: ID!
    kind: String!
    label: String!
  }

  type OrbitAudienceMember {
    person: Person!
    notifyOrder: Int!
    """When the SIMULATED notification event was recorded. Not proof of delivery."""
    notifiedAt: String
    outcome: String
    eligible: Boolean!
  }

  type OrbitResponseEntry {
    person: Person!
    respondedAt: String!
    response: String!
  }

  type OrbitResponseCount {
    response: String!
    count: Int!
  }

  type OrbitAlert {
    id: ID!
    status: String!
    child: Child!
    message: String
    share: OrbitShare!
    activatedAt: String
    closedAt: String
    """FOUND_SAFE once a parent closed it with that outcome; null on older closes."""
    closeOutcome: String
    """The exact thank-you the frozen audience received; null until the close."""
    thankyou: String
    """
    Where the child was last seen, from the family's curated places. Visible to a parent/guardian
    and to a member of the FROZEN audience only — the same rule as the message itself.
    """
    lastSeenPlace: RecordedPlace
    lastSeenAt: String
    audience: [OrbitAudienceMember!]!
    responses: [OrbitResponseEntry!]!
    latestResponses: [OrbitResponseEntry!]!
    """Emergency guidance, present on every parent-facing Orbit response."""
    guidance: String!
  }

  type OrbitStatus {
    child: Child!
    alertId: ID
    status: String
    """FOUND_SAFE once closed; null while active, and for a viewer who may not see the alert."""
    closeOutcome: String
    """The thank-you, shown to a recipient after the close."""
    thankyou: String
    audienceCount: Int!
    notifiedCount: Int!
    responseCounts: [OrbitResponseCount!]!
    latestResponses: [OrbitResponseEntry!]!
    guidance: String!
  }

  type CheckInStatus {
    child: Child!
    recorded: Boolean!
    label: String!
    dueAt: String
    """Either "check-in recorded" or "check-in not recorded"."""
    text: String!
    guidance: String!
  }

  type OrbitDraft {
    draftId: ID!
    draftVersion: Int!
    status: String!
    guidance: String!
  }

  type OrbitPreview {
    draftId: ID!
    draftVersion: Int!
    message: String!
    messageHash: String!
    audienceSize: Int!
    guidance: String!
  }

  type OrbitResponseResult {
    alertId: ID!
    responseId: ID!
    guidance: String!
  }

  type Child @key(fields: "id") {
    id: ID!
  }

  type Person @key(fields: "id") {
    id: ID!
  }

  enum CoordinationType {
    PICKUP
    INVITATION
    ONBOARDING
  }

  enum DeclineReason {
    BUSY
    NO_TRANSPORT
    OTHER
  }

  enum ApprovalDecision {
    APPROVED
    DECLINED
  }

  enum AcceptanceEntryPoint {
    WEBHOOK_CALLBACK
    CANDIDATE_JWT
  }

  enum ResponseKind {
    ACCEPTED
    DECLINED
  }

  type CoordinationJob {
    id: ID!
    idempotencyKey: String!
    type: CoordinationType!
    child: Child!
    status: String!
    version: Int!
    candidateEvaluations: [CandidateEvaluation!]!
    overLimitCandidate: Person
    confirmation: Confirmation
  }

  type PickupRideEstimate {
    jobId: ID!
    candidateId: ID!
    estimatedRideCostUsd: Float
    costBasis: String
    distanceMiles: Float
    costCalculatedAt: String
    householdCapUsd: Float
    paidRidePath: Boolean!
  }

  type InviteBudgetReservation {
    allowed: Boolean!
    generationId: ID
    remainingUsd: Float!
  }

  """A closed set, never a free string — the caller reports which of these occurred; the SERVER
  (0085) alone decides the resulting charge. UNCERTAIN means the provider may have billed even
  though this process got no usable result (a network timeout after send, or a local validation
  failure on an otherwise-200 response) — charged conservatively, never refunded by default."""
  enum InviteGenerationOutcome {
    SUCCEEDED
    FAILED
    UNCERTAIN
  }

  type CandidateEvaluation {
    """Null on a response synthesized from a mutation's own return (e.g. acceptPickup's candidate-only
    outcome), which carries no stored row id. Never null for a row read back from storage."""
    id: ID
    candidate: Person!
    reasonCode: String
    available: Boolean
    declineReason: DeclineReason
    acceptedVia: AcceptanceEntryPoint
    estimatedRideCostUsd: Float
    costBasis: String
    distanceMiles: Float
    locationProvenance: String
    costCalculatedAt: String
    """Set only once a real human answered (accept_pickup) — null for a pending/no-reply evaluation."""
    respondedAt: String
    responseKind: ResponseKind
    """The private voice note attached to this response, if any. Same no-oracle null as voiceNote(id)
    itself: a caller who may not see it gets null, identical to there being none."""
    voiceNoteId: ID
  }

  type Attempt {
    id: ID!
    job: CoordinationJob!
    channel: String!
    at: String!
    """The person this attempt was opened for. Null only on a legacy row with no recorded candidate."""
    candidate: Person
    """Simulated vs the one consented real-call exception (frontend-data §1.4)."""
    destinationMode: DestinationMode!
    closedAt: String
    closedReason: String
  }

  enum DestinationMode {
    TEST_RESPONDER
    REAL_CONSENTED
  }

  """One recorded moment in a job's life. detail is the stored code, verbatim."""
  type TimelineEntry {
    at: String!
    kind: String!
    attemptId: ID
    candidate: Person
    detail: String
  }

  """A single turn's coarse timing. Never word-level — nothing in this pipeline measures
  individual word timing, so nothing is invented to fill a finer-grained shape."""
  type TurnTiming {
    speaker: Person!
    startSec: Float!
    endSec: Float!
  }

  """PENDING until the real audio, its Muse transcript, its measured duration and its real sha256
  are all delivered; READY only once they are. A PENDING note is never playable — the HTTP endpoint
  and voice_note_access (0084) refuse it the same way they refuse an unauthorized caller."""
  enum VoiceNoteStatus {
    PENDING
    READY
  }

  """Transcript/duration/speaker metadata for a private voice note. Audio bytes are a separate,
  re-checked-every-request HTTP fetch — never bundled here, never a provider/cost field."""
  type VoiceNote {
    id: ID!
    """The CandidateEvaluation this note was recorded against — the same link CandidateEvaluation.
    voiceNoteId exposes from the other side."""
    responseId: ID!
    status: VoiceNoteStatus!
    speaker: Person!
    """The delivered, ASR-verified transcript. Null while status is PENDING — see proposedScript."""
    transcript: String
    """The authored TTS input text — permanently distinct from transcript (the ASR-verified
    output) for BOTH statuses. Never cleared or superseded once READY: a transcript is never
    replaced by its script, and a script is never overwritten by its transcript."""
    proposedScript: String
    durationSeconds: Float
    turnTimings: [TurnTiming!]
    createdAt: String!
  }

  type InformationRequest {
    id: ID!
    job: CoordinationJob!
    question: String!
    status: String!
  }

  type Confirmation {
    id: ID!
    job: CoordinationJob!
    receivedAt: String!
    candidate: Person!
    approvedBy: Person!
    overLimitApproved: Boolean!
  }
`);

type JobRow = {
  id: string;
  idempotency_key: string;
  type: string;
  child_id: string;
  status: string;
  version: number;
  over_limit_candidate_id?: string | null;
};

/** One recorded moment in a job's life. Every field comes from a stored column. */
type TimelineEntry = {
  at: string;
  kind: string;
  attemptId: string | null;
  candidate: { id: string } | null;
  detail: string | null;
};

const jobFromRow = (j: JobRow) => ({
  id: String(j.id),
  idempotencyKey: String(j.idempotency_key),
  type: String(j.type),
  child: { id: String(j.child_id) },
  status: String(j.status),
  version: Number(j.version),
  _overLimitCandidateId: j.over_limit_candidate_id ?? null,
});

const evalFromRow = (e: Record<string, unknown>) => ({
  // Absent on the hand-built object acceptPickup returns (no stored row id to give) — null there,
  // same convention as every other field below.
  id: e.id == null ? null : String(e.id),
  candidate: { id: String(e.candidate_id) },
  reasonCode: e.reason_code == null ? null : String(e.reason_code),
  available: e.available == null ? null : Boolean(e.available),
  declineReason: e.decline_reason == null ? null : String(e.decline_reason),
  acceptedVia: e.accepted_via == null ? null : String(e.accepted_via),
  estimatedRideCostUsd: e.estimated_ride_cost_usd == null ? null : Number(e.estimated_ride_cost_usd),
  costBasis: e.cost_basis == null ? null : String(e.cost_basis),
  distanceMiles: e.distance_miles == null ? null : Number(e.distance_miles),
  locationProvenance: e.location_provenance == null ? null : String(e.location_provenance),
  costCalculatedAt: e.cost_calculated_at == null ? null : String(e.cost_calculated_at),
  respondedAt: e.responded_at == null ? null : String(e.responded_at),
  responseKind: e.response_kind == null ? null : String(e.response_kind),
});

const confFromRow = (c: Record<string, unknown>) => ({
  id: String(c.id),
  job: { id: String(c.job_id) },
  receivedAt: String(c.received_at),
  candidate: { id: String(c.candidate_id) },
  approvedBy: { id: String(c.approved_by) },
  overLimitApproved: Boolean(c.over_limit_approved),
});

/** Map a Postgres RAISE code to a client-visible GraphQL error. Never leak SQL detail. */
function rpcError(e: unknown): never {
  const message = e instanceof Error ? e.message : String(e);
  const known = [
    'UNAUTHENTICATED', 'UNAUTHORIZED', 'JOB_NOT_FOUND', 'JOB_TERMINAL', 'NOT_AWAITING_APPROVAL',
    'STALE_VERSION', 'STALE_REQUEST_VERSION', 'NO_RECOMMENDATION', 'OVER_LIMIT_NOT_ACCEPTED',
    'BAD_DECISION', 'ATTEMPT_NOT_FOUND', 'EVENT_ID_REQUIRED', 'EVENT_ID_CONFLICT', 'BADSTATE',
  ];
  const code = known.find((k) => message.includes(k)) ?? 'RPC_FAILED';
  throw new GraphQLError(code, { extensions: { code } });
}

async function jobById(ctx: Ctx, id: string) {
  const data = await rows(
    dbFor(ctx)
      .from('coordination_jobs')
      .select('id,idempotency_key,type,child_id,status,version,over_limit_candidate_id')
      .eq('id', id),
  );
  if (!data.length) throw new GraphQLError('JOB_NOT_FOUND', { extensions: { code: 'JOB_NOT_FOUND' } });
  return jobFromRow(data[0] as JobRow);
}

/**
 * Emergency guidance, included on every parent-facing Orbit response. Orbit notifies an approved
 * village; it is not an emergency service.
 */
/**
 * Columns of orbit_alerts a caller may read directly. The descriptors, the stored message, the photo
 * reference and the last-seen place/time are deliberately NOT here: 0055 revoked table-level SELECT
 * and granted only these, so reading a sensitive column fails at the database rather than depending
 * on this file. Those fields come from orbit_share_for(), which gates them (parent/guardian, or a
 * frozen audience member while ACTIVE).
 *
 * The `as '*'` at the call sites is a cast on the SELECTOR STRING only, not on the data: the generated
 * database types predate 0053-0055, so a column list is not a known literal to them. The database
 * still enforces the column grant, which is the only thing that matters here.
 */
const ORBIT_SAFE_COLUMNS =
  'id,child_id,created_by,created_at,status,draft_version,activated_by,activated_at,' +
  'closed_by,closed_at,close_outcome,job_id,message_hash,sandbox,fixture';

const ORBIT_GUIDANCE =
  'If a child is missing or in danger, call 911 immediately. Orbit notifies your approved village; it does not replace emergency services.';

function orbitResponseEntry(r: Record<string, unknown>) {
  return {
    person: { id: String(r.person_id) },
    respondedAt: String(r.responded_at),
    response: String(r.response),
  };
}

/**
 * One payload for every alert read. RLS decides which audience rows and responses are visible, so a
 * parent sees everything and an audience member sees only their own row — the mapping never widens it.
 */
async function orbitAlertPayload(ctx: Ctx, a: Record<string, unknown>) {
  requireCaller(ctx);
  const parent = await isParentOf(ctx, String(a.child_id));
  const audience = await rows(
    dbFor(ctx)
      .from('orbit_audience_members')
      .select('person_id,notify_order,notified_at,notification_outcome,eligible,thankyou_at,thankyou_outcome')
      .eq('orbit_alert_id', a.id)
      .order('notify_order'),
  );
  const responses = await rows(
    dbFor(ctx).from('orbit_responses').select('*').eq('orbit_alert_id', a.id).order('responded_at'),
  );
  const latest = new Map<string, Record<string, unknown>>();
  for (const r of responses) latest.set(String(r.person_id), r);

  // Descriptors, the stored message, the photo reference and the place/time come from ONE accessor
  // that answers a parent/guardian always and a frozen audience member only while the alert is
  // ACTIVE. After a close it returns no row, so these fields are null for a recipient without the
  // resolver having to remember a rule — the boundary is the database.
  const shareRes = await dbFor(ctx).rpc('orbit_share_for', { p_alert: String(a.id) });
  const shareRow = Array.isArray(shareRes.data)
    ? (shareRes.data[0] as Record<string, unknown> | undefined)
    : undefined;
  const thankyouRes = await dbFor(ctx).rpc('orbit_thankyou_for', { p_alert: String(a.id) });
  const thankyou = typeof thankyouRes.data === 'string' ? thankyouRes.data : null;

  return {
    id: String(a.id),
    status: String(a.status),
    child: { id: String(a.child_id) },
    message: shareRow?.minimal_message == null ? null : String(shareRow.minimal_message),
    share: {
      wearColor: shareRow?.wear_color ?? null,
      wearGarment: shareRow?.wear_garment ?? null,
      hair: shareRow?.hair_desc ?? null,
      carryColor: shareRow?.carry_color ?? null,
      carryItem: shareRow?.carry_item ?? null,
      photoId: shareRow?.photo_id ?? null,
      description: shareRow?.minimal_message == null ? '' : String(shareRow.minimal_message),
    },
    activatedAt: a.activated_at ?? null,
    closedAt: a.closed_at ?? null,
    closeOutcome: a.close_outcome ?? null,
    thankyou,
    lastSeenPlace: shareRow?.place_label == null
      ? null
      : { id: String(shareRow.last_seen_place_id), kind: String(shareRow.place_kind), label: String(shareRow.place_label) },
    lastSeenAt: shareRow?.last_seen_at ?? null,
    audience: audience.map((m) => ({
      person: { id: String(m.person_id) },
      notifyOrder: Number(m.notify_order),
      notifiedAt: m.notified_at ?? null,
      outcome: m.notification_outcome ?? null,
      eligible: Boolean(m.eligible),
    })),
    responses: responses.map(orbitResponseEntry),
    latestResponses: [...latest.values()].map(orbitResponseEntry),
    guidance: parent ? ORBIT_GUIDANCE : '',
  };
}

const resolvers = {
  Query: {
    // RLS decides which rows exist for this caller, so a non-parent gets an empty list rather
    // than an error, and a stranger cannot enumerate jobs, names or history.

    // The stored paid-ride estimate, and nothing else. Cost, basis, distance and the household cap are
    // parent/guardian reads (or the server-verified demo guide) — schedule.read, address.read, village
    // visibility and a candidate's own evaluation read are NOT sufficient. A hidden job and a
    // nonexistent job get the same generic refusal, so this is not an existence oracle.
    pickupRideEstimate: async (
      _: unknown,
      args: { jobId: string; candidateId: string },
      ctx: Ctx,
    ) => {
      requireCaller(ctx);
      const jobRows = await rows(
        dbFor(ctx).from('coordination_jobs').select('id,child_id').eq('id', args.jobId),
      );
      if (!jobRows.length) throw new GraphQLError('UNAUTHORIZED', { extensions: { code: 'UNAUTHORIZED' } });
      const childId = String(jobRows[0].child_id);

      const parent = await isParentOf(ctx, childId);
      if (!parent && ctx.demoGuide !== true) {
        throw new GraphQLError('UNAUTHORIZED', { extensions: { code: 'UNAUTHORIZED' } });
      }

      const evalRows = await rows(
        dbFor(ctx)
          .from('candidate_evaluations')
          .select('candidate_id,reason_code,estimated_ride_cost_usd,cost_basis,distance_miles,cost_calculated_at')
          .eq('job_id', args.jobId)
          .eq('candidate_id', args.candidateId),
      );
      if (!evalRows.length) return null; // authorized job, no stored row for this candidate
      const e = evalRows[0];
      // Drivers and non-paid paths carry no price; a stored 0 stays visible because 0 is not null.
      if (e.estimated_ride_cost_usd == null) return null;

      const households = await householdIdsOfChild(ctx, childId);
      let cap: number | null = null;
      if (households.length) {
        const policy = await rows(
          dbFor(ctx)
            .from('household_policies')
            .select('value')
            .eq('household_id', households[0])
            .eq('rule', 'ride_cost_cap_usd'),
        );
        if (policy.length && policy[0].value != null) cap = Number(policy[0].value);
      }

      return {
        jobId: args.jobId,
        candidateId: String(e.candidate_id),
        estimatedRideCostUsd: Number(e.estimated_ride_cost_usd),
        costBasis: e.cost_basis == null ? null : String(e.cost_basis),
        distanceMiles: e.distance_miles == null ? null : Number(e.distance_miles),
        costCalculatedAt: e.cost_calculated_at == null ? null : String(e.cost_calculated_at),
        householdCapUsd: cap,
        paidRidePath: true,
      };
    },
    orbitAlert: async (_: unknown, { alertId }: { alertId: string }, ctx: Ctx) => {
      requireCaller(ctx);
      const found = await rows(dbFor(ctx).from('orbit_alerts').select(ORBIT_SAFE_COLUMNS as '*').eq('id', alertId));
      if (!found.length) return null; // no existence oracle
      return orbitAlertPayload(ctx, found[0]);
    },

    orbitStatus: async (
      _: unknown,
      { childId, alertId }: { childId: string; alertId?: string },
      ctx: Ctx,
    ) => {
      requireCaller(ctx);
      const parent = await isParentOf(ctx, childId);
      const found = alertId
        ? await rows(dbFor(ctx).from('orbit_alerts').select(ORBIT_SAFE_COLUMNS as '*').eq('id', alertId))
        : await rows(
            dbFor(ctx)
              .from('orbit_alerts')
              .select(ORBIT_SAFE_COLUMNS as '*')
              .eq('child_id', childId)
              .order('created_at', { ascending: false })
              .limit(1),
          );
      const empty = {
        child: { id: childId },
        alertId: null,
        status: null,
        closeOutcome: null,
        thankyou: null,
        audienceCount: 0,
        notifiedCount: 0,
        responseCounts: [],
        latestResponses: [],
        guidance: parent ? ORBIT_GUIDANCE : '',
      };
      // Nothing visible: the same answer a nonexistent child gets. Parents may legitimately have no
      // alerts yet, so their empty status still carries the emergency guidance.
      if (!found.length) return empty;

      const a = found[0];
      const audience = await rows(
        dbFor(ctx)
          .from('orbit_audience_members')
          .select('person_id,notify_order,notified_at,notification_outcome,eligible')
          .eq('orbit_alert_id', a.id)
          .order('notify_order'),
      );
      const responses = await rows(
        dbFor(ctx).from('orbit_responses').select('*').eq('orbit_alert_id', a.id).order('responded_at'),
      );
      const counts = new Map<string, number>();
      for (const r of responses) counts.set(String(r.response), (counts.get(String(r.response)) ?? 0) + 1);
      const latest = new Map<string, Record<string, unknown>>();
      for (const r of responses) latest.set(String(r.person_id), r);

      const thankyouRes = await dbFor(ctx).rpc('orbit_thankyou_for', { p_alert: String(a.id) });
      const thankyou = typeof thankyouRes.data === 'string' ? thankyouRes.data : null;

      return {
        child: { id: childId },
        alertId: String(a.id),
        status: String(a.status),
        closeOutcome: a.close_outcome ?? null,
        thankyou,
        audienceCount: audience.length,
        notifiedCount: audience.filter((m) => m.notified_at !== null).length,
        responseCounts: [...counts.entries()].map(([response, count]) => ({ response, count })),
        latestResponses: [...latest.values()].map(orbitResponseEntry),
        guidance: parent ? ORBIT_GUIDANCE : '',
      };
    },

    checkInStatus: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      requireCaller(ctx);
      // Parent view only. A stranger (or a nonexistent child) gets the same denial.
      const level = await authorizeChild(ctx, childId, SCOPE.schedule);
      if (level !== 'parent') {
        throw new GraphQLError('UNAUTHORIZED', { extensions: { code: 'UNAUTHORIZED' } });
      }
      const { data, error } = await dbFor(ctx).rpc('checkin_status_for', {
        p_child: childId,
        p_day: ctx.today,
      });
      if (error) throw error;
      const row = (data as Array<{ recorded: boolean; label: string; due_at: string | null }> | null)?.[0];
      const recorded = Boolean(row?.recorded);
      return {
        child: { id: childId },
        recorded,
        label: String(row?.label ?? 'check-in'),
        dueAt: row?.due_at ? String(row.due_at) : null,
        text: recorded ? 'check-in recorded' : 'check-in not recorded',
        guidance: ORBIT_GUIDANCE,
      };
    },

    careFacts: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      requireCaller(ctx);
      const list = await rows(
        dbFor(ctx).from('care_facts').select('*').eq('child_id', childId).order('key'),
      );
      return list.map((r) => ({
        id: String(r.id),
        key: String(r.key),
        value: String(r.value),
        source: { kind: String(r.source_kind), ref: String(r.source_ref) },
        verifiedBy: r.verified_by ? { id: String(r.verified_by) } : null,
        verifiedAt: r.verified_at ?? null,
        confidence: String(r.confidence),
      }));
    },

    orbitPlaces: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      requireCaller(ctx);
      // Child-specific authorization first: a parent/guardian of THIS child, or nothing. RLS then
      // narrows the rows to her family, and the household filter narrows them again to the
      // households this child actually belongs to.
      const parent = await isParentOf(ctx, childId);
      if (!parent) return [];
      const households = await householdIdsOfChild(ctx, childId);
      if (!households.length) return [];
      const list = await rows(
        dbFor(ctx)
          .from('recorded_places')
          .select('id,kind,label,household_id')
          .in('household_id', households)
          .order('label'),
      );
      return list.map((r) => ({ id: String(r.id), kind: String(r.kind), label: String(r.label) }));
    },

    orbitVocabulary: async (_: unknown, { version }: { version?: number }, ctx: Ctx) => {
      requireCaller(ctx);
      let query = dbFor(ctx)
        .from('orbit_vocabulary')
        .select('kind,value,version')
        .order('kind')
        .order('value');
      if (typeof version === 'number') query = query.eq('version', version);
      const list = await rows(query);
      return list.map((r) => ({
        kind: String(r.kind),
        value: String(r.value),
        version: Number(r.version),
      }));
    },
    coordinationJobs: async (_: unknown, { childId }: { childId?: string }, ctx: Ctx) => {
      requireCaller(ctx);
      const q = dbFor(ctx)
        .from('coordination_jobs')
        .select('id,idempotency_key,type,child_id,status,version,over_limit_candidate_id');
      const data = await rows(childId ? q.eq('child_id', childId) : q);
      return data.map((j) => jobFromRow(j as JobRow));
    },
    attempts: async (_: unknown, { jobId }: { jobId?: string }, ctx: Ctx) => {
      requireCaller(ctx);
      const q = dbFor(ctx)
        .from('attempts')
        .select('id,job_id,channel,at,candidate_id,destination_mode,closed_at,closed_reason');
      const data = await rows(jobId ? q.eq('job_id', jobId) : q);
      return data.map((a) => ({
        id: String(a.id),
        job: { id: String(a.job_id) },
        channel: String(a.channel),
        at: String(a.at),
        _candidateId: a.candidate_id == null ? null : String(a.candidate_id),
        _destinationMode: String(a.destination_mode ?? 'TEST_RESPONDER'),
        _closedAt: a.closed_at == null ? null : String(a.closed_at),
        _closedReason: a.closed_reason == null ? null : String(a.closed_reason),
      }));
    },
    informationRequests: async (
      _: unknown,
      { childId }: { childId?: string },
      ctx: Ctx,
    ) => {
      requireCaller(ctx);
      const q = dbFor(ctx).from('information_requests').select('id,job_id,question,status');
      const data = await rows(q);
      const jobs = await rows(dbFor(ctx).from('coordination_jobs').select('id,child_id'));
      const allowed = new Set(
        jobs
          .filter((j) => !childId || String(j.child_id) === childId)
          .map((j) => String(j.id)),
      );
      return data
        .filter((r) => allowed.has(String(r.job_id)))
        .map((r) => ({
          id: String(r.id),
          job: { id: String(r.job_id) },
          question: String(r.question),
          status: String(r.status),
        }));
    },
    confirmations: async (
      _: unknown,
      { childId }: { childId?: string },
      ctx: Ctx,
    ) => {
      requireCaller(ctx);
      const data = await rows(
        dbFor(ctx)
          .from('confirmations')
          .select('id,job_id,received_at,candidate_id,approved_by,over_limit_approved'),
      );
      const jobs = await rows(dbFor(ctx).from('coordination_jobs').select('id,child_id'));
      const allowed = new Set(
        jobs
          .filter((j) => !childId || String(j.child_id) === childId)
          .map((j) => String(j.id)),
      );
      return data
        .filter((c) => allowed.has(String(c.job_id)))
        .map((c) => confFromRow(c as Record<string, unknown>));
    },

    jobTimeline: async (_: unknown, { jobId }: { jobId: string }, ctx: Ctx) => {
      requireCaller(ctx);
      // Visibility first: an invisible job is indistinguishable from a missing one, so this returns
      // an empty list instead of an error that would confirm the id exists.
      const jobRows = await rows(
        dbFor(ctx).from('coordination_jobs').select('id,created_at,decided_at,failure_reason').eq('id', jobId),
      );
      if (!jobRows.length) return [];
      const job = jobRows[0];

      const entries: TimelineEntry[] = [];
      const push = (at: unknown, kind: string, extra: Partial<TimelineEntry> = {}) => {
        if (at == null) return;
        entries.push({ at: String(at), kind, attemptId: null, candidate: null, detail: null, ...extra });
      };

      push(job.created_at, 'JOB_CREATED');
      // A parent's explicit non-approval, as its own timestamped event — 0084. Only present when
      // approve_pickup's DECLINED branch actually ran; distinct from a system-closed attempt.
      push(job.decided_at, 'JOB_DECLINED', { detail: job.failure_reason == null ? null : String(job.failure_reason) });

      const attemptRows = await rows(
        dbFor(ctx)
          .from('attempts')
          .select('id,channel,at,candidate_id,closed_at,closed_reason')
          .eq('job_id', jobId),
      );
      for (const a of attemptRows) {
        const candidateId = a.candidate_id == null ? null : String(a.candidate_id);
        push(a.at, 'ATTEMPT_OPENED', {
          attemptId: String(a.id),
          candidate: candidateId ? { id: candidateId } : null,
          detail: String(a.channel),
        });
        if (a.closed_at != null) {
          push(a.closed_at, 'ATTEMPT_CLOSED', {
            attemptId: String(a.id),
            candidate: candidateId ? { id: candidateId } : null,
            detail: a.closed_reason == null ? null : String(a.closed_reason),
          });
        }
      }

      // Only an evaluation with a recorded cost timestamp has a time to show.
      const evalRows = await rows(
        dbFor(ctx)
          .from('candidate_evaluations')
          .select('candidate_id,cost_calculated_at,cost_basis,responded_at,response_kind')
          .eq('job_id', jobId),
      );
      for (const e of evalRows) {
        // A real human response, distinct from an attempt merely closing (TIMEOUT/NO_ANSWER never
        // produce this — responded_at is null for both, by construction, not by this check).
        if (e.responded_at != null) {
          push(e.responded_at, 'RESPONSE_RECORDED', {
            candidate: { id: String(e.candidate_id) },
            detail: e.response_kind == null ? null : String(e.response_kind),
          });
        }
        if (e.cost_calculated_at == null) continue;
        push(e.cost_calculated_at, 'COST_CALCULATED', {
          candidate: { id: String(e.candidate_id) },
          detail: e.cost_basis == null ? null : String(e.cost_basis),
        });
      }

      const confRows = await rows(
        dbFor(ctx)
          .from('confirmations')
          .select('received_at,candidate_id,approved_by')
          .eq('job_id', jobId),
      );
      for (const c of confRows) {
        push(c.received_at, 'CONFIRMATION', {
          candidate: { id: String(c.candidate_id) },
          detail: String(c.approved_by),
        });
      }

      return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    },

    voiceNote: async (_: unknown, { id }: { id: string }, ctx: Ctx) => {
      requireCaller(ctx);
      // RLS (voice_notes_read, 0084) is the entire visibility rule — no code-level check here,
      // same posture as fridgeNotes/goals. Zero rows means "no access or doesn't exist," never
      // distinguished — no existence oracle.
      const data = await rows(
        dbFor(ctx)
          .from('voice_notes')
          .select('id,response_id,speaker_person_id,status,proposed_script,transcript,duration_seconds,turn_timings,created_at')
          .eq('id', id),
      );
      const row = data[0];
      if (!row) return null;
      return {
        id: String(row.id),
        responseId: String(row.response_id),
        status: String(row.status),
        speaker: { id: String(row.speaker_person_id) },
        // Delivered and proposed never collapse into one field: a PENDING row has transcript
        // null (only proposedScript filled); a READY row has both — proposedScript is never
        // cleared by delivery.
        transcript: row.transcript == null ? null : String(row.transcript),
        proposedScript: row.proposed_script == null ? null : String(row.proposed_script),
        durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
        turnTimings: row.turn_timings == null ? null : row.turn_timings,
        createdAt: String(row.created_at),
      };
    },
  },

  Mutation: {
    orbitDraft: async (
      _: unknown,
      args: {
        childId: string;
        wearColor?: string;
        wearGarment?: string;
        hair?: string;
        carryColor?: string;
        carryItem?: string;
        photoId?: string;
        lastSeenPlaceId?: string;
        lastSeenAt?: string;
      },
      ctx: Ctx,
    ) => {
      refuseDemoGuideWrite(ctx);
      const { data, error } = await dbFor(ctx).rpc('draft_orbit_share', {
        p_child: args.childId,
        p_wear_color: args.wearColor ?? null,
        p_wear_garment: args.wearGarment ?? null,
        p_hair: args.hair ?? null,
        p_carry_color: args.carryColor ?? null,
        p_carry_item: args.carryItem ?? null,
        p_photo: args.photoId ?? null,
        p_last_seen_place: args.lastSeenPlaceId ?? null,
        p_last_seen_at: args.lastSeenAt ?? null,
      });
      if (error) throw error;
      const a = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
      return {
        draftId: String(a.id),
        draftVersion: Number(a.draft_version),
        status: String(a.status),
        guidance: ORBIT_GUIDANCE,
      };
    },

    orbitPreview: async (_: unknown, { draftId }: { draftId: string }, ctx: Ctx) => {
      refuseDemoGuideWrite(ctx);
      const { data, error } = await dbFor(ctx).rpc('preview_orbit_share', { p_draft: draftId });
      if (error) throw error;
      const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
      return {
        draftId: String(r.alert_id),
        draftVersion: Number(r.draft_version),
        message: String(r.message),
        messageHash: String(r.message_hash),
        audienceSize: Number(r.audience_size),
        guidance: ORBIT_GUIDANCE,
      };
    },

    orbitActivate: async (
      _: unknown,
      { draftId, draftVersion, messageHash }: { draftId: string; draftVersion: number; messageHash: string },
      ctx: Ctx,
    ) => {
      refuseDemoGuideWrite(ctx);
      const { data, error } = await dbFor(ctx).rpc('activate_orbit_alert', {
        p_draft: draftId,
        p_version: draftVersion,
        p_hash: messageHash,
      });
      if (error) throw error;
      const alertId = String(data);
      const found = await rows(dbFor(ctx).from('orbit_alerts').select(ORBIT_SAFE_COLUMNS as '*').eq('id', alertId));
      if (!found.length) throw new GraphQLError('ORBIT_NOT_FOUND', { extensions: { code: 'ORBIT_NOT_FOUND' } });
      return orbitAlertPayload(ctx, found[0]);
    },

    orbitRespond: async (
      _: unknown,
      { alertId, response }: { alertId: string; response: string },
      ctx: Ctx,
    ) => {
      refuseDemoGuideWrite(ctx);
      const { data, error } = await dbFor(ctx).rpc('respond_to_orbit_alert', {
        p_alert: alertId,
        p_response: response,
      });
      if (error) throw error;
      return { alertId, responseId: String(data), guidance: ORBIT_GUIDANCE };
    },

    orbitClose: async (_: unknown, { alertId, outcome }: { alertId: string; outcome?: string }, ctx: Ctx) => {
      refuseDemoGuideWrite(ctx);
      const { error } = await dbFor(ctx).rpc('close_orbit_alert', {
        p_alert: alertId,
        p_outcome: outcome ?? 'FOUND_SAFE',
      });
      if (error) throw error;
      const found = await rows(dbFor(ctx).from('orbit_alerts').select(ORBIT_SAFE_COLUMNS as '*').eq('id', alertId));
      if (!found.length) throw new GraphQLError('ORBIT_NOT_FOUND', { extensions: { code: 'ORBIT_NOT_FOUND' } });
      return orbitAlertPayload(ctx, found[0]);
    },

    requestPickup: async (
      _: unknown,
      { childId, asOf, window }: { childId: string; asOf?: string; window?: string },
      ctx: Ctx,
    ) => {
      // A guide is a read-only view of sandbox records: refuse before anything else happens.
      refuseDemoGuideWrite(ctx);
      requireCaller(ctx);
      // The window is part of the idempotency key; it defaults to the afternoon window.
      const { data, error } = await dbFor(ctx).rpc('request_pickup', {
        p_child: childId,
        p_as_of: asOf ?? null,
        p_window: window ?? 'afternoon',
      });
      if (error) rpcError(error);
      const jobId = String(data);

      // Pre-step for the initial paid-ride evaluation.
      //
      // The promise is TRACKED, not merely fired: every path that can trigger ranking awaits it (or its
      // bounded fallback) first, so ranking cannot run against a half-warmed store. It stays detached
      // from THIS response — a slow provider must not delay the parent — but not from the ranking.
      trackRidePrewarm(
        jobId,
        prewarmForPickupRequest(ctx, childId).catch((): PrewarmReport => ({
          authorized: false, considered: 0, cached: 0, measured: 0, rejected: 0, failed: 0, fallback: 'not-run',
        })),
      );

      return jobById(ctx, jobId);
    },

    acceptPickup: async (
      _: unknown,
      { attemptId, available, declineReason }: { attemptId: string; available: boolean; declineReason?: string | null },
      ctx: Ctx,
    ) => {
      refuseDemoGuideWrite(ctx);
      const callerId = requireCaller(ctx);
      // The contract requires the job's requestVersion. Reading the job through the caller's own RLS
      // worked for parents and failed for the candidate it belongs to: `coordination_jobs` is
      // parent-only. `candidate_attempt_context` (0068) returns the pair ONLY when the attempt is
      // hers, so a foreign or nonexistent attempt yields one generic refusal — no existence oracle.
      const context = await rows(
        dbFor(ctx).rpc('candidate_attempt_context', { p_attempt: attemptId }),
      );
      if (!context.length) {
        throw new GraphQLError('ATTEMPT_NOT_FOUND', { extensions: { code: 'ATTEMPT_NOT_FOUND' } });
      }
      const jobId = String(context[0].job_id);
      const requestVersion = Number(context[0].request_version);

      // Ranking must not begin before the pre-step has settled — or hit its bounded fallback. Awaiting
      // here is what makes the order real; launching the warm-up first while ranking proceeds is a race.
      // Bounded by the gate's own timeout, so this can add latency but never an unbounded wait.
      await awaitRidePrewarm(jobId);

      const { error } = await dbFor(ctx).rpc('accept_pickup', {
        p_attempt: attemptId,
        p_available: available,
        p_decline: declineReason ?? null,
        p_entry: 'CANDIDATE_JWT',
        p_request_version: requestVersion,
      });
      if (error) rpcError(error);

      // Status only. Cost, basis, distance and provenance are parent/guardian reads under the agreed
      // #87 contract, so a candidate accepting her own attempt is given her own outcome and nothing
      // about money — `evalFromRow` fills those fields with null from the absent keys.
      const outcome = await rows(
        dbFor(ctx).rpc('candidate_attempt_outcome', { p_attempt: attemptId }),
      );
      if (!outcome.length) throw new GraphQLError('NOT_FOUND', { extensions: { code: 'NOT_FOUND' } });
      return evalFromRow({
        candidate_id: callerId,
        reason_code: outcome[0].reason_code,
        available: outcome[0].available,
        decline_reason: outcome[0].decline_reason,
        accepted_via: outcome[0].accepted_via,
      });
    },

    approvePickup: async (
      _: unknown,
      args: { jobId: string; version: number; decision: string; declineReason?: string | null; acceptOverLimit?: boolean },
      ctx: Ctx,
    ) => {
      refuseDemoGuideWrite(ctx);
      requireCaller(ctx);
      const j = await rows(
        dbFor(ctx).from('coordination_jobs').select('id,request_version').eq('id', args.jobId),
      );
      if (!j.length) throw new GraphQLError('JOB_NOT_FOUND', { extensions: { code: 'JOB_NOT_FOUND' } });

      const { error } = await dbFor(ctx).rpc('approve_pickup', {
        p_job: args.jobId,
        p_version: args.version,
        p_request_version: Number(j[0].request_version),
        p_decision: args.decision,
        p_reason: args.declineReason ?? null,
        p_accept_over_limit: args.acceptOverLimit === true,
      });
      if (error) rpcError(error);
      return jobById(ctx, args.jobId);
    },

    // No costUsd argument: the per-generation price is a fixed constant inside the 0085 RPC
    // itself — a caller cannot set or influence it. See the schema doc comment above.
    reserveInviteBudget: async (
      _: unknown,
      args: { childId: string; source: string; promptHash: string },
      ctx: Ctx,
    ) => {
      refuseDemoGuideWrite(ctx);
      requireCaller(ctx);
      const { data, error } = await dbFor(ctx).rpc('invite_budget_reserve', {
        p_child: args.childId,
        p_source: args.source,
        p_prompt_hash: args.promptHash,
      });
      if (error) rpcError(error);
      const row = (Array.isArray(data) ? data[0] : data) as
        | { allowed: boolean; generation_id: string | null; remaining_usd: number }
        | undefined;
      if (!row) throw new GraphQLError('RPC_FAILED', { extensions: { code: 'RPC_FAILED' } });
      return { allowed: row.allowed, generationId: row.generation_id, remainingUsd: Number(row.remaining_usd) };
    },

    // `status` is the InviteGenerationOutcome enum (closed set), and `cached` is a FACT the
    // caller observed — the RPC itself computes the actual charged cost_usd from those two
    // inputs; nothing here or in 0085 accepts a price from the caller.
    settleInviteBudget: async (
      _: unknown,
      args: { generationId: string; status: string; model?: string | null; outputSha256?: string | null; cached: boolean },
      ctx: Ctx,
    ) => {
      refuseDemoGuideWrite(ctx);
      requireCaller(ctx);
      const { data, error } = await dbFor(ctx).rpc('invite_budget_settle', {
        p_generation: args.generationId,
        p_status: args.status,
        p_model: args.model ?? null,
        p_output_sha256: args.outputSha256 ?? null,
        p_cached: args.cached,
      });
      if (error) rpcError(error);
      return Boolean(data);
    },
  },

  Attempt: {
    /**
     * The attempt's job, loaded through the caller's own RLS. The row mapper used to return a
     * stub `{ id }`, which is enough for `job { id }` but made any richer selection
     * (`job { status version }`) fail with a non-null violation. Rosina's Attempts tool asks for
     * exactly that, so the stub is replaced by a real, authorized read.
     */
    job: async (a: { job?: { id: string }; jobId?: string }, _a: unknown, ctx: Ctx) => {
      requireCaller(ctx);
      const jobId = a.job?.id ?? a.jobId;
      if (!jobId) throw new GraphQLError('JOB_NOT_FOUND', { extensions: { code: 'JOB_NOT_FOUND' } });
      return jobById(ctx, jobId);
    },
    candidate: (a: { _candidateId?: string | null }) => (a._candidateId ? { id: a._candidateId } : null),
    destinationMode: (a: { _destinationMode?: string }) => a._destinationMode ?? 'TEST_RESPONDER',
    closedAt: (a: { _closedAt?: string | null }) => a._closedAt ?? null,
    closedReason: (a: { _closedReason?: string | null }) => a._closedReason ?? null,
  },

  CoordinationJob: {
    child: (j: { child: { id: string }; childId?: string }) => j.child ?? { id: j.childId },

    candidateEvaluations: async (j: { id: string }, _a: unknown, ctx: Ctx) => {
      requireCaller(ctx);
      const data = await rows(
        dbFor(ctx)
          .from('candidate_evaluations')
          .select('id,candidate_id,reason_code,available,decline_reason,accepted_via,estimated_ride_cost_usd,cost_basis,distance_miles,location_provenance,cost_calculated_at,responded_at,response_kind')
          .eq('job_id', j.id),
      );
      return data.map((e) => evalFromRow(e as Record<string, unknown>));
    },

    // A flagged alternative, never an ordinary recommendation: the candidate keeps OVER_POLICY.
    overLimitCandidate: (j: { _overLimitCandidateId?: string | null }) =>
      j._overLimitCandidateId ? { id: String(j._overLimitCandidateId) } : null,

    confirmation: async (j: { id: string }, _a: unknown, ctx: Ctx) => {
      requireCaller(ctx);
      const data = await rows(
        dbFor(ctx)
          .from('confirmations')
          .select('id,job_id,received_at,candidate_id,approved_by,over_limit_approved')
          .eq('job_id', j.id),
      );
      return data.length ? confFromRow(data[0] as Record<string, unknown>) : null;
    },
  },

  Confirmation: {
    job: (c: { job: { id: string } }) => c.job,
  },

  CandidateEvaluation: {
    // A lazy field resolver, not a join baked into evalFromRow: most callers never ask for this,
    // and it needs its own RLS-scoped read (voice_notes_read, 0084) to decide visibility. No stored
    // row id (acceptPickup's hand-built outcome) means no note to look up — null, not a query.
    voiceNoteId: async (ce: { id?: string | null }, _a: unknown, ctx: Ctx) => {
      if (!ce.id) return null;
      requireCaller(ctx);
      const data = await rows(
        dbFor(ctx).from('voice_notes').select('id').eq('response_id', ce.id),
      );
      return data.length ? String(data[0].id) : null;
    },
  },
};

export default { typeDefs, resolvers };
