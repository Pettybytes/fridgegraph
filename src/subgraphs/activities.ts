import type { Ctx } from '../authz';
import { parse } from 'graphql';
import { SCOPE, authorizeChild, deny, isParentOf, requireCaller } from '../authz';
import { store } from '../store';

const typeDefs = parse(`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])


  type Query {
    practices(childId: ID!, date: String!): [Practice!]!
    groupEvents(groupId: ID!): [GroupEvent!]!
  }

  type Child @key(fields: "id") {
    id: ID!
  }

  type Group @key(fields: "id") {
    id: ID!
  }

  type Practice {
    id: ID!
    group: Group!
    start: String!
    location: String
  }

  type GroupEvent {
    id: ID!
    group: Group!
    kind: String!
    text: String!
    at: String!
  }
`);

const resolvers = {
  Query: {
    practices: (_: unknown, { childId, date }: { childId: string; date: string }, ctx: Ctx) => {
      authorizeChild(ctx, childId, SCOPE.schedule);
      const teamGroupIds = store.memberships
        .filter((m) => m.personId === childId)
        .map((m) => m.groupId)
        .filter((gid) => store.groups.some((g) => g.id === gid && g.kind === 'team'));
      return store.practices.filter(
        (p) => teamGroupIds.includes(p.groupId) && p.start.startsWith(date.slice(0, 10)),
      );
    },
    groupEvents: (_: unknown, { groupId }: { groupId: string }, ctx: Ctx) => {
      const callerId = requireCaller(ctx);
      const memberIds = store.memberships
        .filter((m) => m.groupId === groupId)
        .map((m) => m.personId);
      const isMember = memberIds.includes(callerId);
      const isParentOfMember = memberIds.some((id) => isParentOf(callerId, id));
      if (!isMember && !isParentOfMember) throw deny();
      return store.practices.length ? [] : [];
    },
  },

  Practice: {
    group: (p: { groupId: string }) => ({ id: p.groupId }),
  },

  GroupEvent: {
    group: (g: { groupId: string }) => ({ id: g.groupId }),
  },
};

export default { typeDefs, resolvers };
