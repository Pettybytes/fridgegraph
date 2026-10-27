import type { Ctx } from '../authz';
import { parse } from 'graphql';
import { SCOPE, authorizeChild } from '../authz';
import { store } from '../store';

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
      return store.events.filter((e) => e.childId === childId && e.start.startsWith(date.slice(0, 10)));
    },
  },

  Event: {
    child: (e: { childId: string }) => ({ id: e.childId }),
  },
};

export default { typeDefs, resolvers };
