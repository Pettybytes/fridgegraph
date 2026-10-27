import type { Ctx } from '../authz';
import { parse } from 'graphql';
import { SCOPE, authorizeChild } from '../authz';
import { store } from '../store';

const typeDefs = parse(`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])


  type Query {
    schoolReports(childId: ID!): [SchoolReport!]!
    permissionSlips(childId: ID!): [PermissionSlip!]!
  }

  type Child @key(fields: "id") {
    id: ID!
  }

  type SchoolReport {
    id: ID!
    child: Child!
    kind: String!
    text: String!
    at: String!
  }

  type PermissionSlip {
    id: ID!
    child: Child!
    title: String!
    signed: Boolean!
  }
`);

const resolvers = {
  Query: {
    schoolReports: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      await authorizeChild(ctx, childId, SCOPE.school);
      return store.schoolReports.filter((r) => r.childId === childId);
    },
    permissionSlips: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      await authorizeChild(ctx, childId, SCOPE.school);
      return store.permissionSlips.filter((s) => s.childId === childId);
    },
  },

  SchoolReport: {
    child: (r: { childId: string }) => ({ id: r.childId }),
  },

  PermissionSlip: {
    child: (s: { childId: string }) => ({ id: s.childId }),
  },
};

export default { typeDefs, resolvers };
