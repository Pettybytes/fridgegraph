import { parse } from 'graphql';
import { SCOPE, authorizeChild, deny, isParentOf, requireCaller, type Ctx } from '../authz';
import { dbFor, rows } from '../db';

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
    practices: async (_: unknown, { childId, date }: { childId: string; date: string }, ctx: Ctx) => {
      await authorizeChild(ctx, childId, SCOPE.schedule);
      // groups/memberships are village-owned: read them (read-only) through the caller's RLS
      // client rather than writing or caching them here.
      const memberships = await rows(
        dbFor(ctx).from('memberships').select('group_id').eq('person_id', childId),
      );
      const groupIds = memberships.map((m) => String(m.group_id));
      if (groupIds.length === 0) return [];
      const groups = await rows(
        dbFor(ctx).from('groups').select('id,kind').in('id', groupIds).eq('kind', 'team'),
      );
      const teamIds = groups.map((g) => String(g.id));
      if (teamIds.length === 0) return [];
      const data = await rows(
        dbFor(ctx)
          .from('practices')
          .select('id,group_id,start_at,location')
          .in('group_id', teamIds),
      );
      return data
        .filter((p) => String(p.start_at).startsWith(date.slice(0, 10)))
        .map((p) => ({
          id: String(p.id),
          group: { id: String(p.group_id) },
          start: String(p.start_at),
          location: (p.location as string | null) ?? null,
        }));
    },
    groupEvents: async (_: unknown, { groupId }: { groupId: string }, ctx: Ctx) => {
      const callerId = requireCaller(ctx);
      const members = await rows(
        dbFor(ctx).from('memberships').select('person_id').eq('group_id', groupId),
      );
      const memberIds = members.map((m) => String(m.person_id));
      const isMember = memberIds.includes(callerId);
      let isParentOfMember = false;
      for (const id of memberIds) {
        if (await isParentOf(ctx, id)) {
          isParentOfMember = true;
          break;
        }
      }
      if (!isMember && !isParentOfMember) throw deny();
      // No GroupEvent source table exists yet (milestone 1 returned an empty list on purpose).
      return [];
    },
  },

  Practice: {
    group: (p: { group: { id: string }; groupId?: string }) => p.group ?? { id: p.groupId },
  },

  GroupEvent: {
    group: (g: { group: { id: string }; groupId?: string }) => g.group ?? { id: g.groupId },
  },
};

export default { typeDefs, resolvers };
