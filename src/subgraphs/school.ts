import { SCOPE, authorizeChild, type Ctx } from '../authz';
import { dbFor, rows } from '../db';

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
      const data = await rows(
        dbFor(ctx)
          .from('school_reports')
          .select('id,child_id,kind,text,at')
          .eq('child_id', childId),
      );
      return data.map((r) => ({
        id: String(r.id),
        child: { id: String(r.child_id) },
        kind: String(r.kind),
        text: String(r.text),
        at: String(r.at).slice(0, 10),
      }));
    },
    permissionSlips: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      await authorizeChild(ctx, childId, SCOPE.school);
      const data = await rows(
        dbFor(ctx)
          .from('permission_slips')
          .select('id,child_id,title,signed')
          .eq('child_id', childId),
      );
      return data.map((s) => ({
        id: String(s.id),
        child: { id: String(s.child_id) },
        title: String(s.title),
        signed: Boolean(s.signed),
      }));
    },
  },

  SchoolReport: {
    child: (r: { child: { id: string }; childId?: string }) => r.child ?? { id: r.childId },
  },

  PermissionSlip: {
    child: (s: { child: { id: string }; childId?: string }) => s.child ?? { id: s.childId },
  },
};

export default { typeDefs, resolvers };
