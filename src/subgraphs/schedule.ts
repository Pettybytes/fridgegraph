import { parse } from 'graphql';
import { SCOPE, authorizeChild, type Ctx } from '../authz';
import { dbFor, rows } from '../db';

const typeDefs = parse(`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])


  type Query {
    events(childId: ID!, date: String!): [Event!]!
  }

  type Child @key(fields: "id") {
    id: ID!
  }

  type Event {
    id: ID!
    child: Child!
    title: String!
    start: String!
    end: String!
    location: String
  }
`);

const resolvers = {
  Query: {
    events: async (_: unknown, { childId, date }: { childId: string; date: string }, ctx: Ctx) => {
      await authorizeChild(ctx, childId, SCOPE.schedule);
      const data = await rows(
        dbFor(ctx)
          .from('events')
          .select('id,child_id,title,start_at,end_at,location')
          .eq('child_id', childId),
      );
      return data
        .filter((e) => String(e.start_at).startsWith(date.slice(0, 10)))
        .map((e) => ({
          id: String(e.id),
          child: { id: String(e.child_id) },
          title: String(e.title),
          start: String(e.start_at),
          end: String(e.end_at),
          location: (e.location as string | null) ?? null,
        }));
    },
  },

  Event: {
    child: (e: { child: { id: string }; childId?: string }) => e.child ?? { id: e.childId },
  },
};

export default { typeDefs, resolvers };
