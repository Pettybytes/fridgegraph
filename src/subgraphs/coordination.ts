import type { Ctx } from '../authz';
import { parse } from 'graphql';
import { requireCaller } from '../authz';
import { store } from '../store';

/**
 * Coordination owns the job machinery for pickups, invitations and onboarding.
 * Milestone 1: schema only — every resolver returns an empty list.
 */
const typeDefs = parse(`
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
    coordinationJobs: (_: unknown, __: unknown, ctx: Ctx) => {
      requireCaller(ctx);
      return store.coordinationJobs;
    },
    attempts: (_: unknown, __: unknown, ctx: Ctx) => {
      requireCaller(ctx);
      return store.attempts;
    },
    informationRequests: (_: unknown, __: unknown, ctx: Ctx) => {
      requireCaller(ctx);
      return store.informationRequests;
    },
    confirmations: (_: unknown, __: unknown, ctx: Ctx) => {
      requireCaller(ctx);
      return store.confirmations;
    },
  },

  CoordinationJob: {
    child: (j: { childId: string }) => ({ id: j.childId }),
  },
};

export default { typeDefs, resolvers };
