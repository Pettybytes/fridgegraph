import { parse } from 'graphql';
import { requireCaller, type Ctx } from '../authz';
import { dbFor, rows } from '../db';

/**
 * Coordination owns the job machinery for pickups, invitations and onboarding.
 * Milestone 1: schema only — every resolver returns an empty list.
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

  type Child @key(fields: "id") {
    id: ID!
  }

  enum CoordinationType {
    PICKUP
    INVITATION
    ONBOARDING
  }

  type CoordinationJob {
    id: ID!
    idempotencyKey: String!
    type: CoordinationType!
    child: Child!
    status: String!
    version: Int!
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
  }
`);

const resolvers = {
  Query: {
    // All four tables are empty in the seed by design. The filters below keep the original shape:
    // no argument -> every row this caller may see; with an id -> that row only. RLS decides which
    // rows exist for this caller, so a non-parent gets an empty list rather than an error.
    coordinationJobs: async (
      _: unknown,
      { childId }: { childId?: string },
      ctx: Ctx,
    ) => {
      requireCaller(ctx);
      const q = dbFor(ctx)
        .from('coordination_jobs')
        .select('id,idempotency_key,type,child_id,status,version');
      const data = await rows(childId ? q.eq('child_id', childId) : q);
      return data.map((j) => ({
        id: String(j.id),
        idempotencyKey: String(j.idempotency_key),
        type: String(j.type),
        child: { id: String(j.child_id) },
        status: String(j.status),
        version: Number(j.version),
      }));
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
        dbFor(ctx).from('confirmations').select('id,job_id,received_at'),
      );
      const jobs = await rows(dbFor(ctx).from('coordination_jobs').select('id,child_id'));
      const allowed = new Set(
        jobs
          .filter((j) => !childId || String(j.child_id) === childId)
          .map((j) => String(j.id)),
      );
      return data
        .filter((c) => allowed.has(String(c.job_id)))
        .map((c) => ({
          id: String(c.id),
          job: { id: String(c.job_id) },
          receivedAt: String(c.received_at),
        }));
    },
  },

  CoordinationJob: {
    child: (j: { child: { id: string }; childId?: string }) => j.child ?? { id: j.childId },
  },
};

export default { typeDefs, resolvers };
