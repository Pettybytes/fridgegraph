import { parse } from 'graphql';
import { GraphQLError } from 'graphql';
import { requireCaller, type Ctx } from '../authz';
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
    attempts(jobId: ID): [Attempt!]!
    informationRequests(childId: ID): [InformationRequest!]!
    confirmations(childId: ID): [Confirmation!]!
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

  type CandidateEvaluation {
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
  }

  type Attempt {
    id: ID!
    job: CoordinationJob!
    channel: String!
    at: String!
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

const resolvers = {
  Query: {
    // RLS decides which rows exist for this caller, so a non-parent gets an empty list rather
    // than an error, and a stranger cannot enumerate jobs, names or history.
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
      const q = dbFor(ctx).from('attempts').select('id,job_id,channel,at');
      const data = await rows(jobId ? q.eq('job_id', jobId) : q);
      return data.map((a) => ({
        id: String(a.id),
        job: { id: String(a.job_id) },
        channel: String(a.channel),
        at: String(a.at),
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
  },

  Mutation: {
    requestPickup: async (
      _: unknown,
      { childId, asOf, window }: { childId: string; asOf?: string; window?: string },
      ctx: Ctx,
    ) => {
      requireCaller(ctx);
      // The window is part of the idempotency key; it defaults to the afternoon window.
      const { data, error } = await dbFor(ctx).rpc('request_pickup', {
        p_child: childId,
        p_as_of: asOf ?? null,
        p_window: window ?? 'afternoon',
      });
      if (error) rpcError(error);
      return jobById(ctx, String(data));
    },

    acceptPickup: async (
      _: unknown,
      { attemptId, available, declineReason }: { attemptId: string; available: boolean; declineReason?: string | null },
      ctx: Ctx,
    ) => {
      const callerId = requireCaller(ctx);
      // The contract requires the job's requestVersion, so read the Attempt's job first.
      const a = await rows(
        dbFor(ctx).from('attempts').select('id,job_id').eq('id', attemptId),
      );
      if (!a.length) throw new GraphQLError('ATTEMPT_NOT_FOUND', { extensions: { code: 'ATTEMPT_NOT_FOUND' } });
      const j = await rows(
        dbFor(ctx).from('coordination_jobs').select('id,request_version').eq('id', String(a[0].job_id)),
      );
      if (!j.length) throw new GraphQLError('JOB_NOT_FOUND', { extensions: { code: 'JOB_NOT_FOUND' } });

      const { error } = await dbFor(ctx).rpc('accept_pickup', {
        p_attempt: attemptId,
        p_available: available,
        p_decline: declineReason ?? null,
        p_entry: 'CANDIDATE_JWT',
        p_request_version: Number(j[0].request_version),
      });
      if (error) rpcError(error);

      const e = await rows(
        dbFor(ctx)
          .from('candidate_evaluations')
          .select('candidate_id,reason_code,available,decline_reason,accepted_via,estimated_ride_cost_usd,cost_basis,distance_miles,location_provenance,cost_calculated_at')
          .eq('job_id', String(a[0].job_id)),
      );
      const mine = e.find((x) => String(x.candidate_id) === String(callerId));
      if (!mine) throw new GraphQLError('NOT_FOUND', { extensions: { code: 'NOT_FOUND' } });
      return evalFromRow(mine as Record<string, unknown>);
    },

    approvePickup: async (
      _: unknown,
      args: { jobId: string; version: number; decision: string; declineReason?: string | null; acceptOverLimit?: boolean },
      ctx: Ctx,
    ) => {
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
  },

  CoordinationJob: {
    child: (j: { child: { id: string }; childId?: string }) => j.child ?? { id: j.childId },

    candidateEvaluations: async (j: { id: string }, _a: unknown, ctx: Ctx) => {
      requireCaller(ctx);
      const data = await rows(
        dbFor(ctx)
          .from('candidate_evaluations')
          .select('candidate_id,reason_code,available,decline_reason,accepted_via,estimated_ride_cost_usd,cost_basis,distance_miles,location_provenance,cost_calculated_at')
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
};

export default { typeDefs, resolvers };
